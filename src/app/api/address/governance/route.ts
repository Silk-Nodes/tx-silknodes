// GET /api/address/governance?address=core1...
//
// Powers the "Governance record" section of the Wallet Passport: every
// proposal a single address has voted on, plus a turnout read. There is
// no per-address vote endpoint on-chain, so we go straight to Coreum's
// public Hasura indexer (the same source /api/governance/[id] uses) and
// filter proposal_vote by voter_address.
//
// Cache: 5 min in-process. A wallet's voting history only changes when a
// new proposal is voted on, so this is plenty fresh.

import { NextResponse } from "next/server";

const HASURA_URL = "https://hasura.mainnet-1.coreum.dev/v1/graphql";

type VoteOption = "YES" | "NO" | "ABSTAIN" | "NO_WITH_VETO";

interface HasuraProposal {
  id: number;
  title: string;
  status: string;
  voting_end_time: string | null;
}
interface HasuraAddrVote {
  proposal_id: number;
  option: string;
  timestamp: string;
}

const QUERY = `query Q($addr: String!) {
  proposal_vote(where: {voter_address: {_eq: $addr}}, order_by: {proposal_id: desc}) {
    proposal_id option timestamp
  }
  proposal(order_by: {id: desc}) { id title status voting_end_time }
}`;

function normalizeOption(opt: string): VoteOption | null {
  switch (opt) {
    case "VOTE_OPTION_YES": return "YES";
    case "VOTE_OPTION_NO": return "NO";
    case "VOTE_OPTION_ABSTAIN": return "ABSTAIN";
    case "VOTE_OPTION_NO_WITH_VETO": return "NO_WITH_VETO";
    default: return null;
  }
}

// A proposal counts toward turnout once it actually reached a vote (i.e.
// it is not still in the deposit period and was not withdrawn).
function isVotable(status: string): boolean {
  return (
    status === "PROPOSAL_STATUS_PASSED" ||
    status === "PROPOSAL_STATUS_REJECTED" ||
    status === "PROPOSAL_STATUS_FAILED" ||
    status === "PROPOSAL_STATUS_VOTING_PERIOD"
  );
}
function shortStatus(status: string): string {
  switch (status) {
    case "PROPOSAL_STATUS_PASSED": return "passed";
    case "PROPOSAL_STATUS_REJECTED": return "rejected";
    case "PROPOSAL_STATUS_FAILED": return "failed";
    case "PROPOSAL_STATUS_VOTING_PERIOD": return "voting";
    case "PROPOSAL_STATUS_DEPOSIT_PERIOD": return "deposit";
    default: return "unknown";
  }
}

let cache: { ts: number; key: string; body: unknown } | null = null;
const TTL_MS = 5 * 60 * 1000;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const address = (searchParams.get("address") || "").trim();
  if (!address.startsWith("core1") || address.length < 39) {
    return NextResponse.json({ error: "Enter a valid core1... address" }, { status: 400 });
  }

  if (cache && cache.key === address && Date.now() - cache.ts < TTL_MS) {
    return NextResponse.json(cache.body);
  }

  try {
    const res = await fetch(HASURA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: QUERY, variables: { addr: address } }),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`hasura HTTP ${res.status}`);
    const json = await res.json();
    if (json.errors) throw new Error(`hasura errors: ${JSON.stringify(json.errors)}`);

    const proposals: HasuraProposal[] = json.data.proposal ?? [];
    const rawVotes: HasuraAddrVote[] = json.data.proposal_vote ?? [];

    const byId = new Map<number, HasuraProposal>();
    for (const p of proposals) byId.set(p.id, p);

    const votes = rawVotes
      .map((v) => {
        const opt = normalizeOption(v.option);
        const p = byId.get(v.proposal_id);
        if (!opt || !p) return null;
        return {
          proposalId: v.proposal_id,
          title: p.title,
          status: shortStatus(p.status),
          option: opt,
          votedAt: v.timestamp,
        };
      })
      .filter(Boolean);

    const votableCount = proposals.filter((p) => isVotable(p.status)).length;
    const votedVotableIds = new Set(
      rawVotes
        .map((v) => v.proposal_id)
        .filter((id) => {
          const p = byId.get(id);
          return p && isVotable(p.status);
        }),
    );
    const votedCount = votedVotableIds.size;
    const turnoutPct = votableCount > 0 ? Math.round((votedCount / votableCount) * 100) : 0;

    const body = {
      address,
      votes,
      summary: {
        votedCount,
        votableCount,
        turnoutPct,
        lastVotedAt: votes[0]?.votedAt ?? null,
      },
      updatedAt: new Date().toISOString(),
    };

    cache = { ts: Date.now(), key: address, body };
    return NextResponse.json(body);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load governance history" },
      { status: 502 },
    );
  }
}
