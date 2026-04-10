"use client";

import { useEffect, useRef, useState } from "react";
import { createChart, type IChartApi, ColorType, CrosshairMode, AreaSeries, type AreaData, type Time } from "lightweight-charts";

// TX era start
const TX_ERA_START_MS = new Date("2026-03-06").getTime();

type PriceRange = "1D" | "7D" | "1M" | "3M" | "ALL";
const PRICE_RANGES: PriceRange[] = ["1D", "7D", "1M", "3M", "ALL"];

const RANGE_DAYS: Record<PriceRange, number> = {
  "1D": 1,
  "7D": 7,
  "1M": 30,
  "3M": 90,
  "ALL": 90,
};

interface PricePoint {
  time: string | number;
  value: number;
}

// In-memory cache (5 min TTL)
const priceCache = new Map<string, { data: PricePoint[]; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000;

function parsePriceData(raw: any, days: number): PricePoint[] {
  const isHourly = days <= 7;

  const prices: PricePoint[] = raw.prices
    .filter(([ts]: [number, number]) => ts >= TX_ERA_START_MS)
    .map(([ts, price]: [number, number]) => {
      if (isHourly) {
        return { time: Math.floor(ts / 1000), value: price };
      }
      const d = new Date(ts);
      return {
        time: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
        value: price,
      };
    });

  if (isHourly) {
    const seen = new Set<number>();
    return prices.filter((p) => {
      const key = Math.floor(Number(p.time) / 3600) * 3600;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  const byDate = new Map<string, PricePoint>();
  for (const p of prices) byDate.set(String(p.time), p);
  return Array.from(byDate.values()).sort((a, b) => String(a.time).localeCompare(String(b.time)));
}

async function fetchPriceHistory(range: PriceRange, attempt = 1): Promise<PricePoint[]> {
  const cached = priceCache.get(range);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  try {
    const days = RANGE_DAYS[range];
    const url = `https://api.coingecko.com/api/v3/coins/tx/market_chart?vs_currency=usd&days=${days}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });

    // Rate limited — retry once after delay
    if (res.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      return fetchPriceHistory(range, attempt + 1);
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    const data = parsePriceData(raw, days);
    priceCache.set(range, { data, ts: Date.now() });
    return data;
  } catch (e) {
    console.warn(`Price fetch failed (attempt ${attempt}):`, e);
    // Retry once on network error
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 1500));
      return fetchPriceHistory(range, attempt + 1);
    }
    if (cached) return cached.data;
    return [];
  }
}

// Prefetch default range (delayed slightly to avoid competing with page load)
if (typeof window !== "undefined") {
  setTimeout(() => fetchPriceHistory("1M"), 500);
}

// ═══ INNER CHART (remounts on range change via key) ═══
function PriceChartInner({ range }: { range: PriceRange }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [price, setPrice] = useState<{ current: number; change: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let chart: IChartApi | null = null;
    let resizeObs: ResizeObserver | null = null;
    let cancelled = false;

    (async () => {
      const data = await fetchPriceHistory(range);
      if (cancelled) return;

      if (!containerRef.current || data.length === 0) {
        setLoading(false);
        setError(true);
        return;
      }

      const latest = data[data.length - 1].value;
      const first = data[0].value;
      setPrice({ current: latest, change: first > 0 ? ((latest - first) / first) * 100 : 0 });

      const isUp = latest >= first;
      const lineColor = isUp ? "#4a7a1a" : "#b44a3e";

      chart = createChart(containerRef.current, {
        width: containerRef.current.clientWidth,
        height: 380,
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: "rgba(106,90,81,0.3)",
          fontFamily: "SF Mono, Fira Code, monospace",
          fontSize: 10,
        },
        grid: {
          vertLines: { visible: false },
          horzLines: { color: "rgba(59,45,38,0.03)", style: 1 },
        },
        crosshair: {
          mode: CrosshairMode.Magnet,
          vertLine: { color: "rgba(59,45,38,0.08)", style: 3, labelVisible: false },
          horzLine: { color: "rgba(59,45,38,0.08)", style: 3, labelVisible: false },
        },
        rightPriceScale: {
          borderVisible: false,
          textColor: "rgba(106,90,81,0.25)",
          scaleMargins: { top: 0.05, bottom: 0.05 },
          autoScale: true,
        },
        timeScale: {
          borderVisible: false,
          timeVisible: range === "1D" || range === "7D",
          fixLeftEdge: true,
          fixRightEdge: true,
        },
        handleScroll: { mouseWheel: false, pressedMouseMove: false },
        handleScale: { mouseWheel: false, pinch: false },
      });

      const series = (chart as any).addSeries(AreaSeries, {
        lineColor,
        lineWidth: 2.5,
        topColor: isUp ? "rgba(74, 122, 26, 0.25)" : "rgba(180, 74, 62, 0.2)",
        bottomColor: isUp ? "rgba(74, 122, 26, 0.02)" : "rgba(180, 74, 62, 0.02)",
        priceLineVisible: false,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 4,
        crosshairMarkerBorderColor: "#fff",
        crosshairMarkerBorderWidth: 2,
        crosshairMarkerBackgroundColor: lineColor,
        lastValueVisible: false,
      });

      series.setData(data as AreaData<Time>[]);
      chart.timeScale().fitContent();

      // Tooltip
      chart.subscribeCrosshairMove((param) => {
        if (!tooltipRef.current) return;
        if (!param.time || !param.seriesData.size) {
          tooltipRef.current.style.opacity = "0";
          return;
        }
        const p = param.seriesData.get(series);
        if (!p || !("value" in p)) {
          tooltipRef.current.style.opacity = "0";
          return;
        }

        let formatted: string;
        if (typeof param.time === "number") {
          const d = new Date(param.time * 1000);
          formatted = d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
        } else {
          const d = new Date(param.time + "T00:00:00");
          formatted = d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
        }

        tooltipRef.current.innerHTML = `
          <div style="color:rgba(244,241,235,0.5);font-size:0.62rem;margin-bottom:3px">${formatted}</div>
          <div style="font-weight:700;color:#B1FC03;font-size:0.95rem">$${p.value.toFixed(4)}</div>
        `;
        tooltipRef.current.style.opacity = "1";

        const coordinate = param.point;
        if (coordinate && containerRef.current) {
          const cw = containerRef.current.clientWidth;
          let left = coordinate.x + 16;
          if (left + 150 > cw) left = coordinate.x - 160;
          tooltipRef.current.style.left = `${left}px`;
          tooltipRef.current.style.top = `${coordinate.y - 10}px`;
        }
      });

      // Resize
      resizeObs = new ResizeObserver((entries) => {
        for (const entry of entries) chart?.applyOptions({ width: entry.contentRect.width });
      });
      resizeObs.observe(containerRef.current);

      setLoading(false);
    })();

    return () => {
      cancelled = true;
      resizeObs?.disconnect();
      chart?.remove();
    };
  }, [range]);

  const changeColor = price && price.change >= 0 ? "#4a7a1a" : "#b44a3e";

  return (
    <>
      <div className="price-header-left">
        <span className="chart-card-v2-title">
          TX Price
          {price && (
            <span className={`chart-card-v2-badge-inline ${price.change > 0 ? "badge-up" : price.change < -3 ? "badge-down" : "badge-neutral"}`}>
              {price.change >= 0 ? "+" : ""}{price.change.toFixed(1)}%
            </span>
          )}
        </span>
        {price && (
          <span className="price-current" style={{ color: changeColor }}>
            ${price.current.toFixed(4)}
          </span>
        )}
      </div>
      <div className="price-chart-container" ref={containerRef} style={{ position: "relative", height: 380 }}>
        {loading && <div className="price-chart-loading">Loading price data...</div>}
        {error && !loading && (
          <div className="price-chart-loading" style={{ cursor: "pointer" }} onClick={() => { setError(false); setLoading(true); priceCache.delete(range); fetchPriceHistory(range).then(() => window.location.reload()); }}>
            Price data unavailable. Tap to retry.
          </div>
        )}
        <div
          ref={tooltipRef}
          style={{
            position: "absolute",
            pointerEvents: "none",
            zIndex: 10,
            background: "rgba(15, 27, 7, 0.94)",
            border: "1px solid rgba(177, 252, 3, 0.2)",
            borderRadius: 10,
            padding: "10px 14px",
            fontFamily: "var(--font-mono)",
            fontSize: "0.72rem",
            boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
            opacity: 0,
            transition: "opacity 0.12s ease",
          }}
        />
      </div>
    </>
  );
}

// ═══ WRAPPER (manages range, remounts inner via key) ═══
export default function PriceChart() {
  const [activeRange, setActiveRange] = useState<PriceRange>("1M");

  return (
    <div className="chart-card-v2 chart-card-hero price-chart-card">
      <PriceChartInner key={activeRange} range={activeRange} />
      <div className="price-range-pills" style={{ position: "absolute", top: 22, right: 24 }}>
        {PRICE_RANGES.map((range) => (
          <button
            key={range}
            className={`time-pill ${activeRange === range ? "active" : ""}`}
            onClick={() => setActiveRange(range)}
          >
            {range}
          </button>
        ))}
      </div>
    </div>
  );
}
