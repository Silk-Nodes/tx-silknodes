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

// The chain's own vote record. Same file the validator pages use.
//
// This route had both of the bugs that were fixed for validators and neither
// fix reached it, so the passport and the validator page disagreed about the
// same entity: the passport said "14 of 41" where the validator page said 43
// proposals. Two numbers for one fact is worse than either being slightly off.
import HISTORICAL_VOTES from "@/data/historical-votes.json";

const HASURA_URL = "https://hasura.mainnet-1.coreum.dev/v1/graphql";
// Used only to backfill proposals the indexer never recorded.
const GOV_LCD = "https://rest-coreum.ecostake.com";

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

    // Backfill proposals the indexer never recorded. Hasura is missing 40 and
    // 42 outright, so a turnout computed from its list alone divides by 41
    // where the chain has 43, and every wallet's participation reads high
    // against a denominator that is too small.
    const byId = new Map<number, HasuraProposal>();
    for (const p of proposals) byId.set(p.id, p);
    try {
      const chainRes = await fetch(`${GOV_LCD}/cosmos/gov/v1/proposals?pagination.limit=300`, {
        signal: AbortSignal.timeout(15000),
        cache: "no-store",
      });
      if (chainRes.ok) {
        const chainJson = await chainRes.json();
        for (const cp of chainJson?.proposals ?? []) {
          const id = Number(cp.id);
          if (!Number.isFinite(id) || byId.has(id)) continue;
          byId.set(id, {
            id,
            title: cp.title || cp.messages?.[0]?.content?.title || `Proposal #${id}`,
            status: cp.status,
            voting_end_time: cp.voting_end_time ?? null,
          });
        }
      }
    } catch {
      // Chain unreachable: fall back to the indexer's list. The denominator is
      // then understated rather than wrong-shaped.
    }
    const allProposals = [...byId.values()];

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
          votedAt: v.timestamp as string | null,
        };
      })
      .filter(Boolean) as {
        proposalId: number; title: string; status: string;
        option: VoteOption; votedAt: string | null;
      }[];

    // Merge the votes the indexer lost. Hasura holds no votes at all for
    // proposals 1, 2, 4, 5, 6, 7, 8, 40 and 42, and drops individual votes
    // inside proposals it does index, so a wallet's record here was
    // understated the same way validators' were. The chain snapshot carries no
    // timestamp, because settled votes are deleted and only the transaction
    // survives, so those rows sort last rather than claiming a position in the
    // timeline.
    const seen = new Set(votes.map((v) => v.proposalId));
    let recovered = 0;
    for (const [pid, voters] of Object.entries(
      HISTORICAL_VOTES as Record<string, Record<string, VoteOption>>,
    )) {
      const id = Number(pid);
      const opt = voters[address];
      if (!opt || seen.has(id)) continue;
      const p = byId.get(id);
      if (!p) continue;
      seen.add(id);
      recovered++;
      votes.push({
        proposalId: id,
        title: p.title,
        status: shortStatus(p.status),
        option: opt,
        votedAt: null,
      });
    }
    votes.sort((a, b) => b.proposalId - a.proposalId);

    const votableCount = allProposals.filter((p) => isVotable(p.status)).length;
    const votedVotableIds = new Set(
      votes
        .map((v) => v.proposalId)
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
        // How many came from the chain record rather than the indexer.
        recoveredFromChain: recovered,
        // Newest vote that actually carries a timestamp. Recovered votes have
        // none, and the list is ordered by proposal id, so taking votes[0]
        // blindly would report "never voted" for a wallet whose most recent
        // recorded vote happens to be one we recovered.
        lastVotedAt:
          votes.map((v) => v.votedAt).filter(Boolean).sort().reverse()[0] ?? null,
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
