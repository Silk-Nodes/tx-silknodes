"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { TokenData, StakingData, NetworkStatus, ValidatorInfo, WalletState } from "@/lib/types";
import { useGovernance } from "@/hooks/useGovernance";
import { useNextPSECycle, formatCountdown } from "@/hooks/useNextPSECycle";
import { formatTxAmount } from "@/lib/governance";

interface Props {
  tokenData: TokenData | null;
  stakingData: StakingData | null;
  networkStatus: NetworkStatus | null;
  validators: ValidatorInfo[];
  wallet: WalletState;
  onConnectWallet: () => void;
  setActiveTab: (tab: string) => void;
}

// Today: a daily briefing front door, not a dashboard. Hierarchy is
// big-medium-small. The cycle countdown is the headline because it's
// TX's unique recurring beat — the thing that brings users back daily.
export default function TodayTab({
  tokenData, stakingData, networkStatus, wallet, onConnectWallet, setActiveTab,
}: Props) {
  const { proposals } = useGovernance();
  const cycle = useNextPSECycle();

  const td = {
    price: tokenData?.price ?? 0,
    priceChange24h: tokenData?.priceChange24h ?? 0,
    totalSupply: tokenData?.totalSupply ?? 0,
    circulatingSupply: tokenData?.circulatingSupply ?? 0,
  };
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

  const priceUp = td.priceChange24h >= 0;
  const isConnected = wallet.connected;

  // Three-stat hero strip. Numbers stay sensible while data is loading
  // (renders em-dash via the `0` check downstream).
  const heroStats = [
    {
      label: "Price",
      value: td.price > 0 ? `$${td.price.toFixed(4)}` : "—",
      delta: td.price > 0
        ? { text: `${priceUp ? "▴" : "▾"} ${Math.abs(td.priceChange24h).toFixed(2)}% 24h`, tone: priceUp ? "ok" : "warn" }
        : null,
    },
    {
      label: "APR",
      value: apr > 0 ? `${apr.toFixed(1)}%` : "—",
      sub: "Annualised staking yield",
    },
    {
      label: "Bonded",
      value: bondedPct > 0 ? `${bondedPct.toFixed(1)}%` : "—",
      sub: stakingData ? `${formatTxAmount(stakingData.bondedTokens)} TX staked` : "",
    },
  ];

  return (
    <div className="today">
      {/* ─── Hero ────────────────────────────────────────────────────── */}
      <header className="today-hero">
        <div className="today-hero-eyebrow">
          {isConnected ? "Welcome back" : "TX Network today"}
        </div>
        <div className="today-hero-date">{formatDate(new Date())}</div>
      </header>

      {/* ─── Cycle countdown — the daily beat ────────────────────────── */}
      {cycle && (
        <section className="today-cycle-card">
          <div className="today-cycle-eyebrow">
            <span className="today-cycle-icon" aria-hidden="true">⏰</span>
            <span>Cycle {cycle.cycleNumber} of {cycle.totalCycles}</span>
            <span className="today-cycle-sep">·</span>
            <span>Next PSE distribution</span>
          </div>
          <div className="today-cycle-time">{formatCountdown(cycle.secondsLeft)}</div>
          <div className="today-cycle-sub">
            {new Date(cycle.nextTimestamp * 1000).toLocaleString("en-US", {
              weekday: "short", month: "short", day: "numeric",
              hour: "2-digit", minute: "2-digit", hour12: false,
            })}
          </div>
        </section>
      )}

      {/* ─── Hero stats row ──────────────────────────────────────────── */}
      <section className="today-stats">
        {heroStats.map((s) => (
          <div key={s.label} className="today-stat">
            <div className="today-stat-label">{s.label}</div>
            <div className="today-stat-value">{s.value}</div>
            {s.delta && (
              <div className={`today-stat-delta ${s.delta.tone === "warn" ? "warn" : "ok"}`}>
                {s.delta.text}
              </div>
            )}
            {s.sub && <div className="today-stat-sub">{s.sub}</div>}
          </div>
        ))}
      </section>

      {/* Supporting stats inline */}
      <div className="today-supporting">
        <span>
          <strong>{stakingData ? `${stakingData.activeValidators}/${stakingData.totalValidators}` : "—"}</strong> active validators
        </span>
        <span className="today-supporting-sep">·</span>
        <span>
          <strong>{liveProposals.length}</strong> live proposals
        </span>
        <span className="today-supporting-sep">·</span>
        <span>
          <strong>{td.totalSupply > 0 ? formatTxAmount(td.totalSupply) : "—"} TX</strong> total supply
        </span>
      </div>

      {/* ─── Connect wallet CTA, right under the hero ────────────────── */}
      {!isConnected && (
        <section className="today-connect-card">
          <div className="today-connect-body">
            <div className="today-connect-headline">
              See your PSE score, rewards, and positions
            </div>
            <p className="today-connect-sub">
              Connect Keplr, Leap, or Cosmostation. Your data stays on your device,
              we never see your keys.
            </p>
          </div>
          <div className="today-connect-actions">
            <button type="button" className="today-cta-primary" onClick={onConnectWallet}>
              Connect wallet
            </button>
            <Link href="/governance" className="today-cta-secondary">
              Browse governance →
            </Link>
          </div>
        </section>
      )}

      {/* ─── Action queue (when there's something live) ──────────────── */}
      {liveProposals.length > 0 && (
        <section className="today-section">
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

      {/* ─── Your position (connected only) ──────────────────────────── */}
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

      {/* ─── What's happening (editorial feed, no tech noise) ────────── */}
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
            <Link href="/governance" className="today-happening-row">
              <span className="today-happening-tag tag-gov">GOVERNANCE</span>
              <span className="today-happening-text">
                <strong>{passedProposals}</strong> proposals have passed since TGE
              </span>
              <span className="today-happening-link">Browse →</span>
            </Link>
          )}
          {networkStatus && (
            <div className="today-happening-row today-happening-row-static">
              <span className="today-happening-tag tag-chain">CHAIN</span>
              <span className="today-happening-text">
                Healthy at block <strong>#{networkStatus.blockHeight.toLocaleString()}</strong>
              </span>
              <span className="today-happening-link">Live</span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

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

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function formatUSD(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(2);
}
