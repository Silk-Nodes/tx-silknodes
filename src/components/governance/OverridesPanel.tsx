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
type VoteFilter = "all" | "YES" | "NO" | "NO_WITH_VETO" | "ABSTAIN";
type BandId = "all" | "lt10k" | "10k100k" | "100k1m" | "gte1m";

// Voting-power bands, in display TX. Ranges are non-overlapping so the chip
// counts sum to the total and nobody has to guess which side of a boundary
// a wallet landed on.
const BANDS: { id: BandId; label: string; test: (tx: number) => boolean }[] = [
  { id: "all", label: "All", test: () => true },
  { id: "lt10k", label: "< 10K", test: (t) => t < 10_000 },
  { id: "10k100k", label: "10K - 100K", test: (t) => t >= 10_000 && t < 100_000 },
  { id: "100k1m", label: "100K - 1M", test: (t) => t >= 100_000 && t < 1_000_000 },
  { id: "gte1m", label: "1M +", test: (t) => t >= 1_000_000 },
];

// Same ids and tones as the validator table's FILTERS, so a Yes chip is the
// same colour whichever list you are looking at.
const VOTE_FILTERS: { id: VoteFilter; label: string; tone: string }[] = [
  { id: "all", label: "All", tone: "neutral" },
  { id: "YES", label: "Yes", tone: "yes" },
  { id: "NO", label: "No", tone: "no" },
  { id: "NO_WITH_VETO", label: "Veto", tone: "veto" },
  { id: "ABSTAIN", label: "Abstain", tone: "abstain" },
];

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
  const [band, setBand] = useState<BandId>("all");
  const [voteFilter, setVoteFilter] = useState<VoteFilter>("all");
  const [search, setSearch] = useState("");

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
      // Undated (chain-recovered) votes sort last rather than to 1970.
      const at = a.votedAt ? new Date(a.votedAt).getTime() : 0;
      const bt = b.votedAt ? new Date(b.votedAt).getTime() : 0;
      return bt - at;
    });
    return r;
  }, [rows, sortKey]);

  // The band narrows what renders. `sorted` stays whole so the chip counts
  // describe the full set, not the current selection.
  const visible = useMemo(() => {
    const b = BANDS.find((x) => x.id === band) ?? BANDS[0];
    // Search matches the FULL address, not the shortened display form:
    // someone pasting core1q0t0hmg...r8dvgl's middle characters from an
    // explorer must still land on the row that renders as an ellipsis.
    const q = search.trim().toLowerCase();
    return sorted.filter(
      (r) =>
        b.test(r.bondedTotalTX) &&
        (voteFilter === "all" || r.voteOption === voteFilter) &&
        (q === "" || r.voterAddress.toLowerCase().includes(q)),
    );
  }, [sorted, band, voteFilter, search]);

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

      {/* One control row: bands on the left, sort on the right, the same
          shape as the validator table's filter-chips-plus-search line. Two
          stacked rows of near-identical pills read as a mistake. Bands only
          appear once stake has loaded, so counts never render as zero. */}
      {/* Vote filter first: "who voted no" is the question people arrive with,
          power banding is the follow-up. Counts come from `sorted`, so they
          describe the whole set rather than the current power band. */}
      <div className="ovp-controls">
        <span className="ovp-controls-label">Vote</span>
        {VOTE_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`vvt-chip vvt-chip-${f.tone} ${voteFilter === f.id ? "active" : ""}`}
            onClick={() => setVoteFilter(f.id)}
          >
            {f.label}{" "}
            <span className="vvt-chip-count">
              {f.id === "all" ? sorted.length : sorted.filter((r) => r.voteOption === f.id).length}
            </span>
          </button>
        ))}
      </div>

      <div className="ovp-controls">
        {overrides && (
          <>
            <span className="ovp-controls-label">Voting power</span>
            {/* Same .vvt-chip as the validator table's filters, not a
                lookalike: shared classes cannot drift apart. */}
            {BANDS.map((b) => (
              <button
                key={b.id}
                type="button"
                className={`vvt-chip ${band === b.id ? "active" : ""}`}
                onClick={() => setBand(b.id)}
              >
                {b.label} <span className="vvt-chip-count">{sorted.filter((r) => b.test(r.bondedTotalTX)).length}</span>
              </button>
            ))}
          </>
        )}
        <span className="ovp-controls-label ovp-controls-sort">Sort by</span>
        <button
          type="button"
          className={`vvt-chip ${sortKey === "stake" ? "active" : ""}`}
          onClick={() => setSortKey("stake")}
        >
          Voting power
        </button>
        <button
          type="button"
          className={`vvt-chip ${sortKey === "votedAt" ? "active" : ""}`}
          onClick={() => setSortKey("votedAt")}
        >
          Voted at
        </button>
        <input
          type="search"
          className="vvt-search ovp-search"
          placeholder="Search address..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* List */}
      <div className="ovp-list">
        {visible.map((row) => (
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
            <span className="ovp-row-time">{row.votedAt ? relTime(row.votedAt) : ""}</span>
            <span className="ovp-row-chev" aria-hidden="true">→</span>
          </button>
        ))}
        {visible.length === 0 && !loading && (
          <div className="ovp-empty">
            {sorted.length === 0
              ? "No delegator override votes on this proposal."
              : search.trim() !== ""
                ? "No address matches that search in these filters."
                : "No voters match these filters."}
          </div>
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
