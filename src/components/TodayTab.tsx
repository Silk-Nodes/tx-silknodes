"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { TokenData, StakingData, NetworkStatus, ValidatorInfo, WalletState } from "@/lib/types";
import { useGovernance } from "@/hooks/useGovernance";
import { formatTxAmount } from "@/lib/governance";

interface Props {
  // tokenData / stakingData come from useTokenData which initialises them
  // as null until the first fetch resolves; tolerate that so we can render
  // the page skeleton immediately on first paint.
  tokenData: TokenData | null;
  stakingData: StakingData | null;
  networkStatus: NetworkStatus | null;
  validators: ValidatorInfo[];
  wallet: WalletState;
  onConnectWallet: () => void;
  setActiveTab: (tab: string) => void;
}

// The Today page is the new front door. Designed as a daily briefing
// answering four questions in order:
//   1. What needs my attention? (action queue)
//   2. What's my position? (when wallet connected)
//   3. What's the state of TX right now? (network pulse)
//   4. What's been happening? (recent activity)
//
// When the wallet is NOT connected, it doubles as a marketing surface
// that signals "TX is alive and worth your attention" + a single
// compelling reason to connect.
export default function TodayTab({
  tokenData, stakingData, networkStatus, validators, wallet, onConnectWallet, setActiveTab,
}: Props) {
  const { proposals } = useGovernance();

  // Derived numbers for the pulse strip.
  const apr = stakingData?.apr ?? 0;
  const bondedPct = stakingData?.stakingRatio ?? 0;
  const liveProposals = useMemo(
    () => proposals.filter((p) => p.status === "voting" || p.status === "deposit"),
    [proposals],
  );
  const passedProposals = useMemo(() => proposals.filter((p) => p.status === "passed").length, [proposals]);
  const latestProposal = useMemo(
    () => [...proposals].sort((a, b) => b.id - a.id)[0] ?? null,
    [proposals],
  );

  // Normalise tokenData so the JSX can reference plain numbers without
  // null-safety boilerplate. When the first fetch hasn't landed yet,
  // everything reads 0 and the UI shows em-dashes accordingly.
  const td = {
    price: tokenData?.price ?? 0,
    priceChange24h: tokenData?.priceChange24h ?? 0,
    totalSupply: tokenData?.totalSupply ?? 0,
    circulatingSupply: tokenData?.circulatingSupply ?? 0,
  };
  const priceUp = td.priceChange24h >= 0;
  const isConnected = wallet.connected;

  return (
    <div className="today">
      {/* ─── Hero ────────────────────────────────────────────────────── */}
      <header className="today-hero">
        <h1 className="today-hero-title">
          {isConnected ? "Welcome back." : "TX Network today."}
        </h1>
        <p className="today-hero-sub">
          {isConnected
            ? "Here's what changed for you and the network since last check."
            : "A live snapshot of the network and what needs attention right now."}
        </p>
      </header>

      {/* ─── Action queue (only render if there's something to say) ─── */}
      {liveProposals.length > 0 && (
        <section className="today-section today-attention">
          <div className="today-section-label">Needs your attention</div>
          <div className="today-attention-list">
            {liveProposals.map((p) => (
              <Link key={p.id} href={`/governance/${p.id}`} className="today-attention-row">
                <span className="today-attention-icon">⚡</span>
                <span className="today-attention-body">
                  <span className="today-attention-headline">
                    Active vote: <strong>{p.title}</strong>
                  </span>
                  <span className="today-attention-meta">
                    Proposal #{p.id} · ends {timeUntil(p.votingEndTime)}
                  </span>
                </span>
                <span className="today-attention-cta">Vote →</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ─── Your position (only when connected) ─────────────────────── */}
      {isConnected && (
        <section className="today-section">
          <div className="today-section-label">Your position</div>
          <div className="today-position">
            <div className="today-position-row">
              <PositionStat
                label="Total staked"
                value={`${formatTxAmount(wallet.stakedAmount)} TX`}
                sub={td.price > 0 ? `≈ $${formatUSD(wallet.stakedAmount * td.price)}` : ""}
              />
              <PositionStat
                label="Pending rewards"
                value={`${formatTxAmount(wallet.rewards)} TX`}
                sub={td.price > 0 ? `≈ $${formatUSD(wallet.rewards * td.price)}` : ""}
                tone="ok"
              />
              <PositionStat
                label="Validators"
                value={String(wallet.delegations.length)}
                sub={wallet.delegations.length === 0 ? "Start by picking one" : ""}
              />
              <PositionStat
                label="Wallet balance"
                value={`${formatTxAmount(wallet.balance)} TX`}
                sub="Available to stake"
              />
            </div>
            <div className="today-position-actions">
              <button type="button" className="today-cta-primary" onClick={() => setActiveTab("portfolio")}>
                Manage delegations
              </button>
              <button type="button" className="today-cta-secondary" onClick={() => setActiveTab("pse")}>
                Check PSE score
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ─── Network pulse ───────────────────────────────────────────── */}
      <section className="today-section">
        <div className="today-section-label">Network pulse</div>
        <div className="today-pulse">
          <PulseStat
            label="Price"
            value={td.price > 0 ? `$${td.price.toFixed(4)}` : "—"}
            delta={td.price > 0
              ? `${priceUp ? "▴" : "▾"} ${Math.abs(td.priceChange24h).toFixed(2)}% 24h`
              : ""}
            deltaTone={priceUp ? "ok" : "warn"}
          />
          <PulseStat
            label="APR"
            value={apr > 0 ? `${apr.toFixed(1)}%` : "—"}
            sub="Annualised staking yield"
          />
          <PulseStat
            label="Bonded ratio"
            value={bondedPct > 0 ? `${bondedPct.toFixed(1)}%` : "—"}
            sub={stakingData ? `${formatTxAmount(stakingData.bondedTokens)} TX staked` : ""}
          />
          <PulseStat
            label="Validators"
            value={stakingData ? `${stakingData.activeValidators} / ${stakingData.totalValidators}` : "—"}
            sub="Active in the set"
          />
          <PulseStat
            label="Live proposals"
            value={String(liveProposals.length)}
            sub={liveProposals.length === 0 ? "None active" : "Need your vote"}
            tone={liveProposals.length > 0 ? "ok" : "muted"}
          />
          <PulseStat
            label="Supply"
            value={td.totalSupply > 0 ? `${formatTxAmount(td.totalSupply)} TX` : "—"}
            sub={td.circulatingSupply > 0
              ? `${formatTxAmount(td.circulatingSupply)} circulating`
              : ""}
          />
        </div>
      </section>

      {/* ─── What's happening ────────────────────────────────────────── */}
      <section className="today-section">
        <div className="today-section-label">What&apos;s happening</div>
        <div className="today-happening">
          {latestProposal && (
            <Link href={`/governance/${latestProposal.id}`} className="today-happening-row">
              <span className="today-happening-tag tag-gov">GOVERNANCE</span>
              <span className="today-happening-text">
                Latest proposal: <strong>{latestProposal.title}</strong>
              </span>
              <span className="today-happening-status">
                {latestProposal.status === "passed" ? "Passed" :
                 latestProposal.status === "rejected" ? "Rejected" :
                 latestProposal.status === "voting" ? "In voting" :
                 latestProposal.status === "deposit" ? "Deposit period" : latestProposal.status}
              </span>
            </Link>
          )}
          {passedProposals > 0 && (
            <div className="today-happening-row today-happening-row-static">
              <span className="today-happening-tag tag-gov">GOVERNANCE</span>
              <span className="today-happening-text">
                <strong>{passedProposals}</strong> proposals have passed since TGE
              </span>
              <Link href="/governance" className="today-happening-link">Browse →</Link>
            </div>
          )}
          {networkStatus && (
            <div className="today-happening-row today-happening-row-static">
              <span className="today-happening-tag tag-chain">CHAIN</span>
              <span className="today-happening-text">
                Block <strong>#{networkStatus.blockHeight.toLocaleString()}</strong> on{" "}
                <code>{networkStatus.chainId}</code>
              </span>
              <span className="today-happening-link">Healthy</span>
            </div>
          )}
        </div>
      </section>

      {/* ─── Connect wallet CTA (not connected) ──────────────────────── */}
      {!isConnected && (
        <section className="today-section today-connect">
          <div className="today-connect-card">
            <div className="today-connect-headline">
              See your PSE score, rewards, and positions
            </div>
            <p className="today-connect-sub">
              Connect Keplr, Leap, or Cosmostation. Your data stays on your device —
              we never see your keys.
            </p>
            <div className="today-connect-actions">
              <button type="button" className="today-cta-primary" onClick={onConnectWallet}>
                Connect wallet
              </button>
              <Link href="/governance" className="today-cta-secondary">
                Browse governance →
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* ─── Discover (always) ───────────────────────────────────────── */}
      <section className="today-section today-discover">
        <div className="today-section-label">Tools</div>
        <div className="today-discover-grid">
          <DiscoverCard
            title="Validators"
            description="Browse, compare, and delegate to a validator."
            onClick={() => setActiveTab("validators")}
          />
          <DiscoverCard
            title="Calculator"
            description="Estimate your TX rewards over time."
            onClick={() => setActiveTab("calculator")}
          />
          <DiscoverCard
            title="Whale flows"
            description="Track large stake movements across TX."
            onClick={() => setActiveTab("flows")}
          />
          <DiscoverCard
            title="Analytics"
            description="Deep charts on supply, holders, and price."
            onClick={() => setActiveTab("analytics")}
          />
          <DiscoverCard
            title="RWA Explorer"
            description="Tokenized assets and smart tokens on Coreum."
            onClick={() => setActiveTab("rwa")}
          />
          <DiscoverCard
            title="PSE Calculator"
            description="Run scenarios for the Proof-of-Support Emission."
            onClick={() => setActiveTab("pse")}
          />
        </div>
      </section>
    </div>
  );
}

// ─── Small building blocks ────────────────────────────────────────────

function PulseStat({
  label, value, delta, deltaTone, sub, tone,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaTone?: "ok" | "warn";
  sub?: string;
  tone?: "ok" | "warn" | "muted";
}) {
  return (
    <div className={`today-pulse-card ${tone ? `tone-${tone}` : ""}`}>
      <div className="today-pulse-label">{label}</div>
      <div className="today-pulse-value">{value}</div>
      {delta && (
        <div className={`today-pulse-delta ${deltaTone === "warn" ? "warn" : "ok"}`}>{delta}</div>
      )}
      {sub && <div className="today-pulse-sub">{sub}</div>}
    </div>
  );
}

function PositionStat({
  label, value, sub, tone,
}: { label: string; value: string; sub?: string; tone?: "ok" }) {
  return (
    <div className={`today-position-card ${tone ? `tone-${tone}` : ""}`}>
      <div className="today-position-label">{label}</div>
      <div className="today-position-value">{value}</div>
      {sub && <div className="today-position-sub">{sub}</div>}
    </div>
  );
}

function DiscoverCard({
  title, description, onClick,
}: { title: string; description: string; onClick: () => void }) {
  return (
    <button type="button" className="today-discover-card" onClick={onClick}>
      <div className="today-discover-title">{title}</div>
      <div className="today-discover-desc">{description}</div>
    </button>
  );
}

function timeUntil(iso: string | null): string {
  if (!iso) return "soon";
  try {
    const ms = new Date(iso).getTime() - Date.now();
    if (ms < 0) return "just ended";
    const days = Math.floor(ms / 86400_000);
    if (days > 0) return `in ${days}d ${Math.floor((ms % 86400_000) / 3600_000)}h`;
    const hours = Math.floor(ms / 3600_000);
    if (hours > 0) return `in ${hours}h ${Math.floor((ms % 3600_000) / 60_000)}m`;
    return `in ${Math.floor(ms / 60_000)}m`;
  } catch {
    return "soon";
  }
}

function formatUSD(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(2);
}
