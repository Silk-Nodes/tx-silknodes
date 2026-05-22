"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useGovernance } from "@/hooks/useGovernance";
import {
  STATUS_LABELS,
  calcQuorumFraction,
  calcVoteFractions,
  formatRelativeOrAbsolute,
  formatTxAmount,
  type Proposal,
} from "@/lib/governance";
import { projectActiveVote } from "@/lib/governance-explainer";

// Active-first landing. Active proposals are presented as big actionable
// cards. History is collapsed behind a single link, since most visitors
// are here to act on what's live now.
export default function GovernanceTab() {
  const { proposals, params, loading, error } = useGovernance();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState("");

  const active = useMemo(
    () => proposals.filter((p) => p.status === "voting" || p.status === "deposit"),
    [proposals],
  );
  // When nothing is live, surface the most recent proposal in its slot.
  // Sorted by id desc; id correlates with chronological order.
  const latest = useMemo(() => {
    if (active.length > 0) return null;
    return [...proposals].sort((a, b) => b.id - a.id)[0] ?? null;
  }, [proposals, active.length]);
  const history = useMemo(
    () => {
      const base = proposals.filter((p) => p.status !== "voting" && p.status !== "deposit");
      // If the latest proposal is being featured, hide it from the history
      // table to avoid duplication.
      if (latest) return base.filter((p) => p.id !== latest.id);
      return base;
    },
    [proposals, latest],
  );
  const filteredHistory = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    if (!q) return history;
    return history.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        String(p.id).includes(q) ||
        p.type.toLowerCase().includes(q),
    );
  }, [history, historySearch]);

  const chainStats = useMemo(() => ({
    total: proposals.length,
    passed: proposals.filter((p) => p.status === "passed").length,
    rejected: proposals.filter((p) => p.status === "rejected" || p.status === "failed").length,
    avgQuorum: proposals.length === 0
      ? 0
      : proposals.reduce((sum, p) => sum + calcQuorumFraction(p.tally), 0) / proposals.length,
  }), [proposals]);

  const quorum = params?.quorum ?? 0.4;
  const yesThreshold = params?.threshold ?? 0.5;
  const vetoThreshold = params?.vetoThreshold ?? 0.334;

  return (
    <div className="governance-tab">
      <header className="governance-header">
        <div>
          <h1 className="governance-title">Governance</h1>
          <p className="governance-sub">
            What&apos;s live on TX Network right now, plus the analytics to act on it.
          </p>
        </div>
      </header>

      {/* Paired stats: on wide screens the two groups sit side by side
          so the page top reads as a dashboard, not a stack. */}
      <div className="gov-stats-grid">
        <section className="gov-stats-group">
          <div className="gov-stats-group-label">Proposal status</div>
          <div className="gov-stats-row">
            <StatChip label="Live" value={String(active.length)} tone={active.length > 0 ? "ok" : "muted"} />
            <StatChip label="Passed" value={String(chainStats.passed)} tone="ok" />
            <StatChip label="Rejected" value={String(chainStats.rejected)} tone="warn" />
            <StatChip label="Total" value={String(chainStats.total)} tone="muted" />
          </div>
        </section>

        <section className="gov-stats-group">
          <div className="gov-stats-group-label">Governance health</div>
          <GovernanceHealthBar
            avgTurnout={chainStats.avgQuorum}
            quorumRequired={quorum}
            proposalCount={proposals.length}
          />
        </section>
      </div>

      {/* Live proposals section - always shown so the empty state has its
          own dedicated slot instead of competing with the latest card */}
      <section className="gov-section">
        <div className="gov-section-head">
          <h2 className="gov-section-title">Live proposals</h2>
          <span className="gov-section-count">{active.length}</span>
        </div>
        {active.length === 0 ? (
          <p className="gov-section-empty-inline">
            No active proposals right now. New proposals appear here as soon as
            they enter the voting period.
          </p>
        ) : (
          <div className="gov-hero-grid">
            {active.map((p) => (
              <ActiveProposalCard
                key={p.id}
                proposal={p}
                quorumRequired={quorum}
                yesThreshold={yesThreshold}
                vetoThreshold={vetoThreshold}
                featured
              />
            ))}
          </div>
        )}
      </section>

      {/* Latest proposal section - only when nothing live, so the empty
          state above and this featured card stop competing visually */}
      {active.length === 0 && latest && (
        <section className="gov-section">
          <div className="gov-section-head">
            <h2 className="gov-section-title">Latest proposal</h2>
            <span className="gov-section-sub">The most recent decision on TX Network.</span>
          </div>
          <div className="gov-hero-grid">
            <ActiveProposalCard
              proposal={latest}
              quorumRequired={quorum}
              yesThreshold={yesThreshold}
              vetoThreshold={vetoThreshold}
              featured
            />
          </div>
        </section>
      )}

      {loading && proposals.length === 0 && (
        <div className="governance-empty">Loading proposals...</div>
      )}
      {error && (
        <div className="governance-empty governance-error">
          Couldn&apos;t load governance data. Retrying every minute. ({error})
        </div>
      )}

      {/* HISTORY (collapsed) */}
      {history.length > 0 && (
        <section className="gov-history">
          <button
            type="button"
            className="gov-history-toggle"
            onClick={() => setHistoryOpen((v) => !v)}
            aria-expanded={historyOpen}
          >
            <span className="gov-history-toggle-label">
              {historyOpen ? "Hide" : "Browse"} past proposals
            </span>
            <span className="gov-history-toggle-count">{history.length}</span>
            <span className="gov-history-toggle-chev">{historyOpen ? "▴" : "▾"}</span>
          </button>

          {historyOpen && (
            <div className="gov-history-body">
              <input
                type="search"
                className="gov-history-search"
                placeholder="Search past proposals..."
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
              />
              <div className="gov-history-table">
                {filteredHistory.length === 0 ? (
                  <div className="governance-empty">No proposals match &ldquo;{historySearch}&rdquo;.</div>
                ) : (
                  filteredHistory.map((p) => <HistoryRow key={p.id} proposal={p} quorumRequired={quorum} />)
                )}
              </div>
            </div>
          )}
        </section>
      )}

    </div>
  );
}

// Single bar showing avg turnout across all proposals vs the chain's
// required quorum. The pill sits inline with the number, the quorum
// threshold gets a notched tick with an inline label so it's actually
// visible (the previous version had a hairline you couldn't see).
function GovernanceHealthBar({
  avgTurnout, quorumRequired, proposalCount,
}: {
  avgTurnout: number;
  quorumRequired: number;
  proposalCount: number;
}) {
  const pct = Math.max(0, Math.min(1, avgTurnout));
  const reqPct = Math.max(0, Math.min(1, quorumRequired));
  const healthy = avgTurnout >= quorumRequired;
  const delta = Math.round((avgTurnout - quorumRequired) * 100);
  return (
    <div className={`gov-health ${healthy ? "ok" : "warn"}`}>
      <div className="gov-health-top">
        <div className="gov-health-headline">
          <span className="gov-health-pct">{(pct * 100).toFixed(0)}%</span>
          <span className={`gov-health-status ${healthy ? "ok" : "warn"}`}>
            {healthy ? "Healthy" : "Below quorum"}
          </span>
        </div>
        <div className="gov-health-delta">
          {delta >= 0 ? `+${delta}` : delta} pts vs required
        </div>
      </div>
      <div className="gov-health-label">
        Average turnout across {proposalCount} proposals
      </div>
      <div className="gov-health-bar-wrap">
        <div
          className="gov-health-bar"
          role="img"
          aria-label={`Average turnout ${(pct * 100).toFixed(0)}%, required quorum ${(reqPct * 100).toFixed(0)}%`}
        >
          <div className="gov-health-fill" style={{ width: `${pct * 100}%` }} />
          <div className="gov-health-tick" style={{ left: `${reqPct * 100}%` }}>
            <div className="gov-health-tick-label">{(reqPct * 100).toFixed(0)}% quorum</div>
            <div className="gov-health-tick-line" />
          </div>
        </div>
        <div className="gov-health-axis">
          <span>0%</span>
          <span>100%</span>
        </div>
      </div>
    </div>
  );
}

function StatChip({ label, value, tone }: { label: string; value: string; tone: "ok" | "warn" | "muted" }) {
  return (
    <div className={`gov-chip gov-chip-${tone}`}>
      <span className="gov-chip-value">{value}</span>
      <span className="gov-chip-label">{label}</span>
    </div>
  );
}

// Big actionable card for ACTIVE proposals (or featured latest when nothing
// is live). Shows the live outcome banner so a delegator can see "I need to
// vote on this NOW" at a glance. For settled proposals, the banner shows
// the final status instead of a projection.
function ActiveProposalCard({
  proposal,
  quorumRequired,
  yesThreshold,
  vetoThreshold,
  featured = false,
}: {
  proposal: Proposal;
  quorumRequired: number;
  yesThreshold: number;
  vetoThreshold: number;
  featured?: boolean;
}) {
  const now = Date.now();
  const { tally, status } = proposal;
  const quorumPct = calcQuorumFraction(tally);
  const fractions = calcVoteFractions(tally);
  const isLive = status === "voting" || status === "deposit";
  const projection = isLive
    ? projectActiveVote(tally, quorumRequired, yesThreshold, vetoThreshold)
    : null;

  // Banner copy + tone: live = projection, settled = final outcome.
  const projectionTone = projection
    ? projection.outcome === "passing" ? "ok"
      : projection.outcome === "failing-veto" ? "veto"
      : "warn"
    : status === "passed" ? "ok"
    : status === "rejected" || status === "failed" ? "warn"
    : "neutral";
  const projectionLabel = projection
    ? projection.outcome === "passing" ? "Currently PASSING"
      : projection.outcome === "failing-quorum" ? "FAILING - quorum"
      : projection.outcome === "failing-veto" ? "FAILING - vetoed"
      : "FAILING - threshold"
    : status === "passed" ? "PASSED"
    : status === "rejected" ? "REJECTED"
    : status === "failed" ? "FAILED"
    : status.toUpperCase();

  return (
    <Link
      href={`/governance/${proposal.id}`}
      className={`gov-active-card ${featured ? "featured" : ""}`}
    >
      <div className="gov-active-head">
        <span className="governance-type-pill">{proposal.type}</span>
        <span className={`gov-active-banner banner-${projectionTone}`}>
          {projectionLabel}
        </span>
      </div>
      <div className="gov-active-title">
        <span className="gov-active-id">#{proposal.id}</span>
        {proposal.title}
      </div>

      <div className="gov-active-mini-bar">
        <div className="gov-mini-yes" style={{ width: `${(fractions.yesPct * 100).toFixed(2)}%` }} />
        <div className="gov-mini-no" style={{ width: `${(fractions.noPct * 100).toFixed(2)}%` }} />
        <div className="gov-mini-veto" style={{ width: `${(fractions.vetoPct * 100).toFixed(2)}%` }} />
        <div className="gov-mini-abstain" style={{ width: `${(fractions.abstainPct * 100).toFixed(2)}%` }} />
      </div>
      <div className="gov-active-bar-labels">
        {/* Hide 0% sides so unanimous outcomes don't show three "0.0%"
            labels. We only print labels for sides that actually got votes. */}
        {fractions.yesPct > 0 && (
          <span className="gov-mini-label vote-yes">Yes {(fractions.yesPct * 100).toFixed(1)}%</span>
        )}
        {fractions.noPct > 0 && (
          <span className="gov-mini-label vote-no">No {(fractions.noPct * 100).toFixed(1)}%</span>
        )}
        {fractions.vetoPct > 0 && (
          <span className="gov-mini-label vote-veto">Veto {(fractions.vetoPct * 100).toFixed(1)}%</span>
        )}
        {fractions.abstainPct > 0 && (
          <span className="gov-mini-label vote-abstain">Abs {(fractions.abstainPct * 100).toFixed(1)}%</span>
        )}
      </div>

      <div className="gov-active-footer">
        <div className="gov-active-stat">
          <span className="gov-active-stat-label">Quorum</span>
          <span className={`gov-active-stat-value ${quorumPct >= quorumRequired ? "ok" : "warn"}`}>
            {(quorumPct * 100).toFixed(1)}% / {(quorumRequired * 100).toFixed(0)}%
          </span>
        </div>
        <div className="gov-active-stat">
          <span className="gov-active-stat-label">{isLive ? "Ends" : "Ended"}</span>
          <span className="gov-active-stat-value">
            {proposal.votingEndTime
              ? formatRelativeOrAbsolute(proposal.votingEndTime, now)
              : "TBD"}
          </span>
        </div>
        <div className="gov-active-stat">
          <span className="gov-active-stat-label">Voted</span>
          <span className="gov-active-stat-value">{formatTxAmount(tally.totalVoted)} TX</span>
        </div>
        <span className="gov-active-cta">Full breakdown →</span>
      </div>
    </Link>
  );
}

function HistoryRow({
  proposal,
  quorumRequired,
}: {
  proposal: Proposal;
  quorumRequired: number;
}) {
  const fractions = calcVoteFractions(proposal.tally);
  const quorumPct = calcQuorumFraction(proposal.tally);
  return (
    <Link href={`/governance/${proposal.id}`} className="gov-history-row">
      <span className="gov-history-id">#{proposal.id}</span>
      <span className="gov-history-title">{proposal.title}</span>
      <span className="governance-type-pill">{proposal.type}</span>
      <span className={`gov-history-status status-${proposal.status}`}>
        {STATUS_LABELS[proposal.status]}
      </span>
      <span className="gov-history-yes">Yes {(fractions.yesPct * 100).toFixed(0)}%</span>
      <span className={`gov-history-quorum ${quorumPct >= quorumRequired ? "ok" : "warn"}`}>
        Q {(quorumPct * 100).toFixed(0)}%
      </span>
      <span className="gov-history-chev">→</span>
    </Link>
  );
}
