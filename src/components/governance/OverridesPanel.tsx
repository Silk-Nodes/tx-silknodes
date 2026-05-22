"use client";

import { useMemo, useState } from "react";
import type { ValidatorVote, DelegatorVote } from "@/hooks/useProposalDetail";
import { useProposalOverrides, type OverrideEnrichment } from "@/hooks/useProposalOverrides";
import { formatTxAmount } from "@/lib/governance";
import DelegatorDrawer from "./DelegatorDrawer";

interface Props {
  proposalId: number;
  delegatorVotes: DelegatorVote[]; // fallback / basic list pre-enrichment
  validators: ValidatorVote[];
  totalVoted: number;
  // Only fire the network fetch when the accordion is actually open.
  enabled: boolean;
}

type SortKey = "stake" | "votedAt";

const VOTE_LABEL: Record<string, string> = {
  YES: "Yes",
  NO: "No",
  ABSTAIN: "Abstain",
  NO_WITH_VETO: "Veto",
};

// Enhanced override list: stats header (total power, breakdown by side,
// rebellion rate) + sortable card-rows that open a side drawer with full
// per-delegator detail.
export default function OverridesPanel({
  proposalId, delegatorVotes, validators, totalVoted, enabled,
}: Props) {
  const { overrides, loading, error } = useProposalOverrides(proposalId, enabled);
  const [drawerAddress, setDrawerAddress] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("stake");

  // Build a validator-vote index so we can compute rebellion stats in the
  // header without re-looping per row.
  const validatorByOp = useMemo(() => {
    const m = new Map<string, ValidatorVote>();
    for (const v of validators) m.set(v.operatorAddress.toLowerCase(), v);
    return m;
  }, [validators]);

  // While the enrichment is in flight, render the rows we already have
  // (address + vote + timestamp) so the user sees structure immediately.
  // Enrichment data slots in once it arrives.
  const rows = useMemo(() => {
    if (overrides) return overrides;
    return delegatorVotes.map<OverrideEnrichment>((d) => ({
      voterAddress: d.voterAddress,
      voteOption: d.voteOption,
      votedAt: d.votedAt,
      bondedTotalTX: 0,
      delegations: [],
    }));
  }, [overrides, delegatorVotes]);

  const sorted = useMemo(() => {
    const r = [...rows];
    r.sort((a, b) => {
      if (sortKey === "stake") return b.bondedTotalTX - a.bondedTotalTX;
      return new Date(b.votedAt).getTime() - new Date(a.votedAt).getTime();
    });
    return r;
  }, [rows, sortKey]);

  // Aggregate stats. Only meaningful once enrichment lands.
  const stats = useMemo(() => {
    if (!overrides || overrides.length === 0) return null;
    const byVote: Record<string, number> = { YES: 0, NO: 0, ABSTAIN: 0, NO_WITH_VETO: 0 };
    let totalPower = 0;
    let rebelPower = 0;
    let validatorsOverridden = new Set<string>();
    for (const o of overrides) {
      byVote[o.voteOption] = (byVote[o.voteOption] ?? 0) + o.bondedTotalTX;
      totalPower += o.bondedTotalTX;
      for (const d of o.delegations) {
        const v = validatorByOp.get(d.operatorAddress.toLowerCase());
        if (v && v.voteOption !== "DID_NOT_VOTE" && v.voteOption !== o.voteOption) {
          rebelPower += d.delegatedTX;
          validatorsOverridden.add(d.operatorAddress);
        }
      }
    }
    return {
      totalPower,
      rebelPower,
      validatorsOverridden: validatorsOverridden.size,
      byVote,
    };
  }, [overrides, validatorByOp]);

  const selected = drawerAddress ? rows.find((r) => r.voterAddress === drawerAddress) ?? null : null;
  const sharePct = totalVoted > 0 && stats ? (stats.totalPower / totalVoted) * 100 : 0;

  return (
    <div className="ovp">
      {/* Stats header */}
      {stats && (
        <div className="ovp-stats">
          <div className="ovp-stat-card">
            <div className="ovp-stat-label">Total override power</div>
            <div className="ovp-stat-value">{formatTxAmount(stats.totalPower)} TX</div>
            <div className="ovp-stat-sub">{sharePct.toFixed(2)}% of total voted stake</div>
          </div>
          <div className="ovp-stat-card">
            <div className="ovp-stat-label">Rebelled against validators</div>
            <div className="ovp-stat-value">{formatTxAmount(stats.rebelPower)} TX</div>
            <div className="ovp-stat-sub">
              against {stats.validatorsOverridden} validator{stats.validatorsOverridden === 1 ? "" : "s"}
            </div>
          </div>
          <div className="ovp-stat-card ovp-stat-split">
            <div className="ovp-stat-label">Distribution</div>
            <div className="ovp-stat-splitbar">
              {(["YES", "NO", "NO_WITH_VETO", "ABSTAIN"] as const).map((opt) => {
                const w = stats.totalPower > 0 ? (stats.byVote[opt] / stats.totalPower) * 100 : 0;
                if (w === 0) return null;
                return (
                  <div
                    key={opt}
                    className={`ovp-stat-seg ovp-stat-seg-${opt.toLowerCase()}`}
                    style={{ width: `${w}%` }}
                    title={`${VOTE_LABEL[opt]} ${w.toFixed(1)}%`}
                  />
                );
              })}
            </div>
            <div className="ovp-stat-splitlegend">
              {(["YES", "NO", "NO_WITH_VETO", "ABSTAIN"] as const).map((opt) => {
                if (stats.byVote[opt] === 0) return null;
                return (
                  <span key={opt} className={`ovp-stat-legend ovp-vote-${opt.toLowerCase()}`}>
                    {VOTE_LABEL[opt]} {formatTxAmount(stats.byVote[opt])}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {loading && !overrides && (
        <div className="ovp-loading">Fetching delegator voting power... ({delegatorVotes.length} addresses)</div>
      )}
      {error && (
        <div className="ovp-error">
          Couldn&apos;t enrich override data: {error}. Showing basic vote list.
        </div>
      )}

      {/* Sort controls */}
      <div className="ovp-controls">
        <span className="ovp-controls-label">Sort by</span>
        <button
          type="button"
          className={`ovp-sort ${sortKey === "stake" ? "active" : ""}`}
          onClick={() => setSortKey("stake")}
        >
          Voting power
        </button>
        <button
          type="button"
          className={`ovp-sort ${sortKey === "votedAt" ? "active" : ""}`}
          onClick={() => setSortKey("votedAt")}
        >
          Voted at
        </button>
      </div>

      {/* List */}
      <div className="ovp-list">
        {sorted.map((row) => (
          <button
            key={row.voterAddress}
            type="button"
            className="ovp-row"
            onClick={() => setDrawerAddress(row.voterAddress)}
          >
            <span className="ovp-row-addr mono">{shorten(row.voterAddress)}</span>
            <span className={`vvt-vote-badge vvt-vote-${row.voteOption.toLowerCase()}`}>
              {VOTE_LABEL[row.voteOption] ?? row.voteOption}
            </span>
            <span className="ovp-row-stake">
              {row.bondedTotalTX > 0 ? `${formatTxAmount(row.bondedTotalTX)} TX` : <span className="ovp-row-stake-loading">...</span>}
            </span>
            <span className="ovp-row-time">{relTime(row.votedAt)}</span>
            <span className="ovp-row-chev" aria-hidden="true">→</span>
          </button>
        ))}
        {sorted.length === 0 && !loading && (
          <div className="ovp-empty">No delegator override votes on this proposal.</div>
        )}
      </div>

      <DelegatorDrawer
        override={selected}
        validators={validators}
        onClose={() => setDrawerAddress(null)}
      />
    </div>
  );
}

function shorten(s: string): string {
  if (!s) return "";
  if (s.length <= 18) return s;
  return `${s.slice(0, 12)}...${s.slice(-6)}`;
}

function relTime(iso: string): string {
  try {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return "just now";
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
    return `${Math.floor(ms / 86_400_000)}d ago`;
  } catch {
    return iso;
  }
}
