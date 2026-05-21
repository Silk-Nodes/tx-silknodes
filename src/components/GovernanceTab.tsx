"use client";

import { useEffect, useMemo, useState } from "react";
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
import ProposalDetail from "./governance/ProposalDetail";

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
  // selectedId === null → list view, number → detail view.
  // The URL hash (e.g. #governance/44) is the source of truth so a
  // proposal page can be shared and the back button works.
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Sync from URL hash on mount + when the user navigates back/forward.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const readHash = () => {
      const m = window.location.hash.match(/governance\/(\d+)/);
      setSelectedId(m ? Number(m[1]) : null);
    };
    readHash();
    window.addEventListener("hashchange", readHash);
    return () => window.removeEventListener("hashchange", readHash);
  }, []);

  const openProposal = (id: number) => {
    if (typeof window !== "undefined") {
      window.location.hash = `governance/${id}`;
    }
    setSelectedId(id);
    // Scroll to top so the detail header is visible.
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  };

  const closeProposal = () => {
    if (typeof window !== "undefined") {
      // Replace, not push — so back/forward isn't littered with hash changes.
      const url = window.location.pathname + window.location.search;
      window.history.replaceState(null, "", url);
    }
    setSelectedId(null);
  };

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

  // Detail mode — render after all hooks are called so hook order is stable.
  if (selectedId !== null) {
    const proposal = proposals.find((p) => p.id === selectedId);
    if (!proposal) {
      return (
        <div className="governance-tab">
          <button type="button" className="prop-detail-back" onClick={closeProposal}>
            ← All proposals
          </button>
          <div className="governance-empty">
            {loading ? "Loading proposal…" : `Proposal #${selectedId} not found.`}
          </div>
        </div>
      );
    }
    return (
      <div className="governance-tab">
        <ProposalDetail
          proposal={proposal}
          quorumRequired={params?.quorum ?? 0.4}
          yesThreshold={params?.threshold ?? 0.5}
          vetoThreshold={params?.vetoThreshold ?? 0.334}
          onBack={closeProposal}
        />
      </div>
    );
  }

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
                expanded={false}
                onToggle={() => openProposal(p.id)}
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
              expanded={false}
              onToggle={() => openProposal(p.id)}
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

// (ExplainerSection + ProjectionSection moved to governance/ProposalDetail.tsx —
// they're rendered in the detail tab instead of inline.)
