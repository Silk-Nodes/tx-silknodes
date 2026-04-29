"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ReferenceLine,
} from "recharts";
import { formatLargeNumber } from "@/lib/analytics-utils";

// ─── Types mirror the API response shapes ─────────────────────────────

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
interface FlowsHistoryResponse {
  window: WindowKey;
  points: Array<{ date: string; inflow: number; outflow: number }>;
  updatedAt: string;
}
interface RecentFlowRow {
  txHash: string;
  timestamp: string;
  exchange: string;
  exchangeAddress: string;
  direction: "inflow" | "outflow";
  counterparty: string;
  counterpartyLabel: string | null;
  counterpartyRank: number | null;
  amount: number;
}
interface FlowsRecentResponse {
  window: WindowKey;
  flows: RecentFlowRow[];
  updatedAt: string;
}

const WINDOWS = ["24h", "7d", "30d", "90d", "all"] as const;
type WindowKey = (typeof WINDOWS)[number];
const WINDOW_LABELS: Record<WindowKey, string> = {
  "24h": "24H",
  "7d": "7D",
  "30d": "30D",
  "90d": "90D",
  all: "ALL",
};

const POLL_INTERVAL_MS = 60_000;

// ─── Component ────────────────────────────────────────────────────────

export default function FlowsTab() {
  const [windowKey, setWindowKey] = useState<WindowKey>("24h");
  const [totals, setTotals] = useState<FlowsResponse | null>(null);
  const [history, setHistory] = useState<FlowsHistoryResponse | null>(null);
  const [recent, setRecent] = useState<FlowsRecentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Single fetch effect that pulls all 3 endpoints in parallel. Keeps
  // them on the same poll cadence so the chart, cards, and feed all
  // refresh in lockstep.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [tRes, hRes, rRes] = await Promise.all([
          fetch(`/api/flows?window=${windowKey}&t=${Date.now()}`, { cache: "no-store" }),
          fetch(`/api/flows-history?window=${windowKey}&t=${Date.now()}`, { cache: "no-store" }),
          // 200 = enough to power the client-side magnitude filter +
          // pagination without round-tripping for every page change.
          fetch(`/api/flows-recent?window=${windowKey}&limit=200&t=${Date.now()}`, { cache: "no-store" }),
        ]);
        if (!tRes.ok || !hRes.ok || !rRes.ok) throw new Error("HTTP error");
        const [t, h, r] = (await Promise.all([
          tRes.json(),
          hRes.json(),
          rRes.json(),
        ])) as [FlowsResponse, FlowsHistoryResponse, FlowsRecentResponse];
        if (cancelled) return;
        setTotals(t);
        setHistory(h);
        setRecent(r);
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

  // Sort exchanges by |net| descending so the biggest signal is on top.
  const sortedExchanges = useMemo(
    () =>
      totals?.exchanges
        ?.slice()
        .sort((a, b) => Math.abs(b.net) - Math.abs(a.net)) ?? [],
    [totals?.exchanges],
  );

  return (
    <div className="flows-tab">
      {/* ─── Header + window selector ─── */}
      <div
        className="section-head"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        <div>
          <h1 className="page-title">Exchange Flows</h1>
          <span className="section-sub" style={{ fontSize: "0.8rem", opacity: 0.6 }}>
            Net &gt; 0 = exchange accumulating (sell pressure). Net &lt; 0 = exchange releasing (accumulation).
          </span>
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

      {/* ─── Daily flow chart ─── */}
      {history && history.points.length > 0 && <FlowsChart points={history.points} />}

      {/* ─── Total card (full width, prominent) ─── */}
      {totals && (
        <FlowCard
          name="Total"
          isTotal
          inflow={totals.totals.inflow}
          outflow={totals.totals.outflow}
          net={totals.totals.net}
          txCount={totals.totals.txCount}
        />
      )}

      {/* ─── Per-exchange grid ─── */}
      {totals && (
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

      {/* ─── Recent flows feed ─── */}
      {recent && <RecentFlowsFeed flows={recent.flows} />}

      {!totals && !error && (
        <div className="flows-loading">Loading flows…</div>
      )}
    </div>
  );
}

// ─── FlowsChart ────────────────────────────────────────────────────────
// Daily stacked bar chart. Inflow is rendered as a positive (red) bar
// above zero, outflow as a negative (green) bar below zero. The implicit
// net is the visible difference between the two — green-leaning days =
// outflow dominant = bullish; red-leaning = inflow dominant = bearish.

function FlowsChart({ points }: { points: Array<{ date: string; inflow: number; outflow: number }> }) {
  // Recharts wants negative values to render below zero. We negate
  // outflow on the way in, then re-positive it on the way out for the
  // tooltip so users see the absolute number, not "-1.2M".
  const chartData = useMemo(
    () => points.map((p) => ({ ...p, outflowNeg: -p.outflow })),
    [points],
  );

  // Recharts' cursor highlight needs a theme-aware fill: a black tint
  // is invisible on dark mode (black-on-dark) and a neon tint washes
  // out small bars on light mode. Track the data-theme attribute so we
  // can switch live when the user toggles theme.
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const root = typeof document !== "undefined" ? document.documentElement : null;
    if (!root) return;
    const update = () => setIsDark(root.getAttribute("data-theme") === "dark");
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  const cursorFill = isDark ? "rgba(177, 252, 3, 0.18)" : "rgba(0, 0, 0, 0.05)";

  return (
    <div className="flows-chart-card">
      <div className="flows-chart-header">
        <span className="flows-chart-title">Daily Flow</span>
        <span className="flows-chart-legend">
          <span className="flows-chart-legend-item">
            <span className="flows-chart-legend-swatch flows-chart-legend-in" /> Inflow
          </span>
          <span className="flows-chart-legend-item">
            <span className="flows-chart-legend-swatch flows-chart-legend-out" /> Outflow
          </span>
        </span>
      </div>
      <div style={{ width: "100%", height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 12, right: 12, bottom: 4, left: 0 }} stackOffset="sign">
            <CartesianGrid strokeDasharray="4 4" stroke="rgba(59,45,38,0.06)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(d: string) => {
                const dt = new Date(d + "T00:00:00");
                return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][dt.getMonth()]} ${dt.getDate()}`;
              }}
              tick={{ fill: "rgba(106,90,81,0.5)", fontSize: 10, fontFamily: "var(--font-mono)" }}
              axisLine={false}
              tickLine={false}
              interval={Math.max(0, Math.floor(chartData.length / 8))}
              dy={6}
            />
            <YAxis
              tickFormatter={(v: number) => formatLargeNumber(Math.abs(v))}
              tick={{ fill: "rgba(106,90,81,0.4)", fontSize: 10, fontFamily: "var(--font-mono)" }}
              axisLine={false}
              tickLine={false}
              width={55}
            />
            <ReferenceLine y={0} stroke="rgba(0,0,0,0.15)" />
            <RechartsTooltip
              // Theme-aware cursor highlight: black-tint on light mode
              // (subtle darken without colour bleed), neon-tint on dark
              // mode where black-on-dark would be invisible.
              cursor={{ fill: cursorFill }}
              contentStyle={{
                background: "rgba(15, 27, 7, 0.94)",
                color: "#f4f1eb",
                border: "1px solid rgba(177, 252, 3, 0.2)",
                borderRadius: 10,
                padding: "10px 14px",
                fontFamily: "var(--font-mono)",
                fontSize: "0.72rem",
              }}
              labelFormatter={(d: string) => {
                const dt = new Date(d + "T00:00:00");
                return dt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
              }}
              formatter={(value: number, name: string) => {
                if (name === "Inflow") {
                  return [`${formatLargeNumber(value)} TX`, "Inflow"];
                }
                if (name === "Outflow") {
                  return [`${formatLargeNumber(Math.abs(value))} TX`, "Outflow"];
                }
                return [value, name];
              }}
            />
            <Bar dataKey="inflow"    name="Inflow"  stackId="flow" fill="#c45a4a" radius={[3, 3, 0, 0]} />
            <Bar dataKey="outflowNeg" name="Outflow" stackId="flow" fill="#4a7a1a" radius={[0, 0, 3, 3]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── RecentFlowsFeed ──────────────────────────────────────────────────
// Last N flows ordered newest-first. Filterable by magnitude bucket,
// paginated 10 per page client-side. Whale tag (Top #N) = top_delegators
// rank when the counterparty is in the top 500.

type AmountBucket = "all" | "small" | "mid" | "large" | "whale";

const AMOUNT_BUCKETS: { key: AmountBucket; label: string; min: number; max: number }[] = [
  { key: "all",   label: "All",         min: 0,         max: Infinity },
  { key: "small", label: "0–10K",       min: 0,         max: 10_000 },
  { key: "mid",   label: "10K–100K",    min: 10_000,    max: 100_000 },
  { key: "large", label: "100K–1M",     min: 100_000,   max: 1_000_000 },
  { key: "whale", label: "1M+",         min: 1_000_000, max: Infinity },
];

const PAGE_SIZE = 10;

function RecentFlowsFeed({ flows }: { flows: RecentFlowRow[] }) {
  const [bucket, setBucket] = useState<AmountBucket>("all");
  const [page, setPage] = useState(0);

  // Recompute the filtered + paged slice whenever input changes. Clamp
  // the page down if the user was on a higher page than the new filter
  // can support (otherwise switching filters could leave us on an
  // empty page).
  const filtered = useMemo(() => {
    const b = AMOUNT_BUCKETS.find((x) => x.key === bucket)!;
    return flows.filter((f) => {
      const a = Math.abs(f.amount);
      return a >= b.min && a < b.max;
    });
  }, [flows, bucket]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageFlows = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  // Counts per bucket so the chip labels can show "0–10K (37)" etc.
  // Pre-computed once per `flows` change so chip clicks don't recount.
  const counts = useMemo(() => {
    const c: Record<AmountBucket, number> = {
      all: flows.length, small: 0, mid: 0, large: 0, whale: 0,
    };
    for (const f of flows) {
      const a = Math.abs(f.amount);
      if (a < 10_000) c.small++;
      else if (a < 100_000) c.mid++;
      else if (a < 1_000_000) c.large++;
      else c.whale++;
    }
    return c;
  }, [flows]);

  return (
    <div className="flows-feed-card">
      <div className="flows-feed-header">
        <span className="flows-chart-title">Recent Flows</span>
        <span className="flows-feed-count">
          {filtered.length} of {flows.length}
        </span>
      </div>

      {/* Magnitude filter chips */}
      <div className="flows-feed-filter" role="radiogroup" aria-label="Filter by amount">
        {AMOUNT_BUCKETS.map((b) => (
          <button
            key={b.key}
            type="button"
            role="radio"
            aria-checked={bucket === b.key}
            className={`flows-feed-chip ${bucket === b.key ? "active" : ""}`}
            onClick={() => {
              setBucket(b.key);
              setPage(0); // reset to page 1 on filter change
            }}
          >
            {b.label} <span className="flows-feed-chip-count">{counts[b.key]}</span>
          </button>
        ))}
      </div>

      {pageFlows.length === 0 ? (
        <div className="flows-feed-empty-text">No flows match this filter.</div>
      ) : (
        <div className="flows-feed-list">
          {pageFlows.map((f, i) => (
            <FeedRow key={`${f.txHash}-${safePage}-${i}`} flow={f} />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flows-feed-pager" aria-label="Pagination">
          <button
            type="button"
            className="flows-feed-pager-btn"
            disabled={safePage === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            aria-label="Previous page"
          >
            ‹ Prev
          </button>
          <span className="flows-feed-pager-status">
            Page {safePage + 1} of {totalPages}
          </span>
          <button
            type="button"
            className="flows-feed-pager-btn"
            disabled={safePage >= totalPages - 1}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            aria-label="Next page"
          >
            Next ›
          </button>
        </div>
      )}
    </div>
  );
}

function FeedRow({ flow }: { flow: RecentFlowRow }) {
  const sign = flow.direction === "inflow" ? "+" : "−";
  const directionClass = flow.direction === "inflow" ? "flow-card-net-in" : "flow-card-net-out";
  const arrow = flow.direction === "inflow" ? "→" : "←";
  const cpDisplay = flow.counterpartyLabel
    ? flow.counterpartyLabel
    : truncate(flow.counterparty);

  return (
    <div className="flows-feed-row">
      <span className="flows-feed-time">{relativeTime(flow.timestamp)}</span>
      <span className={`flows-feed-amount ${directionClass}`}>
        {sign}
        {formatLargeNumber(Math.abs(flow.amount))} TX
      </span>
      <span className="flows-feed-route">
        <span className="flows-feed-exchange">{flow.exchange}</span>
        <span className="flows-feed-arrow">{arrow}</span>
        <span className="flows-feed-counterparty" title={flow.counterparty}>
          {cpDisplay}
        </span>
        {flow.counterpartyRank != null && (
          <span className="flows-feed-whale-tag">Top #{flow.counterpartyRank}</span>
        )}
      </span>
    </div>
  );
}

function truncate(addr: string): string {
  if (!addr) return "";
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 60 * 60_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 24 * 60 * 60_000) return `${Math.floor(ms / (60 * 60_000))}h ago`;
  return `${Math.floor(ms / (24 * 60 * 60_000))}d ago`;
}

// ─── FlowCard ──────────────────────────────────────────────────────────

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
  // Direction colour: net > 0 (accumulating) → bearish → red.
  // net < 0 (distributing) → bullish → green. Near-zero is neutral so
  // a balanced quiet window doesn't flicker.
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

  // Total card needs higher precision so users see the actual delta —
  // when both inflow and outflow round to the same M-figure, the net
  // looks like a fluke. Per-exchange cards stick to compact format
  // because their absolute numbers are smaller and don't suffer from
  // this rounding collision.
  const fmt = (n: number) => formatLargeNumber(Math.abs(n));
  const fmtPrecise = (n: number) =>
    isTotal && Math.abs(n) >= 1_000_000
      ? `${(Math.abs(n) / 1_000_000).toFixed(2)}M`
      : formatLargeNumber(Math.abs(n));

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
        <span className="flow-card-in">↓ {fmtPrecise(inflow)} in</span>
        <span className="flow-card-out">↑ {fmtPrecise(outflow)} out</span>
      </div>
      {latestAt && (
        <div className="flow-card-latest">
          last activity {new Date(latestAt).toLocaleString()}
        </div>
      )}
    </div>
  );
}
