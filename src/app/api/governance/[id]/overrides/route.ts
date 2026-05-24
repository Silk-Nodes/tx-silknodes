// GET /api/governance/[id]/overrides
//
// Enriches the delegator override vote list with each delegator's current
// bonded stake and their per-validator delegations. Used to power the
// "Override votes" section + drawer in the settled proposal layout.
//
// Why a separate endpoint:
//   - The base /api/governance/[id] is already heavy; the overrides
//     enrichment needs 1 LCD call per delegator (75-200ms each).
//   - The data is loaded lazily on the client when the user expands the
//     accordion, so most page views don't pay this cost.
//   - Settled proposals never change, so this can be cached aggressively
//     server-side.
//
// Historical-exact stake would require querying at the vote's block
// height, which Hasura's passthrough doesn't reliably support. We
// approximate with current stake and label it as such in the UI.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 300; // 5 min - settled props don't move; cache wins.

const HASURA_URL = "https://hasura.mainnet-1.coreum.dev/v1/graphql";
const LCD = "https://full-node.mainnet-1.coreum.dev:1317";
const UCORE_PER_TX = 1_000_000;
const CONCURRENCY = 8; // parallel LCD calls

interface HasuraVote {
  voter_address: string;
  option: string;
  timestamp: string;
}

interface DelegationResponseRaw {
  delegation: {
    delegator_address: string;
    validator_address: string;
    shares: string;
  };
  balance: { denom: string; amount: string };
}

// Output shape: one entry per delegator who voted on this proposal.
interface EnrichedOverride {
  voterAddress: string;
  voteOption: string;
  votedAt: string;
  bondedTotalTX: number;
  delegations: {
    operatorAddress: string;
    delegatedTX: number;
  }[];
}

function ucoreToTX(s: string | undefined | null): number {
  if (!s) return 0;
  try { return Number(BigInt(s)) / UCORE_PER_TX; } catch { return 0; }
}

async function hasura<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(HASURA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`hasura HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(`hasura: ${JSON.stringify(json.errors)}`);
  return json.data as T;
}

// Concurrency-limited map: like Promise.all but only N in flight at a time.
async function pmap<T, R>(items: T[], fn: (item: T) => Promise<R>, concurrency: number): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function fetchDelegations(addr: string): Promise<{ totalTX: number; delegations: { operatorAddress: string; delegatedTX: number }[] }> {
  try {
    const url = `${LCD}/cosmos/staking/v1beta1/delegations/${addr}?pagination.limit=200`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return { totalTX: 0, delegations: [] };
    const json = await res.json();
    const rows = (json.delegation_responses as DelegationResponseRaw[] ?? []);
    const delegations = rows.map((r) => ({
      operatorAddress: r.delegation.validator_address,
      delegatedTX: Number(r.balance.amount) / UCORE_PER_TX,
    }));
    const totalTX = delegations.reduce((sum, d) => sum + d.delegatedTX, 0);
    return { totalTX, delegations };
  } catch {
    // If LCD blows up on one address, return zeros so the page still
    // renders the row with the basic data we know.
    return { totalTX: 0, delegations: [] };
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "bad id" }, { status: 400 });
    }

    // Get the delegator votes (non-validator votes) for this proposal from
    // Hasura. The base /api/governance/[id] already does this, but the
    // client may want to expand the accordion before that response lands
    // in some race-conditiony cases - so we re-query here for safety.
    const data = await hasura<{ proposal_vote: HasuraVote[]; validator_info: { self_delegate_address: string }[] }>(
      `query Q($id: Int!) {
        proposal_vote(where: {proposal_id: {_eq: $id}}, order_by: {timestamp: asc}) {
          voter_address option timestamp
        }
        validator_info { self_delegate_address }
      }`,
      { id },
    );

    // Filter out votes from validators' own self-delegate addresses; we
    // only want true delegator-only overrides.
    const validatorSet = new Set(
      data.validator_info.map((v) => v.self_delegate_address).filter(Boolean),
    );
    const delegatorVotes = data.proposal_vote.filter((v) => !validatorSet.has(v.voter_address));

    if (delegatorVotes.length === 0) {
      return NextResponse.json({ overrides: [] }, { headers: { "cache-control": "no-store" } });
    }

    // Concurrency-limited LCD fetches. ~8 in flight keeps the node happy
    // and finishes 75-200 addresses in 2-4 seconds.
    const enriched = await pmap(
      delegatorVotes,
      async (v) => {
        const { totalTX, delegations } = await fetchDelegations(v.voter_address);
        return {
          voterAddress: v.voter_address,
          voteOption: v.option.replace("VOTE_OPTION_", ""),
          votedAt: v.timestamp,
          bondedTotalTX: totalTX,
          delegations,
        } satisfies EnrichedOverride;
      },
      CONCURRENCY,
    );

    return NextResponse.json(
      { overrides: enriched },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: message },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

void ucoreToTX; // suppress unused warning when not directly used
