"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { TokenData, StakingData, NetworkStatus, ValidatorInfo, WalletState } from "@/lib/types";
import { useGovernance } from "@/hooks/useGovernance";
import { useNextPSECycle, pad } from "@/hooks/useNextPSECycle";
import { formatTxAmount } from "@/lib/governance";
import SignalsGrid from "./today/SignalsGrid";
import HappeningFeed from "./today/HappeningFeed";

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

      {/* ─── Top row: cycle countdown + connect wallet side by side ──── */}
      <div className="today-top-grid">
        {cycle && (
          <section className="today-cycle-card">
            <div className="today-cycle-eyebrow">
              <span>Cycle {cycle.cycleNumber} of {cycle.totalCycles}</span>
              <span className="today-cycle-sep">/</span>
              <span>Next PSE distribution</span>
            </div>
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

        {/* Entry card. Pairs with the PSE countdown on wide screens. We
            lead with "check any address" because plenty of visitors
            just want to look up their wallet without connecting it.
            Wallet connect and calculator sit underneath as alternatives
            so all three paths are visible up-front. When the wallet is
            already connected the card collapses to a welcome state. */}
        {!isConnected ? (
          <AddressEntryCard onConnectWallet={onConnectWallet} />
        ) : (
          <section className="today-connect-stack today-connect-stack-quiet">
            <div className="today-connect-eyebrow">Wallet connected</div>
            <div className="today-connect-stack-headline">
              Welcome back
            </div>
            <div className="today-connect-stack-sub">
              Your position and PSE score are loaded below.
            </div>
          </section>
        )}
      </div>

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

      {/* Connect-wallet card moved into the top row above (paired with
          the cycle countdown). */}

      {/* ─── Signals + Activity feed side by side on wide screens ────── */}
      <div className="today-bottom-grid">
        <SignalsGrid />
        <HappeningFeed proposals={proposals} cycle={cycle} />
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


// ─── Helpers ────────────────────────────────────────────────────────

// Entry-point card shown when no wallet is connected. Three pathways
// of equal visibility:
//   1. Paste any address → deep-link to /pse?address=core1... where the
//      PSE tab auto-fetches the score on mount (handled in page.tsx).
//   2. Connect Keplr/Cosmostation → existing flow via onConnectWallet.
//   3. Open the staking calculator → /calculator route.
// Address validation is intentionally permissive ("core1" prefix +
// length floor). Stricter validation happens server-side on the lookup.
function AddressEntryCard({ onConnectWallet }: { onConnectWallet: () => void }) {
  const router = useRouter();
  const [addr, setAddr] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = addr.trim();
    if (!trimmed) {
      setError("Paste a TX address to look up.");
      return;
    }
    // Bech32 addresses are ~44 chars; cap well above that so an absurd
    // paste can't produce a giant URL and a guaranteed-failed lookup.
    if (!trimmed.startsWith("core1") || trimmed.length < 39 || trimmed.length > 90) {
      setError("Enter a valid core1... address (about 44 characters).");
      return;
    }
    setError(null);
    router.push(`/pse?address=${encodeURIComponent(trimmed)}`);
  };

  return (
    <section className="today-entry-card">
      <div className="today-entry-eyebrow">Check any address</div>
      <div className="today-entry-headline" id="today-entry-headline">
        Look up PSE score, rewards, and positions
      </div>
      <form className="today-entry-form" onSubmit={handleSubmit}>
        <input
          type="text"
          className="today-entry-input"
          value={addr}
          onChange={(e) => {
            setAddr(e.target.value);
            if (error) setError(null);
          }}
          placeholder="Paste a core1... address"
          spellCheck={false}
          autoComplete="off"
          inputMode="text"
          maxLength={100}
          aria-label="TX wallet address"
          aria-describedby="today-entry-headline"
          aria-invalid={!!error}
          {...(error ? { "aria-errormessage": "today-entry-error" } : {})}
        />
        <button type="submit" className="today-entry-submit">
          Fetch
        </button>
      </form>
      {error && (
        <div className="today-entry-error" id="today-entry-error" role="alert">
          {error}
        </div>
      )}
      <div className="today-entry-divider"><span>or</span></div>
      <div className="today-entry-alts">
        <button
          type="button"
          className="today-entry-alt"
          onClick={onConnectWallet}
        >
          Connect wallet
        </button>
        <Link href="/calculator" className="today-entry-alt">
          Open calculator
        </Link>
      </div>
    </section>
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
  if (!Number.isFinite(n)) return "0.00";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${abs.toFixed(2)}`;
}
