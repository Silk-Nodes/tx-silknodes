"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { TokenData, StakingData, NetworkStatus, ValidatorInfo, WalletState } from "@/lib/types";
import { useGovernance } from "@/hooks/useGovernance";
import { useNextPSECycle, pad } from "@/hooks/useNextPSECycle";
import { formatTxAmount, type Proposal } from "@/lib/governance";
import TodaySignals from "./TodaySignals";

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
// TX's unique recurring beat, the thing that brings users back daily.
export default function TodayTab({
  tokenData, stakingData, networkStatus, validators, wallet, onConnectWallet, setActiveTab,
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

  const priceUp = td.priceChange24h >= 0;
  const isConnected = wallet.connected;

  // Three-stat hero strip. Numbers stay sensible while data is loading
  // (renders em-dash via the `0` check downstream).
  const heroStats = [
    {
      label: "Price",
      value: td.price > 0 ? `$${td.price.toFixed(4)}` : "-",
      delta: td.price > 0
        ? { text: `${priceUp ? "▴" : "▾"} ${Math.abs(td.priceChange24h).toFixed(2)}% 24h`, tone: priceUp ? "ok" : "warn" }
        : null,
    },
    {
      label: "APR",
      value: apr > 0 ? `${apr.toFixed(1)}%` : "-",
      sub: "Annualised staking yield",
    },
    {
      label: "Bonded",
      value: bondedPct > 0 ? `${bondedPct.toFixed(1)}%` : "-",
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

      {/* ─── Cycle countdown - the daily beat ────────────────────────── */}
      {cycle && (
        <section className="today-cycle-card">
          <div className="today-cycle-eyebrow">
            <span>Cycle {cycle.cycleNumber} of {cycle.totalCycles}</span>
            <span className="today-cycle-sep">/</span>
            <span>Next PSE distribution</span>
          </div>
          {/* Same days:hrs:min:sec block style as the PSE tab so the two
              countdowns feel like the same product, not separate widgets. */}
          <div className="countdown-row today-countdown-row">
            <div className="countdown-unit">
              <span className="countdown-digit">{pad(cycle.parts.days)}</span>
              <span className="countdown-label">Days</span>
            </div>
            <span className="countdown-separator">:</span>
            <div className="countdown-unit">
              <span className="countdown-digit">{pad(cycle.parts.hours)}</span>
              <span className="countdown-label">Hrs</span>
            </div>
            <span className="countdown-separator">:</span>
            <div className="countdown-unit">
              <span className="countdown-digit">{pad(cycle.parts.minutes)}</span>
              <span className="countdown-label">Min</span>
            </div>
            <span className="countdown-separator">:</span>
            <div className="countdown-unit">
              <span className="countdown-digit">{pad(cycle.parts.seconds)}</span>
              <span className="countdown-label">Sec</span>
            </div>
          </div>
          <div className="today-cycle-sub">
            Next distribution{" "}
            <strong>
              {new Date(cycle.nextTimestamp * 1000).toLocaleString("en-US", {
                weekday: "short", month: "short", day: "numeric",
                hour: "2-digit", minute: "2-digit", hour12: false,
              })}
            </strong>
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
          <strong>{stakingData ? `${stakingData.activeValidators}/${stakingData.totalValidators}` : "-"}</strong> active validators
        </span>
        <span className="today-supporting-sep">·</span>
        <span>
          <strong>{liveProposals.length}</strong> live proposals
        </span>
        <span className="today-supporting-sep">·</span>
        <span>
          <strong>{td.totalSupply > 0 ? formatTxAmount(td.totalSupply) : "-"} TX</strong> total supply
        </span>
      </div>

      {/* ─── Connect wallet CTA, right under the hero ────────────────── */}
      {!isConnected && (
        <section className="today-connect-card">
          <div className="today-connect-body">
            <span className="today-connect-headline">
              See your PSE score, rewards, and positions.
            </span>
            <span className="today-connect-sub">
              Keplr, Leap, or Cosmostation. Your keys stay on your device.
            </span>
          </div>
          <div className="today-connect-actions">
            <button type="button" className="today-cta-primary" onClick={onConnectWallet}>
              Connect wallet
            </button>
            <Link href="/governance" className="today-cta-secondary">
              Browse governance
            </Link>
          </div>
        </section>
      )}

      {/* ─── Signals + Activity feed side by side on wide screens ────── */}
      <div className="today-bottom-grid">
        <TodaySignals
          validators={validators}
          stakingData={stakingData}
          proposals={proposals}
          cycle={cycle}
        />
        <WhatsHappeningFeed proposals={proposals} />
      </div>

      {/* ─── Action queue (when there's something live) ──────────────── */}
      {liveProposals.length > 0 && (
        <section className="today-section">
          <div className="today-section-label">Needs your attention</div>
          <div className="today-attention-list">
            {liveProposals.map((p) => (
              <Link key={p.id} href={`/governance/${p.id}`} className="today-attention-row">
                <span className="today-attention-dot" aria-hidden="true" />
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

    </div>
  );
}

// Time-anchored activity feed. Pulls recent governance events (decided
// proposals + currently-active ones) and sorts by time. Each row reads
// like a news bullet: tag, relative time, what happened, link.
function WhatsHappeningFeed({ proposals }: { proposals: Proposal[] }) {
  const events = useMemo(() => {
    type FeedEvent = {
      key: string;
      tag: string;
      tagTone?: "ok" | "warn";
      time: number; // unix ms
      headline: React.ReactNode;
      href: string;
    };
    const out: FeedEvent[] = [];

    for (const p of proposals) {
      // Currently active or in deposit, surfaced as "in progress" events.
      if (p.status === "voting" || p.status === "deposit") {
        const t = p.votingStartTime ? new Date(p.votingStartTime).getTime()
          : p.submitTime ? new Date(p.submitTime).getTime() : 0;
        out.push({
          key: `active-${p.id}`,
          tag: "GOVERNANCE",
          tagTone: "ok",
          time: t,
          headline: (
            <>
              Proposal #{p.id}{" "}
              {p.status === "voting" ? "entered voting" : "is in deposit period"}
              <span className="today-feed-sub-inline">{p.title}</span>
            </>
          ),
          href: `/governance/${p.id}`,
        });
        continue;
      }
      // Decided proposals.
      if (p.status === "passed" || p.status === "rejected" || p.status === "failed") {
        const t = p.votingEndTime ? new Date(p.votingEndTime).getTime() : 0;
        if (!t) continue;
        const verb = p.status === "passed" ? "passed"
          : p.status === "rejected" ? "was rejected"
          : "failed";
        out.push({
          key: `decided-${p.id}`,
          tag: "GOVERNANCE",
          tagTone: p.status === "passed" ? "ok" : "warn",
          time: t,
          headline: (
            <>
              Proposal #{p.id} {verb}
              <span className="today-feed-sub-inline">{p.title}</span>
            </>
          ),
          href: `/governance/${p.id}`,
        });
      }
    }

    // Newest first, cap at 6 rows.
    out.sort((a, b) => b.time - a.time);
    return out.slice(0, 6);
  }, [proposals]);

  if (events.length === 0) {
    return (
      <section className="today-section">
        <div className="today-section-label">What&apos;s happening</div>
        <div className="today-feed-empty">No recent activity yet.</div>
      </section>
    );
  }

  return (
    <section className="today-section">
      <div className="today-section-label">What&apos;s happening</div>
      <div className="today-feed">
        {events.map((ev) => (
          <Link key={ev.key} href={ev.href} className="today-feed-row">
            <span className={`today-feed-tag ${ev.tagTone ? `tone-${ev.tagTone}` : ""}`}>
              {ev.tag}
            </span>
            <span className="today-feed-time">{relTimeShort(ev.time)}</span>
            <span className="today-feed-headline">{ev.headline}</span>
          </Link>
        ))}
      </div>
      <Link href="/governance" className="today-feed-footer">
        Browse all governance activity
      </Link>
    </section>
  );
}

function relTimeShort(ms: number): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 0) return "scheduled";
  const days = Math.floor(diff / 86_400_000);
  if (days >= 30) {
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
  }
  if (days > 0) return `${days}d ago`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours > 0) return `${hours}h ago`;
  const mins = Math.floor(diff / 60_000);
  if (mins > 0) return `${mins}m ago`;
  return "just now";
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
