"use client";

import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ProposalDetailData, ValidatorVote } from "@/hooks/useProposalDetail";
import { explainProposal } from "@/lib/governance-explainer";
import {
  STATUS_LABELS,
  calcQuorumFraction,
  calcVoteFractions,
  formatTxAmount,
} from "@/lib/governance";
import ValidatorVoteTable from "./ValidatorVoteTable";
import VoteConcentration from "./VoteConcentration";
import VelocityChart from "./VelocityChart";

interface Props {
  data: ProposalDetailData;
  highlightAddresses: string[];
}

// Layout for PASSED / REJECTED / FAILED proposals. The story is "what
// happened and why" - no vote panel, no override summary, no live banner.
// Sections are ordered to match how a user reads it: outcome → what it did
// → vote totals → how this passed (velocity + concentration) → who voted →
// details (description + raw) in tabs at the end.
export default function SettledLayout({ data, highlightAddresses }: Props) {
  const { proposal, params: govParams, validators, velocity, meta, delegatorVotes } = data;
  const { tally, status } = proposal;
  const quorumPct = calcQuorumFraction(tally);
  const fractions = calcVoteFractions(tally);
  const explainer = explainProposal(proposal);
  const outcomeTone =
    status === "passed" ? "ok"
    : status === "rejected" || status === "failed" ? "warn"
    : "neutral";
  const outcomeHeadline =
    status === "passed" ? "✓ PASSED"
    : status === "rejected" ? "✗ REJECTED"
    : status === "failed" ? "✗ FAILED"
    : status.toUpperCase();

  const durationCopy = useMemo(() => {
    if (!proposal.votingStartTime || !proposal.votingEndTime) return null;
    const start = new Date(proposal.votingStartTime).getTime();
    const end = new Date(proposal.votingEndTime).getTime();
    const days = Math.round((end - start) / 86_400_000 * 10) / 10;
    return `${days}d`;
  }, [proposal.votingStartTime, proposal.votingEndTime]);

  // Find the dominant vote side to lead the headline.
  const dominantSide =
    fractions.yesPct >= fractions.noPct && fractions.yesPct >= fractions.vetoPct
      ? "yes"
      : fractions.noPct >= fractions.vetoPct
      ? "no"
      : "veto";
  const dominantPct = dominantSide === "yes"
    ? fractions.yesPct
    : dominantSide === "no" ? fractions.noPct : fractions.vetoPct;
  const dominantAmount = dominantSide === "yes"
    ? tally.yes : dominantSide === "no" ? tally.no : tally.noWithVeto;

  return (
    <div className="prop-settled">
      {/* Outcome hero - wide, single, focused */}
      <section className={`prop-settled-outcome tone-${outcomeTone}`}>
        <div className="prop-settled-outcome-headline">{outcomeHeadline}</div>
        <div className="prop-settled-outcome-sub">
          <span className={`prop-settled-dom prop-settled-dom-${dominantSide}`}>
            {(dominantPct * 100).toFixed(1)}% {dominantSide === "yes" ? "Yes" : dominantSide === "no" ? "No" : "Veto"}
          </span>
          <span className="prop-settled-sep">·</span>
          <span>{formatTxAmount(dominantAmount)} TX</span>
          <span className="prop-settled-sep">·</span>
          <span>{(quorumPct * 100).toFixed(2)}% turnout</span>
          {durationCopy && (
            <>
              <span className="prop-settled-sep">·</span>
              <span>Decided in {durationCopy}</span>
            </>
          )}
        </div>
      </section>

      {/* What it did - explainer right under outcome */}
      <section className="prop-settled-explainer">
        <div className="prop-settled-section-label">What it did</div>
        <div className="prop-page-explainer">
          <div className="prop-page-explainer-headline">
            {explainer.headline}
            {explainer.unrecognized && (
              <span className="prop-page-explainer-unrec"> (auto-explainer not yet supported)</span>
            )}
          </div>
          <dl className="prop-page-explainer-list">
            {explainer.bullets.map((b) => (
              <div key={b.label} className="prop-page-explainer-row">
                <dt>{b.label}</dt>
                <dd>{b.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Vote totals - small strip, since the outcome already led with the
          dominant side. The other three are for context. */}
      <section className="prop-settled-tally">
        <MiniVoteCard label="Yes" amount={tally.yes} pct={fractions.yesPct} kind="yes" />
        <MiniVoteCard label="No" amount={tally.no} pct={fractions.noPct} kind="no" />
        <MiniVoteCard label="Veto" amount={tally.noWithVeto} pct={fractions.vetoPct} kind="veto" />
        <MiniVoteCard label="Abstain" amount={tally.abstain} pct={fractions.abstainPct} kind="abstain" />
      </section>

      {/* How this passed - velocity + concentration side by side */}
      <section className="prop-settled-twocol">
        <div className="prop-settled-col">
          <div className="prop-settled-section-label">Vote velocity</div>
          <VelocityChart
            series={velocity}
            bondedSnapshot={tally.bondedSnapshot}
            quorumRequired={govParams.quorum}
          />
        </div>
        <div className="prop-settled-col">
          <div className="prop-settled-section-label">Concentration</div>
          <VoteConcentration
            validators={validators}
            totalBonded={tally.bondedSnapshot}
            yesThreshold={govParams.threshold}
            quorumRequired={govParams.quorum}
          />
        </div>
      </section>

      {/* Who voted - validator table */}
      <section className="prop-settled-validators">
        <div className="prop-settled-section-head">
          <div className="prop-settled-section-label">Who voted</div>
          <div className="prop-settled-section-sub">
            {meta.votedCount} of {meta.validatorCount} active validators voted ·
            {" "}{meta.delegatorVoteCount} non-validator override votes
          </div>
        </div>
        <ValidatorVoteTable
          validators={validators}
          totalBonded={tally.bondedSnapshot}
          highlightAddresses={highlightAddresses}
        />
      </section>

      {/* Non-voters callout (if any) */}
      <NonVotersCallout validators={validators} />

      {/* Details - tabs for description + raw + delegator votes */}
      <DetailsTabs
        description={proposal.description}
        proposal={proposal}
        params={govParams}
        delegatorVotes={delegatorVotes}
      />
    </div>
  );
}

function MiniVoteCard({
  label, amount, pct, kind,
}: { label: string; amount: number; pct: number; kind: "yes" | "no" | "veto" | "abstain" }) {
  return (
    <div className={`prop-settled-mini vote-${kind}`}>
      <div className="prop-settled-mini-label">{label}</div>
      <div className="prop-settled-mini-pct">{(pct * 100).toFixed(2)}%</div>
      <div className="prop-settled-mini-amount">{formatTxAmount(amount)} TX</div>
    </div>
  );
}

function NonVotersCallout({ validators }: { validators: ValidatorVote[] }) {
  const nonVoters = useMemo(
    () => validators
      .filter((v) => v.voteOption === "DID_NOT_VOTE" && !v.jailed)
      .sort((a, b) => b.bondedStakeTX - a.bondedStakeTX)
      .slice(0, 10),
    [validators],
  );
  const totalIdleStake = nonVoters.reduce((sum, v) => sum + v.bondedStakeTX, 0);
  if (nonVoters.length === 0) return null;
  return (
    <section className="prop-settled-nonvoters">
      <div className="prop-settled-section-head">
        <div className="prop-settled-section-label">Validators that didn&apos;t vote</div>
        <div className="prop-settled-section-sub">
          {nonVoters.length} active validators stayed silent, holding {formatTxAmount(totalIdleStake)} TX of stake.
        </div>
      </div>
      <div className="prop-page-nonvoters">
        {nonVoters.map((v, i) => (
          <div key={v.consensusAddress} className="prop-page-nonvoter-row">
            <span className="prop-page-nonvoter-rank">{i + 1}</span>
            <span className="prop-page-nonvoter-name">{v.moniker || "(unnamed)"}</span>
            <span className="prop-page-nonvoter-stake">
              {formatTxAmount(v.bondedStakeTX)} TX
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

type DetailTab = "description" | "raw" | "delegators";

function DetailsTabs({
  description, proposal, params, delegatorVotes,
}: {
  description: string;
  proposal: unknown;
  params: unknown;
  delegatorVotes: ProposalDetailData["delegatorVotes"];
}) {
  // Default to whichever tab has the most useful content.
  const initial: DetailTab = description?.trim() ? "description" : delegatorVotes.length > 0 ? "delegators" : "raw";
  const [tab, setTab] = useState<DetailTab>(initial);
  const tabs: { id: DetailTab; label: string; badge?: string }[] = [
    { id: "description", label: "Description" },
    ...(delegatorVotes.length > 0 ? [{ id: "delegators" as DetailTab, label: "Override votes", badge: String(delegatorVotes.length) }] : []),
    { id: "raw", label: "Raw data" },
  ];
  return (
    <section className="prop-settled-details">
      <div className="prop-settled-section-head">
        <div className="prop-settled-section-label">Details</div>
      </div>
      <nav className="prop-settled-tab-row" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`prop-settled-tab ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.badge && <span className="prop-settled-tab-badge">{t.badge}</span>}
          </button>
        ))}
      </nav>
      <div className="prop-settled-tab-body">
        {tab === "description" && (
          description?.trim() ? (
            <div className="prop-page-summary">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{description}</ReactMarkdown>
            </div>
          ) : (
            <div className="prop-page-empty">No description was provided by the proposer.</div>
          )
        )}
        {tab === "delegators" && (
          <div className="prop-page-delegator-list">
            {delegatorVotes.slice(0, 50).map((d) => (
              <div key={d.voterAddress} className="prop-page-delegator-row">
                <span className="mono">{shorten(d.voterAddress)}</span>
                <span className={`vvt-vote-badge vvt-vote-${d.voteOption.toLowerCase()}`}>
                  {d.voteOption.replace("_", " ").toLowerCase()}
                </span>
                <span className="prop-page-delegator-time">
                  {new Date(d.votedAt).toLocaleString()}
                </span>
              </div>
            ))}
            {delegatorVotes.length > 50 && (
              <div className="prop-page-empty">+ {delegatorVotes.length - 50} more</div>
            )}
          </div>
        )}
        {tab === "raw" && (
          <pre className="prop-page-raw">
            <code>{JSON.stringify({ proposal, params }, null, 2)}</code>
          </pre>
        )}
      </div>
    </section>
  );
}

function shorten(s: string): string {
  if (s.length <= 18) return s;
  return `${s.slice(0, 10)}...${s.slice(-6)}`;
}
