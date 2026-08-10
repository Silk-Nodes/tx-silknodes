"use client";

// Open proposals and whether this wallet has voted on them.
//
// The point is the nudge: a proposal in its voting period that this wallet
// has not voted on yet is actionable TODAY, and nothing else on the site
// says so from the wallet's side. Voting itself happens on the proposal
// page, where the existing VotePanel signs; duplicating a signing surface
// here would be a second thing to keep correct for zero new capability.
//
// When nothing is open, the block collapses to the wallet's turnout record
// in one line rather than an empty box.

import { useEffect, useState } from "react";
import Link from "next/link";

interface OpenProposal {
  id: number;
  title: string;
  votingEndTime: string | null;
}
interface AddrVote {
  proposalId: number;
  option: string;
}
interface Summary {
  votedCount: number;
  votableCount: number;
  turnoutPct: number;
}

const OPTION_LABEL: Record<string, string> = {
  YES: "voted Yes",
  NO: "voted No",
  ABSTAIN: "voted Abstain",
  NO_WITH_VETO: "voted No with veto",
};

function endsIn(iso: string | null): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "ending now";
  const days = Math.floor(ms / 86400000);
  if (days >= 1) return `voting ends in ${days} day${days === 1 ? "" : "s"}`;
  const hours = Math.max(1, Math.floor(ms / 3600000));
  return `voting ends in ${hours} hour${hours === 1 ? "" : "s"}`;
}

export default function WalletGovernance({ address }: { address: string }) {
  const [open, setOpen] = useState<OpenProposal[] | null>(null);
  const [votes, setVotes] = useState<Map<number, string>>(new Map());
  const [summary, setSummary] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/governance").then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/address/governance?address=${address}`).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([gov, addr]) => {
        if (cancelled) return;
        if (!gov?.proposals) { setFailed(true); return; }
        setOpen(
          gov.proposals
            .filter((p: { rawStatus: string }) => p.rawStatus === "PROPOSAL_STATUS_VOTING_PERIOD")
            .map((p: { id: number; title: string; votingEndTime: string | null }) => ({
              id: p.id, title: p.title, votingEndTime: p.votingEndTime,
            })),
        );
        if (addr?.votes) {
          setVotes(new Map(addr.votes.map((v: AddrVote) => [v.proposalId, v.option])));
        }
        if (addr?.summary) setSummary(addr.summary);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [address]);

  // Unreachable governance data is a reason to say nothing, not to render an
  // empty section implying there is nothing to vote on.
  if (failed) return null;
  if (!open) return <div className="pdp-loading">Checking open proposals...</div>;

  return (
    <div className="wg">
      <div className="wa-side-head">
        <span>Governance</span>
        {summary && (
          <span className="mono">
            voted on {summary.votedCount} of {summary.votableCount} proposals
          </span>
        )}
      </div>

      {open.length === 0 ? (
        <p className="wg-quiet">
          No proposals are open for voting right now.
        </p>
      ) : (
        open.map((p) => {
          const vote = votes.get(p.id);
          return (
            <div key={p.id} className="wg-row">
              <div className="wg-row-main">
                <span className="wg-row-title">
                  <span className="wg-row-id mono">#{p.id}</span> {p.title}
                </span>
                <span className="wg-row-end">{endsIn(p.votingEndTime)}</span>
              </div>
              {vote ? (
                <span className="wg-voted">{OPTION_LABEL[vote] ?? "voted"}</span>
              ) : (
                <Link href={`/governance/${p.id}`} className="wg-vote-link">
                  You have not voted. Vote
                </Link>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
