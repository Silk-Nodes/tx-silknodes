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
  const history = useMemo(
    () => proposals.filter((p) => p.status !== "voting" && p.status !== "deposit"),
    [proposals],
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
            Click any proposal for the full breakdown.
          </p>
        </div>
      </header>

      {/* Chain-wide stats strip */}
      <div className="gov-stats-strip">
        <StatChip label="Live" value={String(active.length)} tone={active.length > 0 ? "ok" : "muted"} />
        <StatChip label="Passed" value={String(chainStats.passed)} tone="ok" />
        <StatChip label="Rejected" value={String(chainStats.rejected)} tone="warn" />
        <StatChip label="Total" value={String(chainStats.total)} tone="muted" />
        <StatChip
          label="Avg turnout"
          value={`${(chainStats.avgQuorum * 100).toFixed(0)}%`}
          tone={chainStats.avgQuorum >= quorum ? "ok" : "warn"}
        />
        <StatChip label="Required quorum" value={`${(quorum * 100).toFixed(0)}%`} tone="muted" />
      </div>

      {/* LIVE HERO */}
      <section className="gov-hero">
        <div className="gov-hero-head">
          <h2 className="gov-hero-title">Live proposals</h2>
          <span className="gov-hero-count">{active.length}</span>
        </div>
        {active.length === 0 ? (
          <div className="gov-hero-empty">
            <div className="gov-hero-empty-headline">No proposals are currently live.</div>
            <div className="gov-hero-empty-sub">
              When a new proposal enters the voting period, it&apos;ll appear here.
              Until then, browse the history below or check back later.
            </div>
          </div>
        ) : (
          <div className="gov-hero-grid">
            {active.map((p) => (
              <ActiveProposalCard
                key={p.id}
                proposal={p}
                quorumRequired={quorum}
                yesThreshold={yesThreshold}
                vetoThreshold={vetoThreshold}
              />
            ))}
          </div>
        )}
      </section>

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
              {historyOpen ? "Hide" : "View"} past proposals
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

      <footer className="governance-footer">
        <span>
          Source: <code>cosmos.gov</code> via Coreum Hasura. Quorum {(quorum * 100).toFixed(0)}%,
          pass threshold {(yesThreshold * 100).toFixed(0)}%, veto threshold{" "}
          {(vetoThreshold * 100).toFixed(1)}%.
        </span>
      </footer>
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

// Big actionable card for ACTIVE proposals. Shows the live outcome banner
// so a delegator can see "I need to vote on this NOW" at a glance.
function ActiveProposalCard({
  proposal,
  quorumRequired,
  yesThreshold,
  vetoThreshold,
}: {
  proposal: Proposal;
  quorumRequired: number;
  yesThreshold: number;
  vetoThreshold: number;
}) {
  const now = Date.now();
  const { tally } = proposal;
  const quorumPct = calcQuorumFraction(tally);
  const fractions = calcVoteFractions(tally);
  const projection = projectActiveVote(tally, quorumRequired, yesThreshold, vetoThreshold);

  const projectionTone =
    projection.outcome === "passing" ? "ok"
    : projection.outcome === "failing-veto" ? "veto"
    : "warn";
  const projectionLabel =
    projection.outcome === "passing" ? "Currently PASSING"
    : projection.outcome === "failing-quorum" ? "FAILING - quorum"
    : projection.outcome === "failing-veto" ? "FAILING - vetoed"
    : "FAILING - threshold";

  return (
    <Link
      href={`/governance/${proposal.id}`}
      className="gov-active-card"
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
        <span className="gov-mini-label vote-yes">Yes {(fractions.yesPct * 100).toFixed(1)}%</span>
        <span className="gov-mini-label vote-no">No {(fractions.noPct * 100).toFixed(1)}%</span>
        <span className="gov-mini-label vote-veto">Veto {(fractions.vetoPct * 100).toFixed(1)}%</span>
        <span className="gov-mini-label vote-abstain">Abs {(fractions.abstainPct * 100).toFixed(1)}%</span>
      </div>

      <div className="gov-active-footer">
        <div className="gov-active-stat">
          <span className="gov-active-stat-label">Quorum</span>
          <span className={`gov-active-stat-value ${quorumPct >= quorumRequired ? "ok" : "warn"}`}>
            {(quorumPct * 100).toFixed(1)}% / {(quorumRequired * 100).toFixed(0)}%
          </span>
        </div>
        <div className="gov-active-stat">
          <span className="gov-active-stat-label">Ends</span>
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
        <span className="gov-active-cta">Open →</span>
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
