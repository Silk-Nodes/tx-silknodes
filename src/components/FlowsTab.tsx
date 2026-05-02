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
  exchanges?: Array<{ address: string; name: string }>;
  heatmap?: Array<{
    date: string;
    cells: Array<{ address: string; inflow: number; outflow: number; net: number }>;
  }>;
  updatedAt: string;
}
type DestinationCategory =
  | "staked"
  | "other_exchange"
  | "bridge"
  | "dex"
  | "contract"
  | "private";
interface DestinationsResponse {
  window: WindowKey;
  totalOutflow: number;
  buckets: Array<{
    category: DestinationCategory;
    amount: number;
    txCount: number;
    pct: number;
  }>;
  updatedAt: string;
}
interface PrivateDestination {
  address: string;
  totalAmount: number;
  txCount: number;
  label: string | null;
  type: string | null;
}
interface PrivateDestinationsResponse {
  window: WindowKey;
  limit: number;
  destinations: PrivateDestination[];
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
  // Prior-period totals power the "this period vs last period" panel
  // and the per-exchange delta arrows. Same shape as `totals`, just
  // fetched with prev=true so the SUMs cover the prior window.
  const [prevTotals, setPrevTotals] = useState<FlowsResponse | null>(null);
  // Top private-bucket destinations for the audit panel. Lets the
  // team see which addresses are sitting in "Private Wallet" so they
  // can be labelled in known_entities (Phase 2 of the classifier
  // accuracy work).
  const [privateDests, setPrivateDests] = useState<PrivateDestinationsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Selected address drives the slide-in side panel. Clear on close.
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  // Address search input (#1). Submits to selectedAddress so the same
  // slide-in panel handles paste-an-address lookups.
  const [searchValue, setSearchValue] = useState("");

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
        // ALL window has no prior period; skip the second flows fetch
        // for that case. Everything else fans out in parallel so the
        // slowest endpoint is the only thing the user waits on.
        const wantsPrev = windowKey !== "all";
        const fetches = [
          fetch(`/api/flows?window=${windowKey}&t=${Date.now()}`, { cache: "no-store" }),
          fetch(`/api/flows-history?window=${windowKey}&t=${Date.now()}`, { cache: "no-store" }),
          // 200 = enough to power the client-side magnitude filter +
          // pagination without round-tripping for every page change.
          fetch(`/api/flows-recent?window=${windowKey}&limit=200&t=${Date.now()}`, { cache: "no-store" }),
          fetch(`/api/flows-destinations?window=${windowKey}&t=${Date.now()}`, { cache: "no-store" }),
          fetch(`/api/flows-counterparties?window=${windowKey}&limit=10&t=${Date.now()}`, { cache: "no-store" }),
          fetch(`/api/flows-private-destinations?window=${windowKey}&limit=20&t=${Date.now()}`, { cache: "no-store" }),
        ];
        if (wantsPrev) {
          fetches.push(
            fetch(`/api/flows?window=${windowKey}&prev=true&t=${Date.now()}`, { cache: "no-store" }),
          );
        }
        const responses = await Promise.all(fetches);
        const [tRes, hRes, rRes, dRes, cRes, pdRes, pRes] = responses;
        if (!tRes.ok || !hRes.ok || !rRes.ok || !dRes.ok || !cRes.ok || !pdRes.ok)
          throw new Error("HTTP error");
        if (wantsPrev && (!pRes || !pRes.ok)) throw new Error("HTTP error (prev)");
        const jsonPromises = [
          tRes.json(),
          hRes.json(),
          rRes.json(),
          dRes.json(),
          cRes.json(),
          pdRes.json(),
        ];
        if (wantsPrev && pRes) jsonPromises.push(pRes.json());
        const parsed = await Promise.all(jsonPromises);
        const [t, h, r, d, c, pd, p] = parsed;
        if (cancelled) return;
        setTotals(t as FlowsResponse);
        setHistory(h as FlowsHistoryResponse);
        setRecent(r as FlowsRecentResponse);
        setDestinations(d as DestinationsResponse);
        setCounterparties(c as CounterpartiesResponse);
        setPrivateDests(pd as PrivateDestinationsResponse);
        setPrevTotals(wantsPrev ? (p as FlowsResponse) : null);
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
        </div>
        <div ref={pillsRef}>{renderWindowPills()}</div>
      </div>

      {/* ─── Address search (#1). Submitting opens the slide-in
          AddressFlowPanel for the typed/pasted address. */}
      <form
        className="flows-search"
        onSubmit={(e) => {
          e.preventDefault();
          const v = searchValue.trim();
          if (v.length > 0) setSelectedAddress(v);
        }}
        role="search"
      >
        <input
          type="text"
          className="flows-search-input"
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          placeholder="Search any TX address (core1...) to see its flow history"
          spellCheck={false}
          autoComplete="off"
        />
        <button
          type="submit"
          className="flows-search-button"
          disabled={searchValue.trim().length === 0}
        >
          Inspect
        </button>
      </form>

      {error && (
        <div className="flows-error">
          Could not load flows: {error}. Retrying every minute.
        </div>
      )}

      {/* ─── Auto generated narrative summary ─── */}
      {totals && destinations && counterparties && (
        <FlowsSummary
          windowKey={windowKey}
          totals={totals.totals}
          exchanges={totals.exchanges}
          destinations={destinations}
          topWithdrawer={counterparties.withdrawers[0] ?? null}
          topDepositor={counterparties.depositors[0] ?? null}
        />
      )}

      {/* ─── Period vs prior period comparison (#8). Skipped for the
          ALL window which has no prior period. */}
      {totals && prevTotals && windowKey !== "all" && (
        <PeriodComparison
          windowKey={windowKey}
          current={totals.totals}
          previous={prevTotals.totals}
          currentExchanges={totals.exchanges}
          previousExchanges={prevTotals.exchanges}
        />
      )}

      {/* ─── Daily flow chart with price overlay ─── */}
      {history && history.points.length > 0 && <FlowsChart points={history.points} />}

      {/* ─── Per-exchange × day net flow heatmap (#6). Only renders
          when there are at least 2 days in the window so the matrix
          isn't a single column. */}
      {history && history.heatmap && history.heatmap.length >= 2 && history.exchanges && (
        <FlowsHeatmap heatmap={history.heatmap} exchanges={history.exchanges} />
      )}

      {/* ─── Withdrawal destinations Sankey (#5) ─── */}
      {destinations && destinations.totalOutflow > 0 && (
        <DestinationsSankey data={destinations} />
      )}

      {/* ─── Top private destinations audit panel.
          Collapsible. Helps the team identify untracked exchanges,
          bridges, and contracts that are inflating the Private bucket
          so they can be added to known_entities and re-classified. */}
      {privateDests && privateDests.destinations.length > 0 && (
        <PrivateDestinationsAudit data={privateDests} onAddressClick={setSelectedAddress} />
      )}

      {/* ─── Total card (full width, prominent). No delta — it's
          the aggregate, the per-exchange cards carry the deltas. */}
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

      {/* ─── Per-exchange grid with delta vs prior period (#4) ─── */}
      {totals && (
        <div className="flows-grid">
          {sortedExchanges.map((e) => {
            const prev =
              prevTotals?.exchanges.find((x) => x.address === e.address) ?? null;
            return (
              <FlowCard
                key={e.address}
                name={e.name}
                inflow={e.inflow}
                outflow={e.outflow}
                net={e.net}
                txCount={e.txCount}
                latestAt={e.latestAt}
                prevNet={prev?.net ?? null}
                prevTxCount={prev?.txCount ?? null}
              />
            );
          })}
        </div>
      )}

      {/* ─── Repeat counterparty patterns (#7). Surfaces addresses
          that appear in the recent feed multiple times so users see
          smart-money behaviour the raw feed buries. */}
      {recent && recent.flows.length > 0 && (
        <RepeatPatterns flows={recent.flows} onAddressClick={setSelectedAddress} />
      )}

      {/* ─── Top counterparties leaderboard ─── */}
      {counterparties && (
        <CounterpartiesSection
          depositors={counterparties.depositors}
          withdrawers={counterparties.withdrawers}
          onAddressClick={setSelectedAddress}
        />
      )}

      {/* ─── Biggest single tx callout (#3) above the recent feed ─── */}
      {recent && recent.flows.length > 0 && (
        <BiggestTxCallout flows={recent.flows} onAddressClick={setSelectedAddress} />
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
  // Used to scroll the feed top into view on filter change so users
  // don't have to manually scroll up to find the new list.
  //
  // We use window.scrollTo with a manually computed Y instead of
  // element.scrollIntoView because the latter is unreliable across
  // browsers when the target is already partially visible or when a
  // smooth-scroll is interrupted mid-animation. The manual version
  // always fires, always lands at the same offset, and the
  // requestAnimationFrame defers the call until React has committed
  // the new filter's layout so we measure post-render coordinates.
  const cardRef = useRef<HTMLDivElement>(null);
  const STICKY_OFFSET = 72;
  const scrollToTop = () => {
    requestAnimationFrame(() => {
      const el = cardRef.current;
      if (!el) return;
      const targetY =
        el.getBoundingClientRect().top + window.scrollY - STICKY_OFFSET;
      window.scrollTo({ top: targetY, behavior: "smooth" });
    });
  };

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
    <div className="flows-feed-card" ref={cardRef}>
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
              scrollToTop();
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
  const isDeposit = flow.direction === "inflow";
  const sign = isDeposit ? "+" : "−";
  const directionClass = isDeposit ? "flow-card-net-in" : "flow-card-net-out";
  const pillLabel = isDeposit ? "DEPOSIT" : "WITHDRAWAL";
  const pillClass = isDeposit ? "flows-feed-pill-in" : "flows-feed-pill-out";
  const cpDisplay = flow.counterpartyLabel
    ? flow.counterpartyLabel
    : truncate(flow.counterparty);

  // Always render source -> destination so the row reads naturally
  // left to right and the arrow direction is consistent. Deposits
  // flow counterparty -> exchange; withdrawals flow exchange ->
  // counterparty. The leading pill carries the semantic label so the
  // user doesn't have to parse direction from the arrow alone.
  const counterpartyButton = (
    <button
      type="button"
      className="flows-feed-counterparty flows-feed-counterparty-button"
      onClick={() => onAddressClick(flow.counterparty)}
      title={flow.counterparty}
    >
      {cpDisplay}
    </button>
  );
  const exchangeNode = <span className="flows-feed-exchange">{flow.exchange}</span>;
  const sourceNode = isDeposit ? counterpartyButton : exchangeNode;
  const destNode = isDeposit ? exchangeNode : counterpartyButton;

  return (
    <div className="flows-feed-row">
      <span className="flows-feed-time">{relativeTime(flow.timestamp)}</span>
      <span className={`flows-feed-pill ${pillClass}`}>{pillLabel}</span>
      <span className={`flows-feed-amount ${directionClass}`}>
        {sign}
        {formatLargeNumber(Math.abs(flow.amount))} TX
      </span>
      <span className="flows-feed-route">
        {sourceNode}
        <span className="flows-feed-arrow">→</span>
        {destNode}
        {flow.counterpartyRank != null && (
          <span className="flows-feed-whale-tag">Top #{flow.counterpartyRank}</span>
        )}
      </span>
    </div>
  );
}

// ─── FlowsSummary ─────────────────────────────────────────────────────
// Auto generated 2 to 3 sentence narrative built entirely from the data
// already loaded for the page. No external API, no LLM — just templates
// fed by the same /api/flows + /api/flows-destinations + /api/flows-
// counterparties responses the rest of the page renders. The text
// updates the moment the user changes the window, so it always matches
// what they're looking at.
//
// Tone is descriptive with a light interpretation hook ("suggests
// accumulation", "typical of holders moving to cold storage") and never
// makes predictive claims.

const WINDOW_PHRASE: Record<WindowKey, string> = {
  "24h": "Past 24 hours",
  "7d":  "Past 7 days",
  "30d": "Past 30 days",
  "90d": "Past 90 days",
  all:   "All time",
};

function FlowsSummary({
  windowKey,
  totals,
  exchanges,
  destinations,
  topWithdrawer,
  topDepositor,
}: {
  windowKey: WindowKey;
  totals: { inflow: number; outflow: number; net: number; txCount: number };
  exchanges: ExchangeFlowRow[];
  destinations: DestinationsResponse;
  topWithdrawer: CounterpartyRow | null;
  topDepositor: CounterpartyRow | null;
}) {
  // Three thresholds keep the headline honest: balanced means net is
  // small relative to gross flow, so we don't call a quiet window
  // "accumulation". 5% of gross is the cut off where direction
  // actually means something.
  const gross = totals.inflow + totals.outflow;
  const netPctOfGross = gross > 0 ? Math.abs(totals.net) / gross : 0;
  const direction =
    netPctOfGross < 0.05
      ? "balanced"
      : totals.net > 0
        ? "inflow"
        : "outflow";

  const headline = (() => {
    const out = formatLargeNumber(totals.outflow);
    const inn = formatLargeNumber(totals.inflow);
    const net = formatLargeNumber(Math.abs(totals.net));
    if (direction === "balanced") {
      return `${WINDOW_PHRASE[windowKey]}: inflow and outflow are roughly balanced (${inn} TX in, ${out} TX out). No clear directional pressure.`;
    }
    if (direction === "outflow") {
      return `${WINDOW_PHRASE[windowKey]}: ${out} TX left exchanges, ${inn} TX came in (net ${net} TX out, suggesting accumulation off platform).`;
    }
    return `${WINDOW_PHRASE[windowKey]}: ${inn} TX moved onto exchanges, ${out} TX moved out (net ${net} TX in, suggesting potential sell pressure).`;
  })();

  // Driver line: name the single exchange responsible for the biggest
  // slice of net flow in the dominant direction. For balanced windows
  // we still surface the largest gross flow so the line isn't empty.
  const driverLine = (() => {
    if (exchanges.length === 0) return null;
    if (direction === "outflow") {
      const top = exchanges
        .slice()
        .sort((a, b) => b.outflow - a.outflow)[0];
      if (!top || top.outflow <= 0) return null;
      return `${top.name} drove the largest outflow at ${formatLargeNumber(top.outflow)} TX across ${top.txCount.toLocaleString()} transactions.`;
    }
    if (direction === "inflow") {
      const top = exchanges
        .slice()
        .sort((a, b) => b.inflow - a.inflow)[0];
      if (!top || top.inflow <= 0) return null;
      return `${top.name} took in the largest deposits at ${formatLargeNumber(top.inflow)} TX across ${top.txCount.toLocaleString()} transactions.`;
    }
    const top = exchanges
      .slice()
      .sort((a, b) => b.inflow + b.outflow - (a.inflow + a.outflow))[0];
    if (!top) return null;
    return `${top.name} saw the most activity (${formatLargeNumber(top.inflow + top.outflow)} TX gross across ${top.txCount.toLocaleString()} transactions).`;
  })();

  // Destinations line: only show if outflow exists and one bucket
  // dominates the breakdown. Skip when destinations are evenly split,
  // because the flat distribution isn't a story.
  const destLine = (() => {
    if (destinations.totalOutflow <= 0) return null;
    const sorted = destinations.buckets.slice().sort((a, b) => b.pct - a.pct);
    const top = sorted[0];
    if (!top || top.pct < 40) return null;
    if (top.category === "staked") {
      return `${top.pct.toFixed(0)}% of withdrawals went to known stakers, often a bullish signal.`;
    }
    if (top.category === "other_exchange") {
      return `${top.pct.toFixed(0)}% of withdrawals rotated to other exchanges, neither bullish nor bearish.`;
    }
    return `${top.pct.toFixed(0)}% of withdrawals went to private wallets, typical of holders moving to cold storage.`;
  })();

  // Whale line: highlight the single biggest counterparty in the
  // dominant direction, only when the amount is large enough to be
  // interesting (>= 1% of gross flow).
  const whaleLine = (() => {
    const minSignificant = gross * 0.01;
    const cp = direction === "inflow" ? topDepositor : topWithdrawer;
    if (!cp || cp.totalAmount < minSignificant) return null;
    const role = direction === "inflow" ? "depositor" : "withdrawer";
    const action = direction === "inflow" ? "deposited" : "withdrew";
    const display = cp.label ?? truncate(cp.address);
    return `Top ${role} ${display}${cp.rank != null ? ` (Top #${cp.rank})` : ""} ${action} ${formatLargeNumber(cp.totalAmount)} TX across ${cp.txCount.toLocaleString()} transactions.`;
  })();

  const lines = [headline, driverLine, destLine, whaleLine].filter(
    (l): l is string => Boolean(l),
  );

  return (
    <div className="flows-summary">
      <div className="flows-summary-header">
        <span className="flows-chart-title">Quick Read</span>
        <span className="flows-summary-badge">AUTO</span>
      </div>
      <div className="flows-summary-body">
        {lines.map((line, i) => (
          <p key={i} className={i === 0 ? "flows-summary-headline" : "flows-summary-line"}>
            {line}
          </p>
        ))}
      </div>
      <div className="flows-summary-disclaimer">
        Observational summary generated from on chain data. Not financial advice.
      </div>
    </div>
  );
}

// ─── DestinationsSection ──────────────────────────────────────────────
// "Where do withdrawals go?" — three cards split by destination type.
// Total is always the sum of the three so percentages add up to 100.

const DESTINATION_META: Record<
  DestinationCategory,
  { label: string; tone: "good" | "neutral" | "warn"; description: string }
> = {
  staked: {
    label: "Staked / Holder",
    tone: "good",
    description:
      "Outflow to known stakers. Counterparty currently has active stake or has delegated within the last 90 days. Bullish signal.",
  },
  other_exchange: {
    label: "Other Exchange",
    tone: "neutral",
    description: "Rotation between exchanges. Neither bullish nor bearish.",
  },
  bridge: {
    label: "Bridge / IBC",
    tone: "neutral",
    description: "Moving cross chain via Squid, Skip, or an IBC channel.",
  },
  dex: {
    label: "DEX / LP",
    tone: "neutral",
    description: "DEX swap or liquidity pool deposit.",
  },
  contract: {
    label: "Contract / Module",
    tone: "neutral",
    description: "Smart contract or chain module account (gov, distribution, etc.).",
  },
  private: {
    label: "Private Wallet",
    tone: "neutral",
    description: "Cold storage, personal wallets, or unidentified destinations.",
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
  prevNet = null,
  prevTxCount = null,
}: {
  name: string;
  inflow: number;
  outflow: number;
  net: number;
  txCount: number;
  latestAt?: string | null;
  isTotal?: boolean;
  // Optional prior-period values powering the "+42% vs prior" delta
  // line. Null when the window has no prior period (ALL) or the
  // exchange wasn't present in the prior fetch.
  prevNet?: number | null;
  prevTxCount?: number | null;
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
      {/* Delta vs prior period of equal length. We show net delta
          only because tx count alone tells you nothing about whether
          a period is meaningful. Skipped on the Total card and when
          there's no comparable prior value. */}
      {!isTotal && prevNet != null && (
        <FlowCardDelta currentNet={net} previousNet={prevNet} prevTxCount={prevTxCount} />
      )}
      {latestAt && (
        <div className="flow-card-latest">
          last activity {new Date(latestAt).toLocaleString()}
        </div>
      )}
    </div>
  );
}

function FlowCardDelta({
  currentNet,
  previousNet,
  prevTxCount,
}: {
  currentNet: number;
  previousNet: number;
  prevTxCount: number | null;
}) {
  // No useful comparison if the prior period was empty (zero net).
  if (previousNet === 0) {
    if (prevTxCount === 0) {
      return <div className="flow-card-delta flow-card-delta-neutral">new this period</div>;
    }
    return null;
  }
  // Compute % change of |net|. Sign indicates whether the magnitude
  // grew or shrank, which is what most readers want; the directional
  // story (in vs out) is already covered by the colour and label.
  const curMag = Math.abs(currentNet);
  const prevMag = Math.abs(previousNet);
  const pct = ((curMag - prevMag) / prevMag) * 100;
  const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "";
  const cls =
    Math.abs(pct) < 5
      ? "flow-card-delta-neutral"
      : pct > 0
        ? "flow-card-delta-up"
        : "flow-card-delta-down";
  // Direction flip is worth flagging — went from net inflow to net
  // outflow or vice versa. That's a more meaningful signal than the
  // raw % change.
  const flipped =
    Math.sign(currentNet) !== Math.sign(previousNet) &&
    currentNet !== 0 &&
    previousNet !== 0;
  return (
    <div className={`flow-card-delta ${cls}`}>
      {arrow} {Math.abs(pct).toFixed(0)}% vs prior
      {flipped && <span className="flow-card-delta-flip"> · direction flipped</span>}
    </div>
  );
}

// ─── BiggestTxCallout (#3) ────────────────────────────────────────────
// Picks the single largest tx in the recent feed (within the current
// window) and surfaces it as a banner above the feed. The "recent"
// endpoint already returns up to 200 newest flows, so the largest in
// that slice is a reasonable proxy for the most notable tx in the
// window. Skipped silently when nothing crosses the threshold.

function BiggestTxCallout({
  flows,
  onAddressClick,
}: {
  flows: RecentFlowRow[];
  onAddressClick: (address: string) => void;
}) {
  const biggest = useMemo(() => {
    let top: RecentFlowRow | null = null;
    let topMag = 0;
    for (const f of flows) {
      const m = Math.abs(f.amount);
      if (m > topMag) {
        topMag = m;
        top = f;
      }
    }
    // Threshold: 100K TX. Below that the "biggest" isn't really a
    // headline; on a quiet day we'd rather show nothing than highlight
    // a 5K transfer.
    return topMag >= 100_000 ? top : null;
  }, [flows]);

  if (!biggest) return null;

  const isDeposit = biggest.direction === "inflow";
  const amount = formatLargeNumber(Math.abs(biggest.amount));
  const direction = isDeposit ? "deposited to" : "withdrawn from";
  const cpDisplay = biggest.counterpartyLabel ?? truncate(biggest.counterparty);

  return (
    <div className={`flows-biggest ${isDeposit ? "flows-biggest-in" : "flows-biggest-out"}`}>
      <span className="flows-biggest-label">Largest tx in window</span>
      <span className="flows-biggest-body">
        <strong>{amount} TX</strong> {direction}{" "}
        <strong>{biggest.exchange}</strong>{" "}
        {isDeposit ? "from" : "to"}{" "}
        <button
          type="button"
          className="flows-biggest-cp"
          onClick={() => onAddressClick(biggest.counterparty)}
          title={biggest.counterparty}
        >
          {cpDisplay}
        </button>
        {biggest.counterpartyRank != null && (
          <span className="flows-feed-whale-tag">Top #{biggest.counterpartyRank}</span>
        )}
        <span className="flows-biggest-time">{relativeTime(biggest.timestamp)}</span>
      </span>
    </div>
  );
}

// ─── RepeatPatterns (#7) ──────────────────────────────────────────────
// Buckets the recent flows by counterparty + direction and surfaces any
// (counterparty, direction) pair that appears at least N times in the
// window. The raw feed shows individual rows; this section pulls the
// pattern out so users see "core1xyz deposited 5 times for 8M total"
// without scanning. Computed entirely client-side from the existing
// 200-row recent feed.

const REPEAT_MIN_COUNT = 3;

function RepeatPatterns({
  flows,
  onAddressClick,
}: {
  flows: RecentFlowRow[];
  onAddressClick: (address: string) => void;
}) {
  const patterns = useMemo(() => {
    const map = new Map<
      string,
      {
        address: string;
        label: string | null;
        rank: number | null;
        direction: "inflow" | "outflow";
        exchanges: Set<string>;
        count: number;
        total: number;
      }
    >();
    for (const f of flows) {
      const key = `${f.counterparty}|${f.direction}`;
      const cur = map.get(key) ?? {
        address: f.counterparty,
        label: f.counterpartyLabel,
        rank: f.counterpartyRank,
        direction: f.direction,
        exchanges: new Set<string>(),
        count: 0,
        total: 0,
      };
      cur.count++;
      cur.total += Math.abs(f.amount);
      cur.exchanges.add(f.exchange);
      map.set(key, cur);
    }
    return Array.from(map.values())
      .filter((p) => p.count >= REPEAT_MIN_COUNT)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [flows]);

  if (patterns.length === 0) return null;

  return (
    <div className="flows-patterns">
      <div className="flows-patterns-header">
        <span className="flows-chart-title">Notable Patterns</span>
        <span className="flows-feed-count">
          counterparties active 3+ times in this window
        </span>
      </div>
      <ul className="flows-patterns-list">
        {patterns.map((p) => {
          const isDeposit = p.direction === "inflow";
          const verb = isDeposit ? "deposited to" : "withdrew from";
          const exchanges = Array.from(p.exchanges).join(", ");
          const display = p.label ?? truncate(p.address);
          return (
            <li key={`${p.address}-${p.direction}`} className="flows-patterns-row">
              <button
                type="button"
                className="flows-patterns-cp"
                onClick={() => onAddressClick(p.address)}
                title={p.address}
              >
                {display}
              </button>
              {p.rank != null && (
                <span className="flows-feed-whale-tag">Top #{p.rank}</span>
              )}
              <span className="flows-patterns-text">
                {verb} <strong>{exchanges}</strong> {p.count} times for{" "}
                <strong className={isDeposit ? "flow-card-net-in" : "flow-card-net-out"}>
                  {formatLargeNumber(p.total)} TX
                </strong>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── PeriodComparison (#8) ────────────────────────────────────────────
// "This 7d vs prior 7d" panel. Shows net flow, gross volume, and tx
// count side-by-side with the % change. The prior-period values come
// from /api/flows?prev=true so the SUMs cover the immediately preceding
// window of the same length.

const COMPARE_WINDOW_LABEL: Record<Exclude<WindowKey, "all">, string> = {
  "24h": "Past 24h vs prior 24h",
  "7d": "Past 7 days vs prior 7 days",
  "30d": "Past 30 days vs prior 30 days",
  "90d": "Past 90 days vs prior 90 days",
};

function PeriodComparison({
  windowKey,
  current,
  previous,
  currentExchanges,
  previousExchanges,
}: {
  windowKey: WindowKey;
  current: { inflow: number; outflow: number; net: number; txCount: number };
  previous: { inflow: number; outflow: number; net: number; txCount: number };
  currentExchanges: ExchangeFlowRow[];
  previousExchanges: ExchangeFlowRow[];
}) {
  if (windowKey === "all") return null;
  const grossCur = current.inflow + current.outflow;
  const grossPrev = previous.inflow + previous.outflow;
  const pct = (cur: number, prev: number) =>
    prev === 0 ? null : ((cur - prev) / prev) * 100;

  // Headline biggest mover: the exchange whose net flow changed the
  // most in absolute TX terms vs the prior period. Helps users see
  // which platform drove the period's story.
  const biggestMover = useMemo(() => {
    let best: { name: string; delta: number } | null = null;
    for (const e of currentExchanges) {
      const prev = previousExchanges.find((x) => x.address === e.address);
      const prevNet = prev?.net ?? 0;
      const delta = e.net - prevNet;
      if (best == null || Math.abs(delta) > Math.abs(best.delta)) {
        best = { name: e.name, delta };
      }
    }
    return best;
  }, [currentExchanges, previousExchanges]);

  return (
    <div className="flows-compare">
      <div className="flows-compare-header">
        <span className="flows-chart-title">{COMPARE_WINDOW_LABEL[windowKey as Exclude<WindowKey, "all">]}</span>
      </div>
      <div className="flows-compare-grid">
        <ComparisonStat label="Net flow" current={current.net} previous={previous.net} mode="net" pct={pct(Math.abs(current.net), Math.abs(previous.net))} />
        <ComparisonStat label="Gross volume" current={grossCur} previous={grossPrev} mode="gross" pct={pct(grossCur, grossPrev)} />
        <ComparisonStat label="Transactions" current={current.txCount} previous={previous.txCount} mode="count" pct={pct(current.txCount, previous.txCount)} />
      </div>
      {biggestMover && Math.abs(biggestMover.delta) > 1000 && (
        <div className="flows-compare-mover">
          Biggest mover: <strong>{biggestMover.name}</strong> ({biggestMover.delta > 0 ? "+" : "−"}
          {formatLargeNumber(Math.abs(biggestMover.delta))} TX net change vs prior period)
        </div>
      )}
    </div>
  );
}

function ComparisonStat({
  label,
  current,
  previous,
  mode,
  pct,
}: {
  label: string;
  current: number;
  previous: number;
  mode: "net" | "gross" | "count";
  pct: number | null;
}) {
  const fmt = (n: number) =>
    mode === "count" ? n.toLocaleString() : `${formatLargeNumber(Math.abs(n))} TX`;
  const sign = mode === "net" && current !== 0 ? (current > 0 ? "+" : "−") : "";
  const cls =
    pct == null
      ? "flows-compare-pct-neutral"
      : Math.abs(pct) < 5
        ? "flows-compare-pct-neutral"
        : pct > 0
          ? "flows-compare-pct-up"
          : "flows-compare-pct-down";
  return (
    <div className="flows-compare-stat">
      <div className="flows-compare-label">{label}</div>
      <div className="flows-compare-current">{sign}{fmt(current)}</div>
      <div className="flows-compare-prior">prior: {fmt(previous)}</div>
      {pct != null && (
        <div className={`flows-compare-pct ${cls}`}>
          {pct > 0 ? "▲" : pct < 0 ? "▼" : ""} {Math.abs(pct).toFixed(0)}%
        </div>
      )}
    </div>
  );
}

// ─── FlowsHeatmap (#6) ────────────────────────────────────────────────
// Per-exchange × day net flow grid. Each cell is coloured by net flow
// magnitude and direction (red = accumulation, green = releasing).
// Dates run left to right; exchanges top to bottom.

function FlowsHeatmap({
  heatmap,
  exchanges,
}: {
  heatmap: NonNullable<FlowsHistoryResponse["heatmap"]>;
  exchanges: NonNullable<FlowsHistoryResponse["exchanges"]>;
}) {
  // Find the max absolute net across all cells so we can scale colour
  // intensity. Without scaling, a single big day washes everything else
  // out visually.
  const maxAbs = useMemo(() => {
    let m = 0;
    for (const day of heatmap) {
      for (const c of day.cells) {
        const a = Math.abs(c.net);
        if (a > m) m = a;
      }
    }
    return m || 1;
  }, [heatmap]);

  const cellColour = (net: number) => {
    if (Math.abs(net) < 1000) return "rgba(150,150,150,0.06)";
    const intensity = Math.min(1, Math.abs(net) / maxAbs);
    // Red for inflow-dominant (accumulation), green for outflow.
    if (net > 0) return `rgba(196, 90, 74, ${0.15 + intensity * 0.7})`;
    return `rgba(74, 122, 26, ${0.15 + intensity * 0.7})`;
  };

  const formatDay = (d: string) => {
    const dt = new Date(d + "T00:00:00");
    return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][dt.getMonth()]} ${dt.getDate()}`;
  };

  return (
    <div className="flows-heatmap">
      <div className="flows-heatmap-header">
        <span className="flows-chart-title">Daily Net Flow by Exchange</span>
        <span className="flows-feed-count">
          red = accumulation, green = releasing
        </span>
      </div>
      <div
        className="flows-heatmap-grid"
        style={{
          gridTemplateColumns: `120px repeat(${heatmap.length}, minmax(28px, 1fr))`,
        }}
      >
        <div className="flows-heatmap-corner" />
        {heatmap.map((d) => (
          <div key={d.date} className="flows-heatmap-day-label" title={d.date}>
            {formatDay(d.date)}
          </div>
        ))}
        {exchanges.map((ex) => (
          <FlowsHeatmapRow
            key={ex.address}
            exchange={ex}
            heatmap={heatmap}
            cellColour={cellColour}
          />
        ))}
      </div>
    </div>
  );
}

function FlowsHeatmapRow({
  exchange,
  heatmap,
  cellColour,
}: {
  exchange: { address: string; name: string };
  heatmap: NonNullable<FlowsHistoryResponse["heatmap"]>;
  cellColour: (net: number) => string;
}) {
  return (
    <>
      <div className="flows-heatmap-row-label">{exchange.name}</div>
      {heatmap.map((d) => {
        const cell = d.cells.find((c) => c.address === exchange.address);
        const net = cell?.net ?? 0;
        const tooltip =
          cell && (cell.inflow > 0 || cell.outflow > 0)
            ? `${exchange.name} on ${d.date}\n+${formatLargeNumber(cell.inflow)} in / -${formatLargeNumber(cell.outflow)} out\nnet ${net > 0 ? "+" : ""}${formatLargeNumber(net)} TX`
            : `${exchange.name} on ${d.date}: no flows`;
        return (
          <div
            key={`${exchange.address}-${d.date}`}
            className="flows-heatmap-cell"
            style={{ background: cellColour(net) }}
            title={tooltip}
          />
        );
      })}
    </>
  );
}

// ─── DestinationsSankey (#5) ──────────────────────────────────────────
// Replaces the three-card destination breakdown with a horizontal flow
// visual. Single source node ("Withdrawals") splits into three bars
// proportional to bucket pct. Pure CSS rendering — no chart lib needed
// for a 1-to-3 split, and it ends up looking better than the Recharts
// Sankey component for this small a graph.

function DestinationsSankey({ data }: { data: DestinationsResponse }) {
  return (
    <div className="flows-sankey">
      <div className="flows-sankey-header">
        <span className="flows-chart-title">Where Withdrawals Go</span>
        <span className="flows-feed-count">
          {formatLargeNumber(data.totalOutflow)} TX over {data.window.toUpperCase()}
        </span>
      </div>
      <div className="flows-sankey-body">
        <div className="flows-sankey-source">
          <div className="flows-sankey-source-label">Withdrawals</div>
          <div className="flows-sankey-source-amount">
            {formatLargeNumber(data.totalOutflow)} TX
          </div>
        </div>
        <div className="flows-sankey-bars">
          {data.buckets
            .filter((b) => b.amount > 0)
            .map((b) => {
              const meta = DESTINATION_META[b.category];
              return (
                <div
                  key={b.category}
                  className={`flows-sankey-bar flows-sankey-bar-${meta.tone}`}
                  style={{ flexGrow: Math.max(b.pct, 1) }}
                  title={`${meta.label}: ${b.pct.toFixed(1)}%, ${formatLargeNumber(b.amount)} TX, ${b.txCount.toLocaleString()} tx`}
                >
                  <div className="flows-sankey-bar-label">{meta.label}</div>
                  <div className="flows-sankey-bar-pct">{b.pct.toFixed(1)}%</div>
                  <div className="flows-sankey-bar-detail">
                    {formatLargeNumber(b.amount)} TX
                  </div>
                </div>
              );
            })}
        </div>
      </div>
      <div className="flows-sankey-desc">
        Staked / Holder = address has active stake or has delegated in
        the last 90 days (bullish). Other Exchange = rotation between
        platforms (neutral). Private Wallet = cold storage or
        unclassified addresses.
      </div>
    </div>
  );
}

// ─── PrivateDestinationsAudit ─────────────────────────────────────────
// Lists the top 20 counterparties currently classified as "private"
// for the active window, sorted by total amount. The team uses this
// to spot untracked exchanges (Bybit, KuCoin, OKX, ...), bridges
// (Squid, Skip, IBC channels), DEX pools, and contracts so they can
// be added to known_entities. Each labelled address moves volume out
// of "Private Wallet" and into a more accurate bucket.
//
// Collapsed by default to keep the page tidy; the team only needs it
// when curating known_entities, not on every page load.

function PrivateDestinationsAudit({
  data,
  onAddressClick,
}: {
  data: PrivateDestinationsResponse;
  onAddressClick: (address: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const total = useMemo(
    () => data.destinations.reduce((s, d) => s + d.totalAmount, 0),
    [data.destinations],
  );

  return (
    <div className="flows-private-audit">
      <button
        type="button"
        className="flows-private-audit-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="flows-private-audit-toggle-arrow">{open ? "▾" : "▸"}</span>
        <span className="flows-chart-title">Top Private Destinations</span>
        <span className="flows-feed-count">
          {data.destinations.length} addresses, {formatLargeNumber(total)} TX combined
        </span>
      </button>
      {open && (
        <>
          <p className="flows-private-audit-help">
            These are the largest counterparties currently sitting in the
            Private Wallet bucket. Recognise an exchange, bridge, or DEX
            below? Add it to <code>known_entities</code> with the right
            type and the next refresh will move it to the matching
            bucket. Click any address to inspect its full flow history.
          </p>
          <ol className="flows-private-audit-list">
            {data.destinations.map((d, i) => {
              const display = d.label ?? truncate(d.address);
              return (
                <li key={d.address} className="flows-private-audit-row">
                  <span className="flows-private-audit-rank">#{i + 1}</span>
                  <button
                    type="button"
                    className="flows-private-audit-cp"
                    onClick={() => onAddressClick(d.address)}
                    title={d.address}
                  >
                    {display}
                  </button>
                  {d.type && (
                    <span className="flows-private-audit-tag">type: {d.type}</span>
                  )}
                  <span className="flows-private-audit-amount">
                    {formatLargeNumber(d.totalAmount)} TX
                  </span>
                  <span className="flows-private-audit-count">
                    {d.txCount.toLocaleString()} tx
                  </span>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}
