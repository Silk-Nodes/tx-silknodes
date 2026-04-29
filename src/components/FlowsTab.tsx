"use client";

import { useEffect, useMemo, useState } from "react";
import { formatLargeNumber } from "@/lib/analytics-utils";

// /api/flows response shape (kept inline rather than imported so the
// component is self-contained and easy to reason about). Numbers are
// already in TX (not ucore) — converted server-side.
interface ExchangeFlowRow {
  name: string;
  address: string;
  inflow: number;
  outflow: number;
  net: number;
  txCount: number;
  latestAt: string | null;
}
interface FlowsResponse {
  window: WindowKey;
  totals: { inflow: number; outflow: number; net: number; txCount: number };
  exchanges: ExchangeFlowRow[];
  updatedAt: string;
}

const WINDOWS = ["24h", "7d", "30d", "90d"] as const;
type WindowKey = (typeof WINDOWS)[number];
const WINDOW_LABELS: Record<WindowKey, string> = {
  "24h": "24H",
  "7d": "7D",
  "30d": "30D",
  "90d": "90D",
};

const POLL_INTERVAL_MS = 60_000;

export default function FlowsTab() {
  const [windowKey, setWindowKey] = useState<WindowKey>("24h");
  const [data, setData] = useState<FlowsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/flows?window=${windowKey}&t=${Date.now()}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as FlowsResponse;
        if (cancelled) return;
        setData(json);
        setError(null);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    };
    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [windowKey]);

  // Sort exchanges by net flow magnitude descending so the biggest
  // signal lands at the top. Stable for ties.
  const sortedExchanges = useMemo(
    () =>
      data?.exchanges
        ?.slice()
        .sort((a, b) => Math.abs(b.net) - Math.abs(a.net)) ?? [],
    [data?.exchanges],
  );

  return (
    <div className="flows-tab">
      {/* ─── Header + window selector ─── */}
      <div className="section-head">
        <div>
          <h2 className="page-title">Exchange Flows</h2>
          <p className="page-sub">
            TX moving in and out of known centralized exchange wallets.
            Net &gt; 0 = exchange is accumulating (potential sell pressure);
            net &lt; 0 = exchange is releasing (potential accumulation).
          </p>
        </div>
        <div className="flows-window-pills" role="radiogroup" aria-label="Window">
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              role="radio"
              aria-checked={windowKey === w}
              className={`flows-window-pill ${windowKey === w ? "active" : ""}`}
              onClick={() => setWindowKey(w)}
            >
              {WINDOW_LABELS[w]}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="flows-error">
          Could not load flows: {error}. Retrying every minute.
        </div>
      )}

      {/* ─── Total card (full width, prominent) ─── */}
      {data && (
        <FlowCard
          name="Total"
          isTotal
          inflow={data.totals.inflow}
          outflow={data.totals.outflow}
          net={data.totals.net}
          txCount={data.totals.txCount}
        />
      )}

      {/* ─── Per-exchange grid ─── */}
      {data && (
        <div className="flows-grid">
          {sortedExchanges.map((e) => (
            <FlowCard
              key={e.address}
              name={e.name}
              inflow={e.inflow}
              outflow={e.outflow}
              net={e.net}
              txCount={e.txCount}
              latestAt={e.latestAt}
            />
          ))}
        </div>
      )}

      {!data && !error && (
        <div className="flows-loading">Loading flows…</div>
      )}
    </div>
  );
}

// ─── FlowCard ──────────────────────────────────────────────────────────
// One card per exchange (and one for the aggregate Total). The headline
// is the NET number with a green/red sign so the trader signal is
// readable in a glance; in/out are shown on a second line as supporting
// detail.
function FlowCard({
  name,
  inflow,
  outflow,
  net,
  txCount,
  latestAt,
  isTotal = false,
}: {
  name: string;
  inflow: number;
  outflow: number;
  net: number;
  txCount: number;
  latestAt?: string | null;
  isTotal?: boolean;
}) {
  // Direction: "accumulating" (net > 0) is bearish on price, so red.
  // "distributing" (net < 0) is bullish, so green. Magnitude breaks
  // a near-zero quiet window into a neutral state instead of flickering.
  const NEAR_ZERO_TX = 1000;
  const direction =
    Math.abs(net) < NEAR_ZERO_TX ? "neutral" : net > 0 ? "in" : "out";
  const directionLabel =
    direction === "in"
      ? "accumulating"
      : direction === "out"
        ? "distributing"
        : "balanced";

  const sign = net > 0 ? "+" : net < 0 ? "−" : "";
  const fmt = (n: number) => formatLargeNumber(Math.abs(n));

  return (
    <div className={`flow-card ${isTotal ? "flow-card-total" : ""} flow-card-${direction}`}>
      <div className="flow-card-header">
        <span className="flow-card-name">{name}</span>
        <span className="flow-card-tx-count">{txCount.toLocaleString()} tx</span>
      </div>
      <div className={`flow-card-net flow-card-net-${direction}`}>
        {sign}
        {fmt(net)} TX
      </div>
      <div className="flow-card-direction">{directionLabel}</div>
      <div className="flow-card-breakdown">
        <span className="flow-card-in">↓ {fmt(inflow)} in</span>
        <span className="flow-card-out">↑ {fmt(outflow)} out</span>
      </div>
      {latestAt && (
        <div className="flow-card-latest">
          last activity {new Date(latestAt).toLocaleString()}
        </div>
      )}
    </div>
  );
}
