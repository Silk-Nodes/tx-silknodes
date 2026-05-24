"use client";

import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useProposalDetail, type ValidatorVote, type ProposalDetailData } from "@/hooks/useProposalDetail";
import { useCosmosWallet } from "@/hooks/useCosmosWallet";
import { useUserDelegations } from "@/hooks/useUserDelegations";
import { explainProposal, projectActiveVote } from "@/lib/governance-explainer";
import {
  STATUS_LABELS,
  calcQuorumFraction,
  calcVoteFractions,
  formatTxAmount,
} from "@/lib/governance";
import ValidatorVoteTable from "@/components/governance/ValidatorVoteTable";
import VoteConcentration from "@/components/governance/VoteConcentration";
import VelocityChart from "@/components/governance/VelocityChart";
import VotePanel from "@/components/governance/VotePanel";
import SettledLayout from "@/components/governance/SettledLayout";
import StickyContextStrip from "@/components/governance/StickyContextStrip";
import ProposalNav from "@/components/governance/ProposalNav";

interface Props {
  id: number;
  // Called when the user clicks "Back to governance" so the parent (HomePage)
  // can switch back to the governance landing tab without a route change.
  onBack?: () => void;
}

// Renders one proposal's full breakdown. Designed to live INSIDE the main
// app shell (top nav, banner, footer all come from HomePage), so this view
// itself has no top-level shell. The page-level wrapper styles still come
// from .prop-page-shell so existing CSS continues to work, just without
// the bg-gradient + min-height that would conflict with the parent.
export default function ProposalDetailView({ id, onBack }: Props) {
  const { data, loading, error } = useProposalDetail(Number.isFinite(id) ? id : null);
  const wallet = useCosmosWallet();
  const { delegations } = useUserDelegations(wallet.address);

  if (!Number.isFinite(id)) {
    return <div className="prop-page-error">Invalid proposal id.</div>;
  }
  if (loading && !data) {
    return <div className="prop-page-loading">Loading proposal #{id}...</div>;
  }
  if (error && !data) {
    return (
      <div className="prop-page-error">
        Failed to load proposal #{id}: {error}
      </div>
    );
  }
  if (!data) {
    return <div className="prop-page-error">Proposal #{id} not found.</div>;
  }

  const { proposal, params: govParams, validators, velocity, meta, delegatorVotes } = data;
  const { tally, status } = proposal;
  const quorumPct = calcQuorumFraction(tally);
  const quorumMet = quorumPct >= govParams.quorum;
  const fractions = calcVoteFractions(tally);
  const explainer = explainProposal(proposal);
  const isActive = status === "voting";
  const isSettled = status === "passed" || status === "rejected" || status === "failed";

  const projection = isActive
    ? projectActiveVote(tally, govParams.quorum, govParams.threshold, govParams.vetoThreshold)
    : null;

  return (
    <div className="prop-page-inline">
      <StickyContextStrip proposal={proposal} quorumPct={quorumPct} />
      <div className="prop-page">
        <div className="prop-page-top-row">
          {onBack ? (
            <button type="button" onClick={onBack} className="prop-page-back">
              ← Back to governance
            </button>
          ) : (
            <a href="/?tab=governance" className="prop-page-back">
              ← Back to governance
            </a>
          )}
          <PageWalletButton wallet={wallet} />
        </div>

        {isSettled ? (
          <SettledLayout
            data={data}
            highlightAddresses={delegations.map((d) => d.operatorAddress)}
          />
        ) : (
          <>
            <header className="prop-page-header">
              <div className="prop-page-header-meta">
                <span className="governance-type-pill" title={proposal.rawType}>
                  {proposal.type}
                </span>
                <span className={`governance-status-badge status-${status}`}>
                  {STATUS_LABELS[status]}
                </span>
                <span className="prop-page-id">#{proposal.id}</span>
              </div>
              <h1 className="prop-page-title">{proposal.title}</h1>
              <div className="prop-page-times">
                {proposal.votingStartTime && (
                  <span>
                    Voting period:{" "}
                    {formatAbsolute(proposal.votingStartTime)}
                    {" → "}
                    {proposal.votingEndTime ? formatAbsolute(proposal.votingEndTime) : "open"}
                  </span>
                )}
              </div>
            </header>
            <LegacyActiveLayout
              data={data}
              wallet={wallet}
              delegations={delegations}
              isActive={isActive}
              projection={projection}
              fractions={fractions}
              quorumPct={quorumPct}
              quorumMet={quorumMet}
              explainer={explainer}
            />
          </>
        )}

        <ProposalNav currentId={proposal.id} />
      </div>
    </div>
  );
}

function LegacyActiveLayout({
  data, wallet, delegations, isActive, projection, fractions, quorumPct, quorumMet, explainer,
}: {
  data: ProposalDetailData;
  wallet: ReturnType<typeof useCosmosWallet>;
  delegations: { operatorAddress: string; delegatedTX: number }[];
  isActive: boolean;
  projection: ReturnType<typeof projectActiveVote> | null;
  fractions: ReturnType<typeof calcVoteFractions>;
  quorumPct: number;
  quorumMet: boolean;
  explainer: ReturnType<typeof explainProposal>;
}) {
  const { proposal, params: govParams, validators, velocity, meta, delegatorVotes } = data;
  const { tally, status } = proposal;
  return (
    <>
        {projection && (
          <div className={`prop-page-banner banner-${projection.outcome}`}>
            <div className="prop-page-banner-headline">
              {projection.outcome === "passing" && "Currently on track to PASS"}
              {projection.outcome === "failing-quorum" && "Currently FAILING, quorum not met"}
              {projection.outcome === "failing-veto" && "Currently FAILING, vetoed"}
              {projection.outcome === "failing-threshold" && "Currently FAILING, Yes below threshold"}
            </div>
            <div className="prop-page-banner-reason">{projection.reason}</div>
          </div>
        )}

        <section className="prop-page-overview">
          <div className="prop-page-overview-row">
            <Stat label="Result" big value={STATUS_LABELS[status].toUpperCase()} statusClass={`status-${status}`} />
            <Stat
              label="Turnout / Quorum"
              big
              value={`${(quorumPct * 100).toFixed(2)}%`}
              sub={`of ${(govParams.quorum * 100).toFixed(0)}% required`}
              statusClass={quorumMet ? "ok" : "warn"}
            />
            <Stat
              label="Validators voted"
              big
              value={`${meta.votedCount} / ${meta.validatorCount}`}
              sub={`${meta.delegatorVoteCount} non-validator votes`}
            />
            <Stat
              label="Bonded snapshot"
              big
              value={`${formatTxAmount(tally.bondedSnapshot)} TX`}
              sub="staked at proposal time"
            />
          </div>
          <div className="prop-page-votes-row">
            <BigVoteCard label="Yes" amount={tally.yes} pct={fractions.yesPct} kind="yes" />
            <BigVoteCard label="No" amount={tally.no} pct={fractions.noPct} kind="no" />
            <BigVoteCard label="Veto" amount={tally.noWithVeto} pct={fractions.vetoPct} kind="veto" />
            <BigVoteCard label="Abstain" amount={tally.abstain} pct={fractions.abstainPct} kind="abstain" />
          </div>
        </section>

        {isActive && (
          <VotePanel
            proposalId={proposal.id}
            isActive={isActive}
            wallet={wallet}
            userDelegations={delegations}
            validators={validators}
          />
        )}

        <Section title="What this proposal does" subtitle="Plain-English breakdown from on-chain content.">
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
        </Section>

        <Section
          title="Validator vote breakdown"
          subtitle={`How each of ${meta.validatorCount} validators voted, sorted by bonded stake. Click a chip to filter.`}
        >
          <ValidatorVoteTable
            validators={validators}
            totalBonded={tally.bondedSnapshot}
            highlightAddresses={delegations.map((d) => d.operatorAddress)}
          />
        </Section>

        <NonVotersCallout validators={validators} />

        <Section title="Vote concentration" subtitle="How decentralized was this vote, really?">
          <VoteConcentration
            validators={validators}
            totalBonded={tally.bondedSnapshot}
            yesThreshold={govParams.threshold}
            quorumRequired={govParams.quorum}
          />
        </Section>

        <Section
          title="Vote velocity"
          subtitle="Cumulative votes over the voting period. Tells you whether the proposal settled early or stayed close to the deadline."
        >
          <VelocityChart
            series={velocity}
            bondedSnapshot={tally.bondedSnapshot}
            quorumRequired={govParams.quorum}
          />
        </Section>

        <Section title="Proposer description" subtitle="The text submitted by the proposer.">
          {proposal.description?.trim() ? (
            <div className="prop-page-summary">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{proposal.description}</ReactMarkdown>
            </div>
          ) : (
            <div className="prop-page-empty">No description provided.</div>
          )}
        </Section>

        {delegatorVotes.length > 0 && (
          <Section
            title={`Non-validator votes (${delegatorVotes.length})`}
            subtitle="Delegators who voted directly to override their validator."
          >
            <div className="prop-page-delegator-list">
              {delegatorVotes.slice(0, 20).map((d) => (
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
              {delegatorVotes.length > 20 && (
                <div className="prop-page-empty">
                  + {delegatorVotes.length - 20} more
                </div>
              )}
            </div>
          </Section>
        )}

        <Section title="Raw on-chain data" subtitle="For power users. The exact proposal payload returned by the indexer.">
          <pre className="prop-page-raw">
            <code>{JSON.stringify({ proposal, params: govParams }, null, 2)}</code>
          </pre>
        </Section>
    </>
  );
}

function Section({
  title, subtitle, children,
}: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="prop-page-section">
      <div className="prop-page-section-head">
        <h2 className="prop-page-section-title">{title}</h2>
        {subtitle && <div className="prop-page-section-sub">{subtitle}</div>}
      </div>
      <div className="prop-page-section-body">{children}</div>
    </section>
  );
}

function Stat({
  label, value, sub, statusClass, big,
}: { label: string; value: string; sub?: string; statusClass?: string; big?: boolean }) {
  return (
    <div className={`prop-page-stat ${big ? "big" : ""} ${statusClass || ""}`}>
      <div className="prop-page-stat-label">{label}</div>
      <div className="prop-page-stat-value">{value}</div>
      {sub && <div className="prop-page-stat-sub">{sub}</div>}
    </div>
  );
}

function BigVoteCard({
  label, amount, pct, kind,
}: { label: string; amount: number; pct: number; kind: "yes" | "no" | "veto" | "abstain" }) {
  return (
    <div className={`prop-page-vote-card vote-${kind}`}>
      <div className="prop-page-vote-label">{label}</div>
      <div className="prop-page-vote-pct">{(pct * 100).toFixed(2)}%</div>
      <div className="prop-page-vote-amount">{formatTxAmount(amount)} TX</div>
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
    <Section
      title={`Top validators that did not vote (${nonVoters.length})`}
      subtitle={`Together holding ${formatTxAmount(totalIdleStake)} TX of bonded stake. Their delegators absorb their silence.`}
    >
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
    </Section>
  );
}

function PageWalletButton({ wallet }: { wallet: ReturnType<typeof useCosmosWallet> }) {
  const [picking, setPicking] = useState(false);
  if (wallet.connected) {
    return (
      <div className="prop-page-wallet">
        <span className="prop-page-wallet-addr">
          {wallet.address!.slice(0, 10)}...{wallet.address!.slice(-6)}
        </span>
        <button type="button" className="prop-page-wallet-disconnect" onClick={wallet.disconnect}>
          Disconnect
        </button>
      </div>
    );
  }
  if (picking) {
    return (
      <div className="prop-page-wallet-picker">
        <button type="button" className="vote-wallet-pick" onClick={() => { void wallet.connect("keplr"); setPicking(false); }}>Keplr</button>
        <button type="button" className="vote-wallet-pick" onClick={() => { void wallet.connect("cosmostation"); setPicking(false); }}>Cosmostation</button>
        <button type="button" className="vote-wallet-pick cancel" onClick={() => setPicking(false)}>Cancel</button>
      </div>
    );
  }
  return (
    <button type="button" className="prop-page-wallet-connect" onClick={() => setPicking(true)}>
      {wallet.connecting ? "Connecting..." : "Connect wallet"}
    </button>
  );
}

function formatAbsolute(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
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

function shorten(s: string): string {
  if (s.length <= 18) return s;
  return `${s.slice(0, 10)}...${s.slice(-6)}`;
}
