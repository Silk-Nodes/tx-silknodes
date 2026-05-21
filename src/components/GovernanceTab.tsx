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
import { explainProposal, projectActiveVote } from "@/lib/governance-explainer";

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
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const stats = useMemo(() => {
    const counts = {
      total: proposals.length,
      active: proposals.filter((p) => p.status === "voting" || p.status === "deposit").length,
      passed: proposals.filter((p) => p.status === "passed").length,
      rejected: proposals.filter((p) => p.status === "rejected" || p.status === "failed").length,
    };
    return counts;
  }, [proposals]);

  const livePool = useMemo(
    () => proposals.filter((p) => p.status === "voting" || p.status === "deposit"),
    [proposals],
  );

  const filtered = useMemo(() => {
    const matcher = FILTERS.find((f) => f.id === filter)?.match ?? (() => true);
    const q = search.trim().toLowerCase();
    return proposals.filter((p) => {
      if (!matcher(p)) return false;
      if (!q) return true;
      return (
        p.title.toLowerCase().includes(q) ||
        String(p.id).includes(q) ||
        p.type.toLowerCase().includes(q)
      );
    });
  }, [proposals, filter, search]);

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
      </header>

      <StatsPanel
        total={stats.total}
        active={stats.active}
        passed={stats.passed}
        rejected={stats.rejected}
      />

      {livePool.length > 0 && (
        <section className="governance-section">
          <h2 className="governance-section-title">
            Live proposals <span className="governance-section-count">{livePool.length}</span>
          </h2>
          <div className="governance-list">
            {livePool.map((p) => (
              <ProposalCard
                key={p.id}
                proposal={p}
                quorumRequired={params?.quorum ?? 0.4}
                yesThreshold={params?.threshold ?? 0.5}
                vetoThreshold={params?.vetoThreshold ?? 0.334}
                expanded={expandedId === p.id}
                onToggle={() => setExpandedId(expandedId === p.id ? null : p.id)}
                highlight
              />
            ))}
          </div>
        </section>
      )}

      <section className="governance-section">
        <div className="governance-section-toolbar">
          <h2 className="governance-section-title">
            All proposals{" "}
            <span className="governance-section-count">{filtered.length}</span>
          </h2>
          <div className="governance-section-controls">
            <div className="governance-filter-row">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`governance-filter-chip ${filter === f.id ? "active" : ""}`}
                  onClick={() => setFilter(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <input
              type="text"
              className="governance-search"
              placeholder="Search by title, ID, or type..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
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
          <div className="governance-empty">
            {search
              ? `No proposals match "${search}".`
              : "No proposals match this filter."}
          </div>
        )}

        <div className="governance-list">
          {filtered.map((p) => (
            <ProposalCard
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
      </section>

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

function StatsPanel({
  total,
  active,
  passed,
  rejected,
}: {
  total: number;
  active: number;
  passed: number;
  rejected: number;
}) {
  return (
    <div className="governance-stats">
      <div className="governance-stat">
        <div className="governance-stat-label">Total proposals</div>
        <div className="governance-stat-value">{total}</div>
      </div>
      <div className="governance-stat governance-stat-active">
        <div className="governance-stat-label">Active</div>
        <div className="governance-stat-value">{active}</div>
      </div>
      <div className="governance-stat governance-stat-passed">
        <div className="governance-stat-label">Passed</div>
        <div className="governance-stat-value">{passed}</div>
      </div>
      <div className="governance-stat governance-stat-rejected">
        <div className="governance-stat-label">Rejected</div>
        <div className="governance-stat-value">{rejected}</div>
      </div>
    </div>
  );
}

interface ProposalCardProps {
  proposal: Proposal;
  quorumRequired: number;
  yesThreshold: number;
  vetoThreshold: number;
  expanded: boolean;
  onToggle: () => void;
  highlight?: boolean;
}

function ProposalCard({
  proposal,
  quorumRequired,
  yesThreshold,
  vetoThreshold,
  expanded,
  onToggle,
  highlight,
}: ProposalCardProps) {
  const now = Date.now();
  const { tally, status } = proposal;
  const { yesPct, noPct } = calcVoteFractions(tally);
  const isActive = status === "voting" || status === "deposit";

  // Compact summary: one number that tells you the outcome at a glance.
  // For passed / rejected: the YES %. For active: lead margin or quorum status.
  const summaryText = (() => {
    if (tally.totalVoted <= 0) return "No votes yet";
    if (status === "voting" || status === "deposit") {
      return `Yes ${(yesPct * 100).toFixed(0)}% · No ${(noPct * 100).toFixed(0)}%`;
    }
    return `Yes ${(yesPct * 100).toFixed(0)}%`;
  })();

  return (
    <div className={`governance-card status-${status} ${highlight ? "highlight" : ""} ${expanded ? "expanded" : ""}`}>
      <button
        type="button"
        className="governance-card-row"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span className="governance-card-id">#{proposal.id}</span>
        <span className="governance-card-title">{proposal.title}</span>
        <TypePill type={proposal.type} rawType={proposal.rawType} />
        <span className="governance-card-time">
          {proposal.votingEndTime
            ? isActive
              ? `ends ${formatRelativeOrAbsolute(proposal.votingEndTime, now)}`
              : `${formatRelativeOrAbsolute(proposal.votingEndTime, now)}`
            : ""}
        </span>
        <span className="governance-card-summary">{summaryText}</span>
        <StatusBadge status={status} />
        <span className="governance-card-chevron" aria-hidden="true">
          {expanded ? "▾" : "▸"}
        </span>
      </button>

      {expanded && (
        <div className="governance-card-detail">
          <ExplainerSection proposal={proposal} />

          {status === "voting" && (
            <ProjectionSection
              proposal={proposal}
              quorumRequired={quorumRequired}
              yesThreshold={yesThreshold}
              vetoThreshold={vetoThreshold}
            />
          )}

          {/* Vote tally — only visible when expanded. */}
          <div className="governance-detail-section">
            <div className="governance-detail-label">Vote tally</div>
            <div className="governance-vote-cards">
              <VoteCard label="Yes" amount={tally.yes} pct={calcVoteFractions(tally).yesPct} kind="yes" />
              <VoteCard label="No" amount={tally.no} pct={calcVoteFractions(tally).noPct} kind="no" />
              <VoteCard label="Veto" amount={tally.noWithVeto} pct={calcVoteFractions(tally).vetoPct} kind="veto" />
              <VoteCard label="Abstain" amount={tally.abstain} pct={calcVoteFractions(tally).abstainPct} kind="abstain" />
            </div>
            <TallyBar
              yes={tally.yes}
              no={tally.no}
              veto={tally.noWithVeto}
              abstain={tally.abstain}
            />
            <QuorumBar
              quorumPct={calcQuorumFraction(tally)}
              quorumRequired={quorumRequired}
              met={calcQuorumFraction(tally) >= quorumRequired}
              totalVoted={tally.totalVoted}
              bonded={tally.bondedSnapshot}
            />
          </div>

          <div className="governance-detail-section">
            <div className="governance-detail-label">Full description</div>
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
          </div>
          <div className="governance-detail-fineprint">
            Pass requires Yes ≥ {(yesThreshold * 100).toFixed(0)}% of non-abstain votes and quorum
            ≥ {(quorumRequired * 100).toFixed(0)}% of bonded stake. Veto threshold{" "}
            {(vetoThreshold * 100).toFixed(1)}%.
          </div>
        </div>
      )}
    </div>
  );
}

function VoteCard({
  label,
  amount,
  pct,
  kind,
}: {
  label: string;
  amount: number;
  pct: number;
  kind: "yes" | "no" | "veto" | "abstain";
}) {
  return (
    <div className={`governance-vote-card vote-${kind}`}>
      <div className="governance-vote-label">{label}</div>
      <div className="governance-vote-pct">{(pct * 100).toFixed(2)}%</div>
      <div className="governance-vote-amount">{formatTxAmount(amount)} TX</div>
    </div>
  );
}

function TypePill({ type, rawType }: { type: string; rawType: string }) {
  return (
    <span className="governance-type-pill" title={rawType || type}>
      {type}
    </span>
  );
}

function StatusBadge({ status }: { status: ProposalStatus }) {
  return (
    <span className={`governance-status-badge status-${status}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

function TallyBar({
  yes,
  no,
  veto,
  abstain,
}: {
  yes: number;
  no: number;
  veto: number;
  abstain: number;
}) {
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

function ExplainerSection({ proposal }: { proposal: Proposal }) {
  const explainer = explainProposal(proposal);
  return (
    <div className="governance-explainer">
      <div className="governance-explainer-head">
        <span className="governance-explainer-icon" aria-hidden="true">
          📋
        </span>
        <span className="governance-explainer-headline">{explainer.headline}</span>
      </div>
      <ul className="governance-explainer-bullets">
        {explainer.bullets.map((b) => (
          <li key={b.label}>
            <span className="governance-explainer-label">{b.label}</span>
            <span className="governance-explainer-value">{b.value}</span>
          </li>
        ))}
      </ul>
      {explainer.unrecognized && (
        <div className="governance-explainer-fineprint">
          We don't have a structured explainer for this proposal type yet — defaulting to the raw
          description below.
        </div>
      )}
    </div>
  );
}

function ProjectionSection({
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
  const projection = projectActiveVote(
    proposal.tally,
    quorumRequired,
    yesThreshold,
    vetoThreshold,
  );
  const klass =
    projection.outcome === "passing"
      ? "outcome-pass"
      : projection.outcome === "failing-veto"
      ? "outcome-veto"
      : "outcome-fail";
  const verb =
    projection.outcome === "passing"
      ? "Currently on track to PASS"
      : projection.outcome === "failing-quorum"
      ? "Currently FAILING — quorum not met"
      : projection.outcome === "failing-veto"
      ? "Currently FAILING — vetoed"
      : "Currently FAILING — Yes below threshold";
  return (
    <div className={`governance-projection ${klass}`}>
      <div className="governance-projection-head">
        <span className="governance-projection-icon" aria-hidden="true">
          ⏱
        </span>
        <span className="governance-projection-verb">{verb}</span>
      </div>
      <div className="governance-projection-reason">{projection.reason}</div>
      {projection.unvotedStake > 0 && (
        <div className="governance-projection-side">
          <span className="governance-projection-label">Bonded stake not yet voted</span>
          <span className="governance-projection-value">
            {formatTxAmount(projection.unvotedStake)} TX (
            {(
              (projection.unvotedStake / proposal.tally.bondedSnapshot) *
              100
            ).toFixed(1)}
            % of bonded)
          </span>
        </div>
      )}
      <div className="governance-projection-fineprint">
        Live projection based on current tally and chain quorum / threshold params. Numbers can
        still change until voting ends.
      </div>
    </div>
  );
}
