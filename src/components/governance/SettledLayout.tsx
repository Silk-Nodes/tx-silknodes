"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ProposalDetailData } from "@/hooks/useProposalDetail";
import { explainProposal } from "@/lib/governance-explainer";
import {
  calcQuorumFraction,
  formatTxAmount,
} from "@/lib/governance";
import VoteResultBar from "./VoteResultBar";
import GovernanceInsights from "./GovernanceInsights";
import WhoVotedCompact from "./WhoVotedCompact";
import OverridesPanel from "./OverridesPanel";

interface Props {
  data: ProposalDetailData;
  highlightAddresses: string[];
}

// Phase 1.5: progressive disclosure. The page now answers the simple-user
// questions immediately (did it pass? how strongly?), pulls one-line
// plain-English insights up next, and pushes power-user data (full
// validator table, raw JSON, advanced charts) behind explicit clicks.
export default function SettledLayout({ data, highlightAddresses }: Props) {
  const { proposal, params: govParams, validators, velocity, meta, delegatorVotes } = data;
  const { tally, status } = proposal;
  const quorumPct = calcQuorumFraction(tally);
  const explainer = explainProposal(proposal);
  const outcomeWord =
    status === "passed" ? "Passed"
    : status === "rejected" ? "Rejected"
    : status === "failed" ? "Failed"
    : status;
  const outcomeTone =
    status === "passed" ? "ok"
    : status === "rejected" || status === "failed" ? "warn"
    : "neutral";

  // Compact meta line under the hero title.
  const metaParts: string[] = [proposal.type, `#${proposal.id}`];
  if (proposal.votingStartTime && proposal.votingEndTime) {
    const start = new Date(proposal.votingStartTime);
    const end = new Date(proposal.votingEndTime);
    const days = Math.round((end.getTime() - start.getTime()) / 86_400_000 * 10) / 10;
    metaParts.push(`${formatShortDate(start)} → ${formatShortDate(end)} (${days}d)`);
  }
  metaParts.push(`${(quorumPct * 100).toFixed(1)}% turnout`);
  if (tally.totalVoted > 0) {
    metaParts.push(`${formatTxAmount(tally.totalVoted)} TX voted`);
  }

  return (
    <div className="psl">
      {/* ─── Hero ─────────────────────────────────────────────────── */}
      <section className={`psl-hero psl-hero-${outcomeTone}`}>
        <div className="psl-hero-status">{outcomeWord}</div>
        <h1 className="psl-hero-title">{proposal.title}</h1>
        <div className="psl-hero-meta">
          {metaParts.map((p, i) => (
            <span key={i} className="psl-hero-meta-item">
              {p}
              {i < metaParts.length - 1 && <span className="psl-hero-meta-sep">·</span>}
            </span>
          ))}
        </div>
      </section>

      {/* ─── Vote result (one big bar) ───────────────────────────── */}
      <section className="psl-section">
        <VoteResultBar
          yes={tally.yes}
          no={tally.no}
          veto={tally.noWithVeto}
          abstain={tally.abstain}
          total={tally.bondedSnapshot}
        />
      </section>

      {/* ─── What it did + Risk callout ──────────────────────────── */}
      <section className="psl-section">
        <div className="psl-section-label">What it did</div>
        <div className="psl-what">
          <div className="psl-what-main">
            <div className="psl-what-headline">
              {explainer.headline}
              {explainer.unrecognized && (
                <span className="psl-what-unrec"> (auto-explainer not yet supported)</span>
              )}
            </div>
            <dl className="psl-what-list">
              {explainer.bullets.map((b) => (
                <div key={b.label} className="psl-what-row">
                  <dt>{b.label}</dt>
                  <dd>{b.value}</dd>
                </div>
              ))}
            </dl>
          </div>
          {explainer.risk && (
            <div className="psl-risk">
              <div className="psl-risk-label">Risk</div>
              <div className="psl-risk-text">{explainer.risk}</div>
            </div>
          )}
        </div>
      </section>

      {/* ─── Governance insights (3 plain-English bullets) ───────── */}
      <section className="psl-section">
        <div className="psl-section-label">Governance insights</div>
        <GovernanceInsights
          validators={validators}
          velocity={velocity}
          totalBonded={tally.bondedSnapshot}
          yesThreshold={govParams.threshold}
          quorumRequired={govParams.quorum}
        />
      </section>

      {/* ─── Who voted ──────────────────────────────────────────── */}
      <section className="psl-section">
        <div className="psl-section-head">
          <div className="psl-section-label">Who voted</div>
          <div className="psl-section-sub">
            {meta.votedCount} of {meta.validatorCount} active validators
            {meta.delegatorVoteCount > 0 && ` · ${meta.delegatorVoteCount} delegator override votes`}
          </div>
        </div>
        <WhoVotedCompact
          validators={validators}
          totalBonded={tally.bondedSnapshot}
          highlightAddresses={highlightAddresses}
        />
      </section>

      {/* ─── Technical details (single accordion, all closed) ───── */}
      <DetailsAccordion
        proposalId={proposal.id}
        description={proposal.description}
        delegatorVotes={delegatorVotes}
        validators={validators}
        totalVoted={tally.totalVoted}
        rawPayload={{ proposal, params: govParams }}
      />
    </div>
  );
}

function DetailsAccordion({
  proposalId, description, delegatorVotes, validators, totalVoted, rawPayload,
}: {
  proposalId: number;
  description: string;
  delegatorVotes: ProposalDetailData["delegatorVotes"];
  validators: ProposalDetailData["validators"];
  totalVoted: number;
  rawPayload: unknown;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (key: string) => setOpen((o) => (o === key ? null : key));
  return (
    <section className="psl-section">
      <div className="psl-section-label">Technical details</div>
      <div className="psl-accordion">
        <AccordionRow
          id="description"
          label="Proposer description"
          subtext="The text submitted by the proposer."
          open={open === "description"}
          onToggle={() => toggle("description")}
        >
          {description?.trim() ? (
            <div className="prop-page-summary">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{description}</ReactMarkdown>
            </div>
          ) : (
            <div className="psl-empty">No description provided.</div>
          )}
        </AccordionRow>
        {delegatorVotes.length > 0 && (
          <AccordionRow
            id="overrides"
            label={`Delegator override votes (${delegatorVotes.length})`}
            subtext="Who overrode their validators, and with how much voting power."
            open={open === "overrides"}
            onToggle={() => toggle("overrides")}
          >
            <OverridesPanel
              proposalId={proposalId}
              delegatorVotes={delegatorVotes}
              validators={validators}
              totalVoted={totalVoted}
              enabled={open === "overrides"}
            />
          </AccordionRow>
        )}
        <AccordionRow
          id="raw"
          label="Raw on-chain data"
          subtext="The exact proposal payload returned by the indexer. For developers."
          open={open === "raw"}
          onToggle={() => toggle("raw")}
        >
          <pre className="prop-page-raw">
            <code>{JSON.stringify(rawPayload, null, 2)}</code>
          </pre>
        </AccordionRow>
      </div>
    </section>
  );
}

function AccordionRow({
  id, label, subtext, open, onToggle, children,
}: {
  id: string;
  label: string;
  subtext: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`psl-acc-row ${open ? "open" : ""}`}>
      <button
        type="button"
        className="psl-acc-head"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`psl-acc-${id}`}
      >
        <span className="psl-acc-label">{label}</span>
        <span className="psl-acc-sub">{subtext}</span>
        <span className="psl-acc-chev" aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div id={`psl-acc-${id}`} className="psl-acc-body">
          {children}
        </div>
      )}
    </div>
  );
}

function formatShortDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function shorten(s: string): string {
  if (s.length <= 18) return s;
  return `${s.slice(0, 10)}...${s.slice(-6)}`;
}
