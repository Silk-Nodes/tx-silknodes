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

import { lcdGet } from "@/lib/chain-config";
import { NextResponse } from "next/server";
import { getActiveValidatorSet } from "@/lib/validator-set";

// The chain's own vote record, filling the gaps the Hasura indexer has.
// See scripts/backfill-votes.mjs.
import HISTORICAL_VOTES from "@/data/historical-votes.json";
import { cached, cacheHeaders } from "@/lib/response-cache";

const ROUTE_TAG = "governance/[id]/overrides";

// This is by far the most expensive endpoint on the site: it enriches every
// delegator vote on a proposal, which is ~475 separate LCD calls and ~11s of
// upstream traffic for proposal 8. Unbounded, that turns one cheap HTTP
// request into a burst large enough to get our IP rate limited by the public
// nodes, which reads as a site-wide outage.
//
// Settled proposals never change, so this is cached hard. The single-flight in
// cached() is the part that matters most here: it collapses concurrent misses
// into ONE fan-out instead of one per request.
const TTL_MS = 10 * 60 * 1000;
const TTL_S = TTL_MS / 1000;

// Hard ceiling on the fan-out. A proposal with thousands of delegator votes
// must not translate into thousands of upstream calls, so the enrichment is
// capped and the response says so rather than silently truncating.
const MAX_ENRICHED = 400;

export const dynamic = "force-dynamic";
export const revalidate = 300; // 5 min - settled props don't move; cache wins.

const HASURA_URL = "https://hasura.mainnet-1.coreum.dev/v1/graphql";
// Ordered pool rather than a single host. This route degrades silently on
// failure (fetchDelegations returns zeros so the page still renders), which
// means an LCD outage showed every voter with 0 TX delegated as though that
// were the real number. Failing over keeps the figures honest.
const LCD_HOSTS = [
  "https://full-node.mainnet-1.coreum.dev:1317",
  "https://rest-coreum.ecostake.com",
  "https://coreum-lcd.silknodes.io",
];
const LCD = LCD_HOSTS[0];
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
  // Null for votes recovered from the chain: settled votes are deleted by the
  // SDK, so only the transaction survives and it carries no indexer timestamp.
  votedAt: string | null;
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
  const path = `/cosmos/staking/v1beta1/delegations/${addr}?pagination.limit=200`;
  for (const host of LCD_HOSTS) {
    try {
      const res = await fetch(`${host}${path}`, { cache: "no-store" });
      // 404 is a real answer (address has no delegations); anything else
      // non-ok is a node problem, so try the next host rather than
      // reporting an empty delegation list as fact.
      if (res.status === 404) return { totalTX: 0, delegations: [] };
      if (!res.ok) continue;
      const json = await res.json();
      const rows = (json.delegation_responses as DelegationResponseRaw[] ?? []);
      const delegations = rows.map((r) => ({
        operatorAddress: r.delegation.validator_address,
        delegatedTX: Number(r.balance.amount) / UCORE_PER_TX,
      }));
      const totalTX = delegations.reduce((sum, d) => sum + d.delegatedTX, 0);
      return { totalTX, delegations };
    } catch {
      // transport error, fall through to the next host
    }
  }
  // Whole pool unreachable. Still return zeros so the page renders the row
  // with the basic data we know, matching the previous behaviour.
  return { totalTX: 0, delegations: [] };
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

    const payload = await cached(`overrides:${id}`, TTL_MS, async () => {

    // Get the delegator votes (non-validator votes) for this proposal from
    // Hasura. The base /api/governance/[id] already does this, but the
    // client may want to expand the accordion before that response lands
    // in some race-conditiony cases - so we re-query here for safety.
    // Paged: the Coreum Hasura clamps every query to 100 rows server-side.
    // Proposal 45 had 132 votes, and the unpaged version of this query
    // silently dropped the last 32.
    const votes: HasuraVote[] = [];
    try {
      for (let off = 0; ; off += 100) {
        const page = await hasura<{ proposal_vote: HasuraVote[] }>(
          `query V($id: Int!, $off: Int!) {
            proposal_vote(
              where: {proposal_id: {_eq: $id}}
              order_by: [{timestamp: asc}, {voter_address: asc}]
              limit: 100
              offset: $off
            ) { voter_address option timestamp }
          }`,
          { id, off },
        );
        votes.push(...page.proposal_vote);
        if (page.proposal_vote.length < 100 || off >= 10_000) break;
      }
    } catch {
      // The indexer goes down. It was 503 for three days from 2026-08-27 and
      // this route answered 500, so the page showed "Couldn't enrich override
      // data" on a live vote. The chain can answer for a live proposal and the
      // historical archive covers settled ones, so degrade instead of failing.
    }

    // Nothing from the indexer: read the votes from the chain. Only possible
    // while a proposal is live, since the SDK deletes votes once it tallies,
    // which is also the only time anyone urgently needs this list.
    if (votes.length === 0) {
      try {
        let key: string | null = null;
        for (let page = 0; page < 20; page++) {
          const q = new URLSearchParams({ "pagination.limit": "1000" });
          if (key) q.set("pagination.key", key);
          const res = await lcdGet(`/cosmos/gov/v1/proposals/${id}/votes?${q}`);
          if (!res.ok) break;
          const body = await res.json();
          for (const v of body?.votes ?? []) {
            const opt = v?.options?.[0]?.option;
            if (!opt) continue;
            // No timestamp: the chain records that a vote exists, never when
            // it was cast. These sort last rather than claiming a position in
            // the voting timeline.
            votes.push({ voter_address: v.voter, option: opt, timestamp: null } as unknown as HasuraVote);
          }
          key = body?.pagination?.next_key ?? null;
          if (!key) break;
        }
      } catch { /* fall through to the historical archive below */ }
    }
    const data = {
      proposal_vote: votes,
      // validator_info is capped at 100 rows too, and the chain has 106
      // validators. Derive the self-delegate set locally instead: an
      // operator address re-encodes to its voting account, no lookup.
      validator_info: [] as { self_delegate_address: string }[],
    };
    const ownSet = await getActiveValidatorSet();
    for (const v of ownSet.validators) {
      data.validator_info.push({ self_delegate_address: v.selfDelegateAddress });
    }

    // Filter out votes from validators' own self-delegate addresses; we
    // only want true delegator-only overrides.
    const validatorSet = new Set(
      data.validator_info.map((v) => v.self_delegate_address).filter(Boolean),
    );
    const delegatorVotes: { voter_address: string; option: string; timestamp: string | null }[] =
      data.proposal_vote.filter((v) => !validatorSet.has(v.voter_address));

    // Merge in the votes the indexer lost. Without this, every proposal Hasura
    // has no votes for renders "No delegator override votes on this proposal"
    // directly underneath a header counting 137 of them, because the detail
    // route already recovers the count from the chain and this one did not.
    // The chain snapshot keeps no timestamp, so these sort last rather than
    // pretending to a position in the voting timeline.
    const seenVoters = new Set(delegatorVotes.map((v) => v.voter_address));
    const archived: Record<string, string> =
      (HISTORICAL_VOTES as Record<string, Record<string, string>>)[String(id)] ?? {};
    for (const [voter, opt] of Object.entries(archived)) {
      if (validatorSet.has(voter) || seenVoters.has(voter)) continue;
      // Stored normalized ("YES"); the enrichment below strips the raw prefix,
      // so hand it back in the raw shape it expects.
      delegatorVotes.push({ voter_address: voter, option: `VOTE_OPTION_${opt}`, timestamp: null });
    }

      if (delegatorVotes.length === 0) return { overrides: [], truncated: false, totalVotes: 0 };

    // Enrich the largest-first is not possible before enrichment (stake is
    // what we are fetching), so the cap is applied on the raw list. Anything
    // beyond it is reported rather than silently dropped.
    const toEnrich = delegatorVotes.slice(0, MAX_ENRICHED);

    // Concurrency-limited LCD fetches. ~8 in flight keeps the node happy
    // and finishes 75-200 addresses in 2-4 seconds.
    const enriched = await pmap(
      toEnrich,
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

      return {
        overrides: enriched,
        truncated: delegatorVotes.length > toEnrich.length,
        totalVotes: delegatorVotes.length,
      };
    });

    return NextResponse.json(
      payload,
      { headers: cacheHeaders(TTL_S) },
    );
  } catch (err: unknown) {
    // The raw message can carry the DB role, connection string, internal
    // hostnames or upstream credentials, so it is logged and never returned.
    // Callers get a generic failure; operators get the detail in the journal.
    console.error(`[${ROUTE_TAG}]`, err);
    return NextResponse.json(
      { error: "internal error" },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

void ucoreToTX; // suppress unused warning when not directly used
