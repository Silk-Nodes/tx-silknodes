"use client";

import { useMemo, useState } from "react";
import { useGovernance } from "@/hooks/useGovernance";
import {
  STATUS_LABELS,
  calcQuorumFraction,
  calcVoteFractions,
  formatRelativeOrAbsolute,
  formatTxAmount,
  type Proposal,
  type ProposalStatus,
} from "@/lib/governance";

type FilterId = "all" | "active" | "passed" | "rejected";

const FILTERS: { id: FilterId; label: string; match: (p: Proposal) => boolean }[] = [
  { id: "all", label: "All", match: () => true },
  { id: "active", label: "Active", match: (p) => p.status === "voting" || p.status === "deposit" },
  { id: "passed", label: "Passed", match: (p) => p.status === "passed" },
  { id: "rejected", label: "Rejected", match: (p) => p.status === "rejected" || p.status === "failed" },
];

export default function GovernanceTab() {
  const { proposals, params, loading, error } = useGovernance();
  const [filter, setFilter] = useState<FilterId>("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const filtered = useMemo(() => {
    const matcher = FILTERS.find((f) => f.id === filter)?.match ?? (() => true);
    return proposals.filter(matcher);
  }, [proposals, filter]);

  const activeCount = useMemo(
    () => proposals.filter((p) => p.status === "voting" || p.status === "deposit").length,
    [proposals],
  );

  return (
    <div className="governance-tab">
      <header className="governance-header">
        <div>
          <h1 className="governance-title">Governance</h1>
          <p className="governance-sub">
            All TX network proposals — voting status, tallies, quorum tracking. Data from chain
            state via Hasura, refreshed every minute.
          </p>
        </div>
        {activeCount > 0 && (
          <div className="governance-active-pill">
            {activeCount} active {activeCount === 1 ? "proposal" : "proposals"}
          </div>
        )}
      </header>

      <div className="governance-filter-row">
        {FILTERS.map((f) => {
          const count = proposals.filter(f.match).length;
          return (
            <button
              key={f.id}
              type="button"
              className={`governance-filter-chip ${filter === f.id ? "active" : ""}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
              <span className="governance-filter-count">{count}</span>
            </button>
          );
        })}
      </div>

      {loading && proposals.length === 0 && (
        <div className="governance-empty">Loading proposals…</div>
      )}
      {error && (
        <div className="governance-empty governance-error">
          Couldn't load governance data. Retrying every minute. ({error})
        </div>
      )}
      {!loading && filtered.length === 0 && proposals.length > 0 && (
        <div className="governance-empty">No proposals match this filter.</div>
      )}

      <div className="governance-list">
        {filtered.map((p) => (
          <ProposalRow
            key={p.id}
            proposal={p}
            quorumRequired={params?.quorum ?? 0.4}
            yesThreshold={params?.threshold ?? 0.5}
            vetoThreshold={params?.vetoThreshold ?? 0.334}
            expanded={expandedId === p.id}
            onToggle={() => setExpandedId(expandedId === p.id ? null : p.id)}
          />
        ))}
      </div>

      <footer className="governance-footer">
        <span>
          Source: <code>cosmos.gov</code> via Coreum Hasura. Quorum threshold{" "}
          {((params?.quorum ?? 0.4) * 100).toFixed(0)}%, pass threshold{" "}
          {((params?.threshold ?? 0.5) * 100).toFixed(0)}%, veto threshold{" "}
          {((params?.vetoThreshold ?? 0.334) * 100).toFixed(1)}%.
        </span>
      </footer>
    </div>
  );
}

interface ProposalRowProps {
  proposal: Proposal;
  quorumRequired: number;
  yesThreshold: number;
  vetoThreshold: number;
  expanded: boolean;
  onToggle: () => void;
}

function ProposalRow({
  proposal,
  quorumRequired,
  yesThreshold,
  vetoThreshold,
  expanded,
  onToggle,
}: ProposalRowProps) {
  const now = Date.now();
  const { tally, status } = proposal;
  const quorumPct = calcQuorumFraction(tally);
  const { yesPct, noPct, vetoPct, abstainPct } = calcVoteFractions(tally);
  const quorumMet = quorumPct >= quorumRequired;

  return (
    <div className={`governance-card status-${status}`}>
      <button
        type="button"
        className="governance-card-head"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <div className="governance-card-id">#{proposal.id}</div>
        <div className="governance-card-title-block">
          <div className="governance-card-title">{proposal.title}</div>
          <div className="governance-card-meta">
            {status === "voting" && proposal.votingEndTime && (
              <>Voting ends {formatRelativeOrAbsolute(proposal.votingEndTime, now)}</>
            )}
            {status === "deposit" && (
              <>In deposit period</>
            )}
            {(status === "passed" || status === "rejected" || status === "failed") &&
              proposal.votingEndTime && (
                <>Ended {formatRelativeOrAbsolute(proposal.votingEndTime, now)}</>
              )}
          </div>
        </div>
        <StatusBadge status={status} />
      </button>

      <div className="governance-card-tally">
        <TallyBar
          yes={tally.yes}
          no={tally.no}
          veto={tally.noWithVeto}
          abstain={tally.abstain}
        />
        <div className="governance-card-tally-numbers">
          <span className="tn-yes">Yes {(yesPct * 100).toFixed(1)}%</span>
          <span className="tn-no">No {(noPct * 100).toFixed(1)}%</span>
          {vetoPct > 0 && (
            <span className="tn-veto">Veto {(vetoPct * 100).toFixed(1)}%</span>
          )}
          {abstainPct > 0 && (
            <span className="tn-abstain">Abstain {(abstainPct * 100).toFixed(1)}%</span>
          )}
        </div>
        <QuorumBar
          quorumPct={quorumPct}
          quorumRequired={quorumRequired}
          met={quorumMet}
          totalVoted={tally.totalVoted}
          bonded={tally.bondedSnapshot}
        />
      </div>

      {expanded && (
        <div className="governance-card-detail">
          <div className="governance-detail-section">
            <div className="governance-detail-label">Description</div>
            <div className="governance-detail-text">
              {proposal.description || <em>No description provided.</em>}
            </div>
          </div>
          <div className="governance-detail-grid">
            <div>
              <div className="governance-detail-label">Proposer</div>
              <div className="governance-detail-text mono">
                {proposal.proposer ? truncateAddr(proposal.proposer) : "—"}
              </div>
            </div>
            <div>
              <div className="governance-detail-label">Submitted</div>
              <div className="governance-detail-text">
                {formatRelativeOrAbsolute(proposal.submitTime, now)}
              </div>
            </div>
            <div>
              <div className="governance-detail-label">Voting period</div>
              <div className="governance-detail-text">
                {proposal.votingStartTime && proposal.votingEndTime
                  ? `${proposal.votingStartTime.slice(0, 10)} → ${proposal.votingEndTime.slice(0, 10)}`
                  : "—"}
              </div>
            </div>
            <div>
              <div className="governance-detail-label">Total voted</div>
              <div className="governance-detail-text">
                {formatTxAmount(tally.totalVoted)} TX of{" "}
                {formatTxAmount(tally.bondedSnapshot)} bonded
              </div>
            </div>
          </div>
          <div className="governance-detail-fineprint">
            Pass requires Yes ≥ {(yesThreshold * 100).toFixed(0)}% of non-abstain
            votes and quorum ≥ {(quorumRequired * 100).toFixed(0)}% of bonded
            stake. Veto threshold {(vetoThreshold * 100).toFixed(1)}%.
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: ProposalStatus }) {
  return (
    <span className={`governance-status-badge status-${status}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

function TallyBar({ yes, no, veto, abstain }: { yes: number; no: number; veto: number; abstain: number }) {
  const total = yes + no + veto + abstain;
  if (total <= 0) {
    return <div className="governance-tally-bar empty" />;
  }
  const yesP = (yes / total) * 100;
  const noP = (no / total) * 100;
  const vetoP = (veto / total) * 100;
  const abstainP = (abstain / total) * 100;
  return (
    <div className="governance-tally-bar" role="img" aria-label="Vote breakdown">
      <div className="tb-yes" style={{ width: `${yesP}%` }} />
      <div className="tb-no" style={{ width: `${noP}%` }} />
      <div className="tb-veto" style={{ width: `${vetoP}%` }} />
      <div className="tb-abstain" style={{ width: `${abstainP}%` }} />
    </div>
  );
}

function QuorumBar({
  quorumPct,
  quorumRequired,
  met,
  totalVoted,
  bonded,
}: {
  quorumPct: number;
  quorumRequired: number;
  met: boolean;
  totalVoted: number;
  bonded: number;
}) {
  const pct = Math.min(100, quorumPct * 100);
  const requiredPct = quorumRequired * 100;
  return (
    <div className="governance-quorum">
      <div className="governance-quorum-bar">
        <div
          className={`governance-quorum-fill ${met ? "met" : "unmet"}`}
          style={{ width: `${pct}%` }}
        />
        <div
          className="governance-quorum-target"
          style={{ left: `${requiredPct}%` }}
          title={`Quorum required: ${requiredPct.toFixed(0)}%`}
        />
      </div>
      <div className="governance-quorum-label">
        Quorum: <strong>{(quorumPct * 100).toFixed(1)}%</strong> of bonded stake voted
        {" — "}
        {met ? "met" : `need ${(quorumRequired * 100).toFixed(0)}%`}
        {" · "}
        <span style={{ opacity: 0.65 }}>
          {formatTxAmount(totalVoted)} / {formatTxAmount(bonded)} TX
        </span>
      </div>
    </div>
  );
}

function truncateAddr(addr: string): string {
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 10)}…${addr.slice(-6)}`;
}
