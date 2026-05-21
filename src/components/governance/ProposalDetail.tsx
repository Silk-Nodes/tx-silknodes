"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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

interface ProposalDetailProps {
  proposal: Proposal;
  quorumRequired: number;
  yesThreshold: number;
  vetoThreshold: number;
  onBack: () => void;
}

type TabId = "explainer" | "summary" | "votes" | "raw";

const TABS: { id: TabId; label: string; badge?: string }[] = [
  { id: "explainer", label: "Explainer" },
  { id: "summary", label: "Summary" },
  { id: "votes", label: "Voters" },
  { id: "raw", label: "Raw" },
];

export default function ProposalDetail({
  proposal,
  quorumRequired,
  yesThreshold,
  vetoThreshold,
  onBack,
}: ProposalDetailProps) {
  const [tab, setTab] = useState<TabId>("explainer");
  const now = Date.now();
  const { tally, status } = proposal;
  const quorumPct = calcQuorumFraction(tally);
  const { yesPct, noPct, vetoPct, abstainPct } = calcVoteFractions(tally);
  const quorumMet = quorumPct >= quorumRequired;
  const winningKind = winningVote(yesPct, noPct, vetoPct);

  return (
    <div className="prop-detail">
      <button type="button" className="prop-detail-back" onClick={onBack}>
        ← All proposals
      </button>

      {/* ── Header ───────────────────────────────────────── */}
      <header className="prop-detail-header">
        <div className="prop-detail-header-meta">
          <span className="governance-type-pill" title={proposal.rawType}>
            {proposal.type}
          </span>
          <span className="prop-detail-status">
            <StatusBadge status={status} />
          </span>
        </div>
        <h1 className="prop-detail-title">
          <span className="prop-detail-title-id">#{proposal.id}</span>
          {proposal.title}
        </h1>
        <div className="prop-detail-voting-time">
          {proposal.votingStartTime && proposal.votingEndTime ? (
            <>
              <span className="prop-detail-voting-label">Voting time:</span>{" "}
              {formatAbsolute(proposal.votingStartTime)} → {formatAbsolute(proposal.votingEndTime)}
            </>
          ) : (
            <>Submitted {formatRelativeOrAbsolute(proposal.submitTime, now)}</>
          )}
        </div>
      </header>

      {/* ── Result + Quorum block ────────────────────────── */}
      <section className="prop-detail-result-row">
        <div className="prop-detail-result-block">
          <div className="prop-detail-stat-label">Proposal Result</div>
          <div className={`prop-detail-result-value status-${status}`}>
            {STATUS_LABELS[status].toUpperCase()}
          </div>
        </div>
        <div className="prop-detail-result-block">
          <div className="prop-detail-stat-label">Turnout / Quorum</div>
          <div className="prop-detail-quorum-value">
            <span className={quorumMet ? "qmet" : "qunmet"}>
              {(quorumPct * 100).toFixed(2)}%
            </span>
            <span className="prop-detail-quorum-sep"> / </span>
            <span className="qref">{(quorumRequired * 100).toFixed(2)}%</span>
          </div>
        </div>
      </section>

      {/* ── 4 big vote cards ─────────────────────────────── */}
      <section className="prop-detail-vote-grid">
        <BigVoteCard
          label="Yes"
          amount={tally.yes}
          pct={yesPct}
          kind="yes"
          winning={winningKind === "yes"}
        />
        <BigVoteCard
          label="No"
          amount={tally.no}
          pct={noPct}
          kind="no"
          winning={winningKind === "no"}
        />
        <BigVoteCard
          label="Veto"
          amount={tally.noWithVeto}
          pct={vetoPct}
          kind="veto"
          winning={winningKind === "veto"}
        />
        <BigVoteCard
          label="Abstain"
          amount={tally.abstain}
          pct={abstainPct}
          kind="abstain"
          winning={false}
        />
      </section>

      {/* ── Sub-tabs ─────────────────────────────────────── */}
      <nav className="prop-detail-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`prop-detail-tab ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.badge && <span className="prop-detail-tab-badge">{t.badge}</span>}
          </button>
        ))}
      </nav>

      <section className="prop-detail-tab-content">
        {tab === "explainer" && (
          <ExplainerTab
            proposal={proposal}
            quorumRequired={quorumRequired}
            yesThreshold={yesThreshold}
            vetoThreshold={vetoThreshold}
            isActive={status === "voting"}
          />
        )}
        {tab === "summary" && <SummaryTab proposal={proposal} />}
        {tab === "votes" && <VotesTab proposal={proposal} />}
        {tab === "raw" && <RawTab proposal={proposal} />}
      </section>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────

function winningVote(yes: number, no: number, veto: number): "yes" | "no" | "veto" | null {
  const max = Math.max(yes, no, veto);
  if (max <= 0) return null;
  if (yes === max) return "yes";
  if (no === max) return "no";
  return "veto";
}

function formatAbsolute(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return iso;
  }
}

function StatusBadge({ status }: { status: ProposalStatus }) {
  return (
    <span className={`governance-status-badge status-${status}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

function BigVoteCard({
  label,
  amount,
  pct,
  kind,
  winning,
}: {
  label: string;
  amount: number;
  pct: number;
  kind: "yes" | "no" | "veto" | "abstain";
  winning: boolean;
}) {
  return (
    <div className={`prop-vote-big vote-${kind} ${winning ? "winning" : ""}`}>
      <div className="prop-vote-big-label">{label}</div>
      <div className="prop-vote-big-pct">{(pct * 100).toFixed(2)}%</div>
      <div className="prop-vote-big-amount">{formatTxAmount(amount)} TX</div>
    </div>
  );
}

// ─── Tab content ──────────────────────────────────────────────

function ExplainerTab({
  proposal,
  quorumRequired,
  yesThreshold,
  vetoThreshold,
  isActive,
}: {
  proposal: Proposal;
  quorumRequired: number;
  yesThreshold: number;
  vetoThreshold: number;
  isActive: boolean;
}) {
  const explainer = explainProposal(proposal);
  return (
    <div className="prop-tab-explainer">
      <div className="prop-explainer-headline">
        {explainer.headline}
        {explainer.unrecognized && (
          <span className="prop-explainer-unrec"> (auto-explainer not yet supported)</span>
        )}
      </div>
      <dl className="prop-explainer-list">
        {explainer.bullets.map((b) => (
          <div key={b.label} className="prop-explainer-row">
            <dt>{b.label}</dt>
            <dd>{b.value}</dd>
          </div>
        ))}
      </dl>

      {isActive && (
        <Projection
          proposal={proposal}
          quorumRequired={quorumRequired}
          yesThreshold={yesThreshold}
          vetoThreshold={vetoThreshold}
        />
      )}

      <div className="prop-explainer-fineprint">
        Generated from on-chain content. Cross-reference the Summary tab for the proposer&apos;s
        own description.
      </div>
    </div>
  );
}

function Projection({
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
        <span className="governance-projection-icon" aria-hidden="true">⏱</span>
        <span className="governance-projection-verb">{verb}</span>
      </div>
      <div className="governance-projection-reason">{projection.reason}</div>
      {projection.unvotedStake > 0 && (
        <div className="governance-projection-side">
          <span className="governance-projection-label">Bonded stake not yet voted</span>
          <span className="governance-projection-value">
            {formatTxAmount(projection.unvotedStake)} TX (
            {((projection.unvotedStake / proposal.tally.bondedSnapshot) * 100).toFixed(1)}% of bonded)
          </span>
        </div>
      )}
      <div className="governance-projection-fineprint">
        Live projection based on current tally and chain params. Numbers can still change.
      </div>
    </div>
  );
}

function SummaryTab({ proposal }: { proposal: Proposal }) {
  if (!proposal.description?.trim()) {
    return (
      <div className="prop-tab-empty">
        No description was provided by the proposer. See the Explainer tab.
      </div>
    );
  }
  return (
    <div className="prop-tab-summary">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{proposal.description}</ReactMarkdown>
    </div>
  );
}

function VotesTab({ proposal: _proposal }: { proposal: Proposal }) {
  // Phase 2: per-validator vote breakdown. For now this is a stub
  // with a clear "coming soon" note rather than a half-built table.
  return (
    <div className="prop-tab-empty">
      <div style={{ marginBottom: 8, fontWeight: 700 }}>Validator breakdown coming soon</div>
      <div style={{ opacity: 0.75, fontSize: "0.85rem", lineHeight: 1.5 }}>
        We&apos;ll show how each validator voted on this proposal, sorted by bonded stake, so
        delegators can see which validators agree with their position. Until then, the totals
        above and the projection in the Explainer tab give you the chain-wide picture.
      </div>
    </div>
  );
}

function RawTab({ proposal }: { proposal: Proposal }) {
  // Read-only JSON viewer for power users. Shows what's available
  // server-side so anything we display elsewhere is verifiable.
  const payload = {
    id: proposal.id,
    title: proposal.title,
    type: proposal.type,
    rawType: proposal.rawType,
    status: proposal.status,
    rawStatus: proposal.rawStatus,
    proposer: proposal.proposer,
    submitTime: proposal.submitTime,
    votingStartTime: proposal.votingStartTime,
    votingEndTime: proposal.votingEndTime,
    tally: proposal.tally,
    content: proposal.content,
  };
  return (
    <pre className="prop-tab-raw">
      <code>{JSON.stringify(payload, null, 2)}</code>
    </pre>
  );
}
