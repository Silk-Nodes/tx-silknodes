"use client";

import { useEffect, useState } from "react";
import { formatLargeNumber } from "@/lib/analytics-utils";

// Window key + label match the parent FlowsTab so the chip in the
// panel header reflects the user's selection. Kept as plain strings
// because importing the union type from FlowsTab would create a
// circular module pair.
type WindowKey = "24h" | "7d" | "30d" | "90d" | "all";
const WINDOW_LABELS: Record<WindowKey, string> = {
  "24h": "24H",
  "7d": "7D",
  "30d": "30D",
  "90d": "90D",
  all: "ALL",
};

interface PerExchangeRow {
  exchange: string;
  exchangeAddress: string;
  sentToExchange: number;
  receivedFromExchange: number;
  txCount: number;
  net: number;
}
interface RecentFlow {
  txHash: string;
  timestamp: string;
  exchange: string;
  exchangeAddress: string;
  direction: "inflow" | "outflow";
  amount: number;
}
interface AddressFlowResponse {
  address: string;
  label: string | null;
  labelType: string | null;
  rank: number | null;
  isExchange: boolean;
  exchangeName: string | null;
  window: WindowKey;
  summary: {
    totalSentToExchanges: number;
    totalReceivedFromExchanges: number;
    net: number;
    txCount: number;
  };
  perExchange: PerExchangeRow[];
  recent: RecentFlow[];
  updatedAt: string;
}

interface Props {
  address: string | null;
  windowKey: WindowKey;
  onClose: () => void;
  // Whales (top_delegators) get an inline button to switch over to the
  // Whale Tracker side-panel. Triggered through this callback so the
  // parent (FlowsTab) can route the user without us reaching across
  // tabs ourselves.
  onViewStakingActivity?: (address: string) => void;
}

// Re-uses the same copy-button style + symbol as DelegatorPanel so the
// two panels read as a family.
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    // Try the modern Clipboard API first. It requires a secure
    // context (https or localhost); on plain http the browser
    // throws and we fall back to the legacy textarea + execCommand
    // path so users on http previews can still copy.
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        ta.setAttribute("readonly", "");
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.warn(
        `[CopyButton] copy failed: ${e instanceof Error ? e.message : e}`,
      );
    }
  };
  return (
    <button
      type="button"
      className="staking-panel-copy"
      onClick={copy}
      title="Copy to clipboard"
      aria-label="Copy"
    >
      {copied ? "✓" : "⧉"}
    </button>
  );
}

function mintscanAddress(address: string): string {
  return `https://www.mintscan.io/coreum/address/${address}`;
}

function relativeTime(iso: string, now: number): string {
  const ms = now - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 60 * 60_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 24 * 60 * 60_000) return `${Math.floor(ms / (60 * 60_000))}h ago`;
  return `${Math.floor(ms / (24 * 60 * 60_000))}d ago`;
}

export default function AddressFlowPanel({
  address,
  windowKey,
  onClose,
  onViewStakingActivity,
}: Props) {
  const [data, setData] = useState<AddressFlowResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Tick the clock so "Xm ago" stays fresh for as long as the panel
  // is open. 30s matches the cadence used elsewhere on the site.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Esc to close + lock body scroll while open. Same UX as the other
  // panels in the project.
  useEffect(() => {
    if (!address) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [address, onClose]);

  // Fetch fresh data whenever the target address or window changes.
  // We re-fetch on window change so the panel stays consistent with
  // the chip the user picked even if they change it without closing
  // the panel first.
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/flows-address?address=${encodeURIComponent(address)}&window=${windowKey}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as AddressFlowResponse;
        if (cancelled) return;
        setData(json);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address, windowKey]);

  if (!address) return null;

  const directionLabel =
    data && Math.abs(data.summary.net) < 1
      ? "balanced"
      : data && data.summary.net < 0
        ? "depositing more than withdrawing"
        : data
          ? "withdrawing more than depositing"
          : "";
  const directionClass =
    data && data.summary.net < 0
      ? "flow-card-net-in"
      : data && data.summary.net > 0
        ? "flow-card-net-out"
        : "";

  return (
    <>
      <div className="staking-feed-panel-backdrop" onClick={onClose} />
      <div
        className="staking-feed-panel address-flow-panel"
        role="dialog"
        aria-modal="true"
      >
        <button
          type="button"
          className="staking-panel-close"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>

        {/* ─── Header: window pill + label + address ─── */}
        <div className="delegator-panel-header">
          <div className="delegator-panel-rank">
            {/* Replace the RANK pill from DelegatorPanel with the
                window context — important for users to remember which
                time slice the numbers below reflect. */}
            <span className="delegator-panel-rank-text">
              FLOWS · {WINDOW_LABELS[windowKey]}
            </span>
            {data?.rank != null && (
              <span className="address-flow-panel-whale-tag">
                Top #{data.rank}
              </span>
            )}
          </div>
          <div className="delegator-panel-address-row">
            <a
              href={mintscanAddress(address)}
              target="_blank"
              rel="noopener noreferrer"
              className="staking-panel-link staking-panel-mono delegator-panel-address"
              title="View on Mintscan"
            >
              {address}
            </a>
            <CopyButton text={address} />
          </div>
          {data?.label && (
            <div
              className={`delegator-panel-label whale-label-${(data.labelType ?? "unlabeled").replace("+", "-")}`}
            >
              {data.label}
            </div>
          )}
        </div>

        {/* Loading / error states */}
        {loading && !data && (
          <div className="address-flow-panel-loading">Loading flows…</div>
        )}
        {error && (
          <div className="flows-error" style={{ marginTop: 12 }}>
            Could not load: {error}
          </div>
        )}

        {data && (
          <>
            {/* ─── Headline net + sub ─── */}
            <div className={`delegator-panel-stat ${directionClass}`}>
              {data.summary.net > 0 ? "+" : data.summary.net < 0 ? "−" : ""}
              {formatLargeNumber(Math.abs(data.summary.net))} TX
            </div>
            <div className="delegator-panel-stat-sub">
              net · {directionLabel} · {data.summary.txCount.toLocaleString()} transfers
            </div>

            {/* ─── Two-column summary cards ─── */}
            <div className="address-flow-summary">
              <div className="address-flow-summary-card">
                <div className="address-flow-summary-label">Sent to exchanges</div>
                <div className="address-flow-summary-value flow-card-net-in">
                  {formatLargeNumber(data.summary.totalSentToExchanges)} TX
                </div>
              </div>
              <div className="address-flow-summary-card">
                <div className="address-flow-summary-label">Received from exchanges</div>
                <div className="address-flow-summary-value flow-card-net-out">
                  {formatLargeNumber(data.summary.totalReceivedFromExchanges)} TX
                </div>
              </div>
            </div>

            {/* ─── Per-exchange breakdown ─── */}
            {data.perExchange.length > 0 && (
              <div className="staking-panel-section">
                <div className="staking-panel-section-title">Per-exchange breakdown</div>
                <div className="address-flow-per-exchange">
                  {data.perExchange.map((e) => (
                    <div key={e.exchangeAddress} className="address-flow-per-exchange-row">
                      <span className="address-flow-per-exchange-name">{e.exchange}</span>
                      <span className="address-flow-per-exchange-detail">
                        <span className="flow-card-net-in">
                          {formatLargeNumber(e.sentToExchange)} sent
                        </span>
                        {" · "}
                        <span className="flow-card-net-out">
                          {formatLargeNumber(e.receivedFromExchange)} recv
                        </span>
                      </span>
                      <span
                        className={`address-flow-per-exchange-net ${
                          e.net < 0 ? "flow-card-net-in" : e.net > 0 ? "flow-card-net-out" : ""
                        }`}
                      >
                        net {e.net > 0 ? "+" : e.net < 0 ? "−" : ""}
                        {formatLargeNumber(Math.abs(e.net))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ─── Recent transfers ─── */}
            {data.recent.length > 0 && (
              <div className="staking-panel-section">
                <div className="staking-panel-section-title">
                  Recent transfers · last {data.recent.length}
                </div>
                <div className="address-flow-recent">
                  {data.recent.map((r) => {
                    // From the wallet's perspective:
                    //   inflow  to the exchange = wallet SENT (outgoing)
                    //   outflow from the exchange = wallet RECEIVED (incoming)
                    const wallet_received = r.direction === "outflow";
                    return (
                      <div
                        key={`${r.txHash}-${r.exchangeAddress}`}
                        className="address-flow-recent-row"
                      >
                        <span className="address-flow-recent-time">
                          {relativeTime(r.timestamp, now)}
                        </span>
                        <span
                          className={`address-flow-recent-amount ${wallet_received ? "flow-card-net-out" : "flow-card-net-in"}`}
                        >
                          {wallet_received ? "+" : "−"}
                          {formatLargeNumber(r.amount)} TX
                        </span>
                        <span className="address-flow-recent-direction">
                          {wallet_received ? "received from" : "sent to"}{" "}
                          <strong>{r.exchange}</strong>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ─── Whale shortcut ─── */}
            {data.rank != null && onViewStakingActivity && (
              <button
                type="button"
                className="address-flow-staking-button"
                onClick={() => onViewStakingActivity(address)}
              >
                View staking activity →
              </button>
            )}

            {data.summary.txCount === 0 && (
              <div className="address-flow-empty">
                No exchange flows for this address in the {WINDOW_LABELS[windowKey]}{" "}
                window. Try a longer window from the chips at the top of the tab.
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
