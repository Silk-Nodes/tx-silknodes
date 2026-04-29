"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ReferenceLine,
} from "recharts";
import { formatLargeNumber } from "@/lib/analytics-utils";
import AddressFlowPanel from "./AddressFlowPanel";

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
  points: Array<{ date: string; inflow: number; outflow: number; price: number | null }>;
  updatedAt: string;
}
interface DestinationsResponse {
  window: WindowKey;
  totalOutflow: number;
  buckets: Array<{
    category: "staked" | "other_exchange" | "private";
    amount: number;
    txCount: number;
    pct: number;
  }>;
  updatedAt: string;
}
interface CounterpartyRow {
  address: string;
  label: string | null;
  rank: number | null;
  totalAmount: number;
  txCount: number;
}
interface CounterpartiesResponse {
  window: WindowKey;
  depositors: CounterpartyRow[];
  withdrawers: CounterpartyRow[];
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
  const [destinations, setDestinations] = useState<DestinationsResponse | null>(null);
  const [counterparties, setCounterparties] = useState<CounterpartiesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Selected address drives the slide-in side panel. Clear on close.
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);

  // Sticky window pills — same pattern as the Analytics tab. The
  // header-level pill row carries the ref; once it scrolls out of
  // view the sticky-pills-bar copy appears pinned beneath the top
  // nav. Both pill rows drive the same windowKey state.
  const pillsRef = useRef<HTMLDivElement>(null);
  const [isSticky, setIsSticky] = useState(false);
  useEffect(() => {
    const el = pillsRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsSticky(!entry.isIntersecting),
      { threshold: 0, rootMargin: "-60px 0px 0px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Single fetch effect that pulls every Flows endpoint in parallel
  // so the chart, cards, destinations breakdown, leaderboard, and
  // feed all refresh in lockstep.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [tRes, hRes, rRes, dRes, cRes] = await Promise.all([
          fetch(`/api/flows?window=${windowKey}&t=${Date.now()}`, { cache: "no-store" }),
          fetch(`/api/flows-history?window=${windowKey}&t=${Date.now()}`, { cache: "no-store" }),
          // 200 = enough to power the client-side magnitude filter +
          // pagination without round-tripping for every page change.
          fetch(`/api/flows-recent?window=${windowKey}&limit=200&t=${Date.now()}`, { cache: "no-store" }),
          fetch(`/api/flows-destinations?window=${windowKey}&t=${Date.now()}`, { cache: "no-store" }),
          fetch(`/api/flows-counterparties?window=${windowKey}&limit=10&t=${Date.now()}`, { cache: "no-store" }),
        ]);
        if (!tRes.ok || !hRes.ok || !rRes.ok || !dRes.ok || !cRes.ok)
          throw new Error("HTTP error");
        const [t, h, r, d, c] = (await Promise.all([
          tRes.json(),
          hRes.json(),
          rRes.json(),
          dRes.json(),
          cRes.json(),
        ])) as [
          FlowsResponse,
          FlowsHistoryResponse,
          FlowsRecentResponse,
          DestinationsResponse,
          CounterpartiesResponse,
        ];
        if (cancelled) return;
        setTotals(t);
        setHistory(h);
        setRecent(r);
        setDestinations(d);
        setCounterparties(c);
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

  // Reusable window pill row — rendered both inside the header and
  // again as the sticky-on-scroll copy. Same buttons, same handler.
  const renderWindowPills = (extraClass = "") => (
    <div
      className={`flows-window-pills ${extraClass}`.trim()}
      role="radiogroup"
      aria-label="Window"
    >
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
  );

  return (
    <div className="flows-tab">
      {/* Sticky-on-scroll copy of the window selector. Mounts only
          while the header-level pills are out of view, mirroring the
          Analytics tab pattern (.sticky-pills-bar position: fixed). */}
      {isSticky && <div className="sticky-pills-bar">{renderWindowPills()}</div>}

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
        <div ref={pillsRef}>{renderWindowPills()}</div>
      </div>

      {error && (
        <div className="flows-error">
          Could not load flows: {error}. Retrying every minute.
        </div>
      )}

      {/* ─── Daily flow chart with price overlay ─── */}
      {history && history.points.length > 0 && <FlowsChart points={history.points} />}

      {/* ─── Withdrawal destinations breakdown ─── */}
      {destinations && destinations.totalOutflow > 0 && (
        <DestinationsSection data={destinations} />
      )}

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

      {/* ─── Top counterparties leaderboard ─── */}
      {counterparties && (
        <CounterpartiesSection
          depositors={counterparties.depositors}
          withdrawers={counterparties.withdrawers}
          onAddressClick={setSelectedAddress}
        />
      )}

      {/* ─── Recent flows feed ─── */}
      {recent && <RecentFlowsFeed flows={recent.flows} onAddressClick={setSelectedAddress} />}

      {/* ─── Address details panel (slides in from right) ─── */}
      <AddressFlowPanel
        address={selectedAddress}
        windowKey={windowKey}
        onClose={() => setSelectedAddress(null)}
      />

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

function FlowsChart({
  points,
}: {
  points: Array<{ date: string; inflow: number; outflow: number; price: number | null }>;
}) {
  // Recharts wants negative values to render below zero. We negate
  // outflow on the way in, then re-positive it on the way out for the
  // tooltip so users see the absolute number, not "-1.2M".
  const chartData = useMemo(
    () => points.map((p) => ({ ...p, outflowNeg: -p.outflow })),
    [points],
  );
  // Whether we have any price data at all in this window — if not, we
  // skip rendering the price line + secondary axis so the chart
  // doesn't show an empty "USD" axis.
  const hasPrice = useMemo(() => points.some((p) => p.price != null), [points]);

  // Manual price-axis domain + tick formatter. Recharts' `auto` domain
  // hugs the data tightly, which combined with `monotone` smoothing
  // makes the line balloon way outside the visible plot area on
  // sparse windows (a 7D view with 4 price points was showing the
  // line above the top tick). We compute min/max ourselves and add
  // 8% padding so the line stays inside the panel; tick decimals
  // scale with the range so we don't render '$0.0091 / $0.0091 /
  // $0.0091' duplicate labels when the spread is narrow.
  const { priceDomain, priceTickFormatter, priceTooltipFormatter } = useMemo(() => {
    const prices = points
      .map((p) => p.price)
      .filter((v): v is number => v != null && Number.isFinite(v));
    if (prices.length === 0) {
      return {
        priceDomain: ["auto", "auto"] as [number | string, number | string],
        priceTickFormatter: (v: number) => `$${v.toFixed(4)}`,
        priceTooltipFormatter: (v: number) => `$${v.toFixed(4)}`,
      };
    }
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const span = max - min;
    // Padding scales with the span. Tiny spreads (sub-cent stable
    // coins) get a relative 8% pad on top of the value itself; bigger
    // spreads just use 8% of the span.
    const pad = span > 0 ? span * 0.08 : Math.max(max * 0.005, 0.0001);
    const lo = Math.max(0, min - pad);
    const hi = max + pad;

    // Decimals: pick enough to actually distinguish neighbouring
    // ticks. log10 of the span gives the order of magnitude; 2 extra
    // digits below that keeps adjacent ticks readable.
    const decimals = span > 0
      ? Math.min(8, Math.max(2, Math.ceil(-Math.log10(span)) + 1))
      : 5;
    const fmt = (v: number) => `$${v.toFixed(decimals)}`;
    return {
      priceDomain: [lo, hi] as [number, number],
      priceTickFormatter: fmt,
      priceTooltipFormatter: fmt,
    };
  }, [points]);

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

  // Neon (#B1FC03) is the brand colour but it washes out badly on
  // the cream light-mode background. The price line and right-axis
  // ticks need a darker olive in light mode while keeping the neon
  // on dark mode where it sings against the deep green background.
  const priceStroke = isDark ? "#B1FC03" : "#3f6212";
  const priceDotStroke = isDark ? "#0f1b07" : "#FAFFE4";
  const priceTickFill = isDark ? "rgba(177,252,3,0.7)" : "#3f6212";
  const flowTickFill = isDark ? "rgba(244,241,235,0.55)" : "rgba(59,45,38,0.65)";
  const xTickFill = isDark ? "rgba(244,241,235,0.55)" : "rgba(59,45,38,0.65)";

  return (
    <div className="flows-chart-card">
      <div className="flows-chart-header">
        <span className="flows-chart-title">Daily Flow {hasPrice ? "+ Price" : ""}</span>
        <span className="flows-chart-legend">
          <span className="flows-chart-legend-item">
            <span className="flows-chart-legend-swatch flows-chart-legend-in" /> Inflow
          </span>
          <span className="flows-chart-legend-item">
            <span className="flows-chart-legend-swatch flows-chart-legend-out" /> Outflow
          </span>
          {hasPrice && (
            <span className="flows-chart-legend-item">
              <span className="flows-chart-legend-swatch flows-chart-legend-price" /> Price (USD)
            </span>
          )}
        </span>
      </div>
      <div style={{ width: "100%", height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 12, right: hasPrice ? 56 : 12, bottom: 4, left: 0 }} stackOffset="sign">
            <CartesianGrid strokeDasharray="4 4" stroke="rgba(59,45,38,0.06)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(d: string) => {
                const dt = new Date(d + "T00:00:00");
                return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][dt.getMonth()]} ${dt.getDate()}`;
              }}
              tick={{ fill: xTickFill, fontSize: 10, fontFamily: "var(--font-mono)" }}
              axisLine={false}
              tickLine={false}
              interval={Math.max(0, Math.floor(chartData.length / 8))}
              dy={6}
            />
            {/* Primary axis: inflow/outflow volume in TX */}
            <YAxis
              yAxisId="flow"
              tickFormatter={(v: number) => formatLargeNumber(Math.abs(v))}
              tick={{ fill: flowTickFill, fontSize: 10, fontFamily: "var(--font-mono)" }}
              axisLine={false}
              tickLine={false}
              width={55}
            />
            {/* Secondary axis: TX price in USD. Only mount when we
                actually have price data so the axis labels don't
                appear on empty windows. */}
            {hasPrice && (
              <YAxis
                yAxisId="price"
                orientation="right"
                domain={priceDomain}
                allowDataOverflow={false}
                tickFormatter={priceTickFormatter}
                tick={{ fill: priceTickFill, fontSize: 10, fontFamily: "var(--font-mono)" }}
                axisLine={false}
                tickLine={false}
                width={64}
              />
            )}
            <ReferenceLine yAxisId="flow" y={0} stroke="rgba(0,0,0,0.15)" />
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
                if (name === "Inflow") return [`${formatLargeNumber(value)} TX`, "Inflow"];
                if (name === "Outflow") return [`${formatLargeNumber(Math.abs(value))} TX`, "Outflow"];
                if (name === "Price") return [priceTooltipFormatter(value), "Price"];
                return [value, name];
              }}
            />
            <Bar yAxisId="flow" dataKey="inflow"     name="Inflow"  stackId="flow" fill="#c45a4a" radius={[3, 3, 0, 0]} />
            <Bar yAxisId="flow" dataKey="outflowNeg" name="Outflow" stackId="flow" fill="#4a7a1a" radius={[0, 0, 3, 3]} />
            {hasPrice && (
              <Line
                yAxisId="price"
                // Linear (sharp polyline) instead of monotone Bezier.
                // Bezier interpolation overshoots dramatically with
                // sparse data — a 7-day window with 4 price points
                // was producing curves that ballooned far above the
                // visible axis. Linear segments stay inside the
                // computed domain.
                type="linear"
                dataKey="price"
                name="Price"
                stroke={priceStroke}
                strokeWidth={2}
                // Dots make sparse data points readable at a glance,
                // and the activeDot still appears bigger on hover.
                dot={{ r: 2.5, fill: priceStroke, stroke: priceDotStroke, strokeWidth: 1 }}
                activeDot={{ r: 4, fill: priceStroke, stroke: priceDotStroke, strokeWidth: 2 }}
                isAnimationActive={false}
                connectNulls
              />
            )}
          </ComposedChart>
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

function RecentFlowsFeed({
  flows,
  onAddressClick,
}: {
  flows: RecentFlowRow[];
  onAddressClick: (address: string) => void;
}) {
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
            <FeedRow
              key={`${f.txHash}-${safePage}-${i}`}
              flow={f}
              onAddressClick={onAddressClick}
            />
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

function FeedRow({
  flow,
  onAddressClick,
}: {
  flow: RecentFlowRow;
  onAddressClick: (address: string) => void;
}) {
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
        {/* Counterparty is the only clickable cell — that's the
            interesting target. Exchange names stay non-interactive
            in v1 (they have cards above already). */}
        <button
          type="button"
          className="flows-feed-counterparty flows-feed-counterparty-button"
          onClick={() => onAddressClick(flow.counterparty)}
          title={flow.counterparty}
        >
          {cpDisplay}
        </button>
        {flow.counterpartyRank != null && (
          <span className="flows-feed-whale-tag">Top #{flow.counterpartyRank}</span>
        )}
      </span>
    </div>
  );
}

// ─── DestinationsSection ──────────────────────────────────────────────
// "Where do withdrawals go?" — three cards split by destination type.
// Total is always the sum of the three so percentages add up to 100.

const DESTINATION_META: Record<
  "staked" | "other_exchange" | "private",
  { label: string; tone: "good" | "neutral" | "warn"; description: string }
> = {
  staked: {
    label: "Staked",
    tone: "good",
    description: "Outflow to wallets that staked within 7 days — bullish signal",
  },
  other_exchange: {
    label: "Other Exchange",
    tone: "neutral",
    description: "Rotation between exchanges — neither bullish nor bearish",
  },
  private: {
    label: "Private Wallet",
    tone: "neutral",
    description: "Cold storage / personal wallets / unidentified destinations",
  },
};

function DestinationsSection({ data }: { data: DestinationsResponse }) {
  return (
    <div className="flows-destinations">
      <div className="flows-destinations-header">
        <span className="flows-chart-title">Where Withdrawals Go</span>
        <span className="flows-feed-count">
          {formatLargeNumber(data.totalOutflow)} TX over {data.window.toUpperCase()}
        </span>
      </div>
      <div className="flows-destinations-grid">
        {data.buckets.map((b) => {
          const meta = DESTINATION_META[b.category];
          return (
            <div key={b.category} className={`flows-destination-card flows-destination-${meta.tone}`}>
              <div className="flows-destination-label">{meta.label}</div>
              <div className="flows-destination-pct">{b.pct.toFixed(1)}%</div>
              <div className="flows-destination-amount">
                {formatLargeNumber(b.amount)} TX · {b.txCount.toLocaleString()} tx
              </div>
              <div className="flows-destination-desc">{meta.description}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── CounterpartiesSection ────────────────────────────────────────────
// Top-N depositors and withdrawers side-by-side. Each row shows the
// counterparty's known label (when available), top_delegators rank
// (whale tag), aggregate amount and tx count.

function CounterpartiesSection({
  depositors,
  withdrawers,
  onAddressClick,
}: {
  depositors: CounterpartyRow[];
  withdrawers: CounterpartyRow[];
  onAddressClick: (address: string) => void;
}) {
  if (depositors.length === 0 && withdrawers.length === 0) return null;
  return (
    <div className="flows-counterparties">
      <CounterpartyList
        title="Top Depositors"
        subtitle="largest senders TO exchanges"
        rows={depositors}
        direction="inflow"
        onAddressClick={onAddressClick}
      />
      <CounterpartyList
        title="Top Withdrawers"
        subtitle="largest receivers FROM exchanges"
        rows={withdrawers}
        direction="outflow"
        onAddressClick={onAddressClick}
      />
    </div>
  );
}

function CounterpartyList({
  title,
  subtitle,
  rows,
  direction,
  onAddressClick,
}: {
  title: string;
  subtitle: string;
  rows: CounterpartyRow[];
  direction: "inflow" | "outflow";
  onAddressClick: (address: string) => void;
}) {
  const directionClass = direction === "inflow" ? "flow-card-net-in" : "flow-card-net-out";
  return (
    <div className="flows-counterparty-card">
      <div className="flows-counterparty-header">
        <span className="flows-chart-title">{title}</span>
        <span className="flows-feed-count">{subtitle}</span>
      </div>
      {rows.length === 0 ? (
        <div className="flows-feed-empty-text">No data in this window.</div>
      ) : (
        <ol className="flows-counterparty-list">
          {rows.map((r, i) => (
            <li
              key={r.address}
              className="flows-counterparty-row flows-counterparty-row-clickable"
              role="button"
              tabIndex={0}
              onClick={() => onAddressClick(r.address)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onAddressClick(r.address);
                }
              }}
              title={r.address}
              aria-label={`Open details for ${r.label ?? r.address}`}
            >
              <span className="flows-counterparty-rank">#{i + 1}</span>
              <span className="flows-counterparty-name">
                {r.label ?? truncate(r.address)}
                {r.rank != null && (
                  <span className="flows-feed-whale-tag">Top #{r.rank}</span>
                )}
              </span>
              <span className={`flows-counterparty-amount ${directionClass}`}>
                {formatLargeNumber(r.totalAmount)} TX
              </span>
              <span className="flows-counterparty-count">
                {r.txCount.toLocaleString()} tx
              </span>
            </li>
          ))}
        </ol>
      )}
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
  // Plain English labels. The previous "accumulating / distributing"
  // wording read as finance jargon and several users got the polarity
  // backwards (distributing reads like "selling" in TradFi, but here
  // it means coins LEAVING the exchange, which is bullish).
  const directionLabel =
    direction === "in"
      ? "more coins going IN"
      : direction === "out"
        ? "more coins going OUT"
        : "roughly even";
  const directionTooltip =
    direction === "in"
      ? "More coins going IN than out of exchanges in this window. Often interpreted as sell pressure. Users are moving TX onto exchanges, typically to sell."
      : direction === "out"
        ? "More coins going OUT than in from exchanges in this window. Often interpreted as bullish. Users are moving TX off exchanges, typically to hold or stake."
        : "Inflow and outflow are roughly equal in this window. No clear directional signal.";

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
      <div className="flow-card-direction">
        {/* Hoverable wrapper + visible (?) icon. Both the word and the
            icon trigger the same tooltip so desktop users get hover
            and mobile users see something tappable. tabIndex makes
            the bubble keyboard-focusable. */}
        <span
          className="flow-card-direction-tip"
          tabIndex={0}
          role="button"
          aria-label={`${directionLabel}. ${directionTooltip}`}
        >
          <span className="flow-card-direction-label">{directionLabel}</span>
          <span className="flow-card-direction-tip-icon" aria-hidden="true">?</span>
          <span className="flow-card-direction-tip-bubble" role="tooltip">
            {directionTooltip}
          </span>
        </span>
      </div>
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
