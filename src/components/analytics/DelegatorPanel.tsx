"use client";

import { useEffect, useMemo, useState } from "react";
import type { StakingEvent } from "@/lib/staking-events";
import {
  formatEventAmount,
  formatEventTime,
  formatRelativeTime,
  resolveValidator,
  txExplorerUrl,
} from "@/lib/staking-events";
import {
  fetchDelegatorDelegations,
  fetchDelegatorUnbondings,
  type DelegationItem,
  type UnbondingItem,
} from "@/lib/delegator-queries";
import type { TopDelegatorEntry } from "@/hooks/useWhaleData";

interface DelegatorPanelProps {
  entry: TopDelegatorEntry | null;
  events: StakingEvent[];
  validators: Record<string, string>;
  now: number;
  onClose: () => void;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore clipboard errors (usually browser permission denied)
    }
  };
  return (
    <button
      type="button"
      className="staking-panel-copy"
      onClick={handleCopy}
      title="Copy to clipboard"
      aria-label="Copy"
    >
      {copied ? "✓" : "⧉"}
    </button>
  );
}

function labelIcon(type: string | undefined): string {
  if (!type) return "🐋";
  if (type.startsWith("validator")) return "🏛";
  if (type === "pse-excluded" || type === "validator+pse") return "⚙️";
  if (type === "cex") return "🏦";
  if (type === "individual") return "👤";
  return "🐋";
}

function mintscanAddress(address: string): string {
  return `https://www.mintscan.io/coreum/address/${address}`;
}

function formatCompletionDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export default function DelegatorPanel({
  entry,
  events,
  validators,
  now,
  onClose,
}: DelegatorPanelProps) {
  const [delegations, setDelegations] = useState<DelegationItem[] | null>(null);
  const [unbondings, setUnbondings] = useState<UnbondingItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadId, setLoadId] = useState(0); // lets "retry" button re-fire the effect

  // Escape to close + body overflow lock while the panel is open.
  useEffect(() => {
    if (!entry) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [entry, onClose]);

  // Fetch on-demand data whenever the target address changes (or retry).
  useEffect(() => {
    if (!entry) return;
    const address = entry.address;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDelegations(null);
    setUnbondings(null);

    (async () => {
      try {
        const [d, u] = await Promise.all([
          fetchDelegatorDelegations(address),
          fetchDelegatorUnbondings(address),
        ]);
        if (cancelled) return;
        setDelegations(d);
        setUnbondings(u);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load delegator data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [entry?.address, loadId]);

  // Recent activity filtered from the staking-events feed we already have in
  // memory. No network call needed — instant even for very active addresses.
  const recentActivity = useMemo(() => {
    if (!entry) return [];
    return events
      .filter((e) => e.delegator === entry.address)
      .slice(0, 20); // already sorted newest-first by the feed
  }, [entry, events]);

  if (!entry) return null;

  const totalDelegatedTX = delegations
    ? delegations.reduce((sum, d) => sum + d.stakeTX, 0)
    : entry.totalStake;
  const totalUnbondingTX = unbondings ? unbondings.reduce((sum, u) => sum + u.balanceTX, 0) : 0;
  const icon = labelIcon(entry.label?.type);

  return (
    <>
      <div className="staking-feed-panel-backdrop" onClick={onClose} />
      <div className="staking-feed-panel delegator-panel" role="dialog" aria-modal="true">
        <button
          type="button"
          className="staking-panel-close"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>

        {/* ─── Header: rank + address + label ─── */}
        <div className="delegator-panel-header">
          <div className="delegator-panel-rank">
            <span className="delegator-panel-rank-icon">{icon}</span>
            <span className="delegator-panel-rank-text">RANK #{entry.rank}</span>
          </div>
          <div className="delegator-panel-address-row">
            <a
              href={mintscanAddress(entry.address)}
              target="_blank"
              rel="noopener noreferrer"
              className="staking-panel-link staking-panel-mono delegator-panel-address"
              title="View on Mintscan"
            >
              {entry.address}
            </a>
            <CopyButton text={entry.address} />
          </div>
          {entry.label && (
            <div className={`delegator-panel-label whale-label-${entry.label.type.replace("+", "-")}`}>
              {icon} {entry.label.text}
            </div>
          )}
        </div>

        {/* ─── Headline stats ─── */}
        <div className="delegator-panel-stat">{formatEventAmount(Math.round(totalDelegatedTX))} TX</div>
        <div className="delegator-panel-stat-sub">
          {entry.validatorCount === 1
            ? "1 validator"
            : `${delegations?.length ?? entry.validatorCount} validators`}
          {totalUnbondingTX > 0 ? (
            <> · <strong>{formatEventAmount(Math.round(totalUnbondingTX))} TX</strong> unbonding</>
          ) : null}
        </div>

        {/* ─── Stake distribution ─── */}
        <div className="staking-panel-section">
          <div className="staking-panel-label">Stake Distribution</div>

          {loading && (
            <div className="delegator-panel-skeleton">
              <div className="delegator-panel-skel-row" />
              <div className="delegator-panel-skel-row" />
              <div className="delegator-panel-skel-row" />
            </div>
          )}

          {error && !loading && (
            <div className="delegator-panel-error">
              <span>{error}</span>
              <button
                type="button"
                className="delegator-panel-retry"
                onClick={() => setLoadId((n) => n + 1)}
              >
                Retry
              </button>
            </div>
          )}

          {!loading && !error && delegations && delegations.length === 0 && (
            <div className="delegator-panel-empty">No active delegations on-chain.</div>
          )}

          {!loading && !error && delegations && delegations.length > 0 && (
            <div className="delegator-distribution">
              {delegations.map((d) => {
                const name = resolveValidator(d.valoper, validators);
                const pct =
                  totalDelegatedTX > 0 ? (d.stakeTX / totalDelegatedTX) * 100 : 0;
                return (
                  <div key={d.valoper} className="delegator-dist-row">
                    <div className="delegator-dist-top">
                      <a
                        href={`https://www.mintscan.io/coreum/validators/${d.valoper}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="delegator-dist-name"
                      >
                        {name}
                      </a>
                      <span className="delegator-dist-amount">
                        {formatEventAmount(Math.round(d.stakeTX))} TX
                      </span>
                      <span className="delegator-dist-pct">{pct.toFixed(1)}%</span>
                    </div>
                    <div className="delegator-dist-bar-track">
                      <div
                        className="delegator-dist-bar-fill"
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ─── Pending undelegations (only shown if any exist) ─── */}
        {!loading && !error && unbondings && unbondings.length > 0 && (
          <div className="staking-panel-section">
            <div className="staking-panel-label">
              Pending Undelegations ({unbondings.length})
            </div>
            <div className="delegator-unbondings">
              {unbondings.map((u, i) => {
                const name = resolveValidator(u.valoper, validators);
                return (
                  <div key={`${u.valoper}-${u.completionTime}-${i}`} className="delegator-unbond-row">
                    <span className="delegator-unbond-date">{formatCompletionDate(u.completionTime)}</span>
                    <span className="delegator-unbond-val">{name}</span>
                    <span className="delegator-unbond-amount">
                      {formatEventAmount(Math.round(u.balanceTX))} TX
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ─── Recent activity (from in-memory staking events feed) ─── */}
        <div className="staking-panel-section">
          <div className="staking-panel-label">
            Recent Activity ({recentActivity.length} in last 3 months)
          </div>
          {recentActivity.length === 0 ? (
            <div className="delegator-panel-empty">
              No staking activity from this address in the current feed window.
            </div>
          ) : (
            <div className="delegator-activity">
              {recentActivity.map((e) => {
                const prefix =
                  e.type === "delegate" ? "+" : e.type === "undelegate" ? "-" : "";
                const name = resolveValidator(e.validator, validators);
                return (
                  <a
                    key={e.txHash + e.type + e.height}
                    href={txExplorerUrl(e.txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`delegator-activity-row type-${e.type}`}
                  >
                    <span className="delegator-activity-time">
                      {formatEventTime(e.timestamp)}
                    </span>
                    <span className={`delegator-activity-type type-${e.type}`}>
                      {e.type.toUpperCase()}
                    </span>
                    <span className="delegator-activity-amount">
                      {prefix}
                      {formatEventAmount(e.amount)} TX
                    </span>
                    <span className="delegator-activity-validator">{name}</span>
                    <span className="delegator-activity-ago">
                      {formatRelativeTime(e.timestamp, now)}
                    </span>
                  </a>
                );
              })}
            </div>
          )}
        </div>

        {/* ─── Footer ─── */}
        <div className="delegator-panel-footer">
          <a
            href={mintscanAddress(entry.address)}
            target="_blank"
            rel="noopener noreferrer"
            className="staking-panel-link"
          >
            View on Mintscan ↗
          </a>
        </div>
      </div>
    </>
  );
}
