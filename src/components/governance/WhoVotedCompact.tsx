"use client";

import { useMemo, useState } from "react";
import type { ValidatorVote, VoteOption } from "@/hooks/useProposalDetail";
import { formatTxAmount } from "@/lib/governance";
import ValidatorVoteTable from "./ValidatorVoteTable";

interface Props {
  validators: ValidatorVote[];
  totalBonded: number;
  highlightAddresses: string[];
}

const VOTE_LABEL: Record<VoteOption, string> = {
  YES: "Yes",
  NO: "No",
  ABSTAIN: "Abstain",
  NO_WITH_VETO: "Veto",
  DID_NOT_VOTE: "Did not vote",
};

// Top-of-page summary: 10 biggest voters in a card list, with non-voters
// visually demoted below. The full sortable, filterable, searchable table
// is hidden behind "View all" so a normal user isn't faced with a 40-row
// spreadsheet on first load.
export default function WhoVotedCompact({ validators, totalBonded, highlightAddresses }: Props) {
  const [expanded, setExpanded] = useState(false);
  const highlightSet = useMemo(
    () => new Set(highlightAddresses.map((a) => a.toLowerCase())),
    [highlightAddresses],
  );

  const voted = useMemo(
    () => validators
      .filter((v) => v.voteOption !== "DID_NOT_VOTE")
      .sort((a, b) => b.bondedStakeTX - a.bondedStakeTX)
      .slice(0, 10),
    [validators],
  );
  const nonVoters = useMemo(
    () => validators
      .filter((v) => v.voteOption === "DID_NOT_VOTE")
      .sort((a, b) => b.bondedStakeTX - a.bondedStakeTX),
    [validators],
  );
  const topNonVoters = nonVoters.slice(0, 5);
  const totalIdleStake = nonVoters.reduce((s, v) => s + v.bondedStakeTX, 0);

  return (
    <div className="wvc">
      {/* Top voters */}
      <div className="wvc-section">
        <div className="wvc-section-label">Top voters</div>
        <div className="wvc-list">
          {voted.map((v, i) => (
            <ValidatorRow
              key={v.consensusAddress}
              v={v}
              rank={i + 1}
              totalBonded={totalBonded}
              isYou={highlightSet.has(v.operatorAddress.toLowerCase())}
            />
          ))}
          {voted.length === 0 && (
            <div className="wvc-empty">No validators voted on this proposal.</div>
          )}
        </div>
      </div>

      {/* Didn't vote - visually demoted */}
      {nonVoters.length > 0 && (
        <div className="wvc-section wvc-nonvoters-section">
          <div className="wvc-section-label wvc-section-label-muted">
            Didn&apos;t vote ({nonVoters.length})
            <span className="wvc-section-sub">
              {formatTxAmount(totalIdleStake)} TX silent
            </span>
          </div>
          <div className="wvc-list wvc-list-muted">
            {topNonVoters.map((v, i) => (
              <ValidatorRow
                key={v.consensusAddress}
                v={v}
                rank={i + 1}
                totalBonded={totalBonded}
                isYou={highlightSet.has(v.operatorAddress.toLowerCase())}
                muted
              />
            ))}
            {nonVoters.length > topNonVoters.length && (
              <div className="wvc-more-muted">
                + {nonVoters.length - topNonVoters.length} more non-voters
              </div>
            )}
          </div>
        </div>
      )}

      {/* Expand to full table */}
      <button
        type="button"
        className="wvc-expand"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {expanded ? "Hide" : "View all"} {validators.length} validators (sortable, filterable)
        <span className="wvc-expand-chev">{expanded ? "▴" : "▾"}</span>
      </button>

      {expanded && (
        <div className="wvc-fulltable">
          <ValidatorVoteTable
            validators={validators}
            totalBonded={totalBonded}
            highlightAddresses={highlightAddresses}
          />
        </div>
      )}
    </div>
  );
}

function ValidatorRow({
  v, rank, totalBonded, isYou, muted = false,
}: {
  v: ValidatorVote;
  rank: number;
  totalBonded: number;
  isYou: boolean;
  muted?: boolean;
}) {
  const pct = totalBonded > 0 ? (v.bondedStakeTX / totalBonded) * 100 : 0;
  return (
    <div className={`wvc-row ${muted ? "wvc-row-muted" : ""} ${isYou ? "wvc-row-you" : ""}`}>
      <span className="wvc-rank">{rank}</span>
      {v.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={v.avatarUrl} alt="" className="wvc-avatar" />
      ) : (
        <span className="wvc-avatar wvc-avatar-fallback">
          {v.moniker.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="wvc-name">
        {v.moniker || "(unnamed)"}
        {isYou && <span className="wvc-you-badge">YOUR VALIDATOR</span>}
      </span>
      <span className="wvc-stake">{formatTxAmount(v.bondedStakeTX)} TX</span>
      <span className="wvc-stake-pct">{pct.toFixed(1)}%</span>
      <span className={`wvc-vote vvt-vote-badge vvt-vote-${v.voteOption.toLowerCase()}`}>
        {VOTE_LABEL[v.voteOption]}
      </span>
    </div>
  );
}
