"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createChart, type IChartApi, type ISeriesApi, ColorType, CrosshairMode, AreaSeries, type AreaData, type Time } from "lightweight-charts";

// TX era start
const TX_ERA_START_MS = new Date("2026-03-06").getTime();

type PriceRange = "1D" | "7D" | "1M" | "3M" | "ALL";
const PRICE_RANGES: PriceRange[] = ["1D", "7D", "1M", "3M", "ALL"];

const RANGE_DAYS: Record<PriceRange, number> = {
  "1D": 1,
  "7D": 7,
  "1M": 30,
  "3M": 90,
  "ALL": 90, // CoinGecko max without paid plan, covers TX era
};

interface PricePoint {
  time: string; // YYYY-MM-DD or YYYY-MM-DDTHH:mm for hourly
  value: number;
}

// In-memory cache so tab switches are instant (5 min TTL)
const priceCache = new Map<string, { data: PricePoint[]; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000;

function parsePriceData(raw: any, days: number): PricePoint[] {
  const isHourly = days <= 7;

  const prices: PricePoint[] = raw.prices
    .filter(([ts]: [number, number]) => ts >= TX_ERA_START_MS)
    .map(([ts, price]: [number, number]) => {
      if (isHourly) {
        return { time: Math.floor(ts / 1000) as any, value: price };
      }
      const d = new Date(ts);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return { time: dateStr, value: price };
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
  for (const p of prices) byDate.set(p.time, p);
  return Array.from(byDate.values()).sort((a, b) => String(a.time).localeCompare(String(b.time)));
}

async function fetchPriceHistory(range: PriceRange): Promise<PricePoint[]> {
  // Return cached data instantly if fresh
  const cached = priceCache.get(range);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.data;
  }

  try {
    const days = RANGE_DAYS[range];
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/tx/market_chart?vs_currency=usd&days=${days}`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    const data = parsePriceData(raw, days);

    // Cache the result
    priceCache.set(range, { data, ts: Date.now() });
    return data;
  } catch (e) {
    console.warn("Failed to fetch price history:", e);
    // Return stale cache if available
    if (cached) return cached.data;
    return [];
  }
}

// Prefetch default range immediately on module load (before component mounts)
if (typeof window !== "undefined") {
  fetchPriceHistory("1M");
}

export default function PriceChart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<any>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [priceChange, setPriceChange] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeRange, setActiveRange] = useState<PriceRange>("1M");
  const lineColorRef = useRef("#b44a3e");

  const loadData = useCallback(async (range: PriceRange) => {
    setLoading(true);

    const data = await fetchPriceHistory(range);
    if (data.length === 0) {
      setLoading(false);
      return;
    }

    const latest = data[data.length - 1].value;
    const first = data[0].value;
    setCurrentPrice(latest);
    setPriceChange(first > 0 ? ((latest - first) / first) * 100 : null);

    const isUp = latest >= first;
    const lineColor = isUp ? "#4a7a1a" : "#b44a3e";
    const topColor = isUp ? "rgba(74, 122, 26, 0.15)" : "rgba(180, 74, 62, 0.12)";
    const bottomColor = isUp ? "rgba(74, 122, 26, 0.01)" : "rgba(180, 74, 62, 0.01)";
    lineColorRef.current = lineColor;

    // If chart exists, just update data and colors
    if (chartRef.current && seriesRef.current) {
      seriesRef.current.applyOptions({
        lineColor,
        topColor,
        bottomColor,
        crosshairMarkerBackgroundColor: lineColor,
      });
      seriesRef.current.setData(data as AreaData<Time>[]);

      // Show hours for 1D/7D
      const isHourly = range === "1D" || range === "7D";
      chartRef.current.applyOptions({
        timeScale: { timeVisible: isHourly },
      });

      chartRef.current.timeScale().fitContent();
      setLoading(false);
      return;
    }

    // First load: create chart
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
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
      rightPriceScale: { borderVisible: false, textColor: "rgba(106,90,81,0.25)" },
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
      lineWidth: 2,
      topColor,
      bottomColor,
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

    chartRef.current = chart;
    seriesRef.current = series;

    // Tooltip
    chart.subscribeCrosshairMove((param) => {
      if (!tooltipRef.current) return;
      if (!param.time || !param.seriesData.size) {
        tooltipRef.current.style.opacity = "0";
        return;
      }
      const price = param.seriesData.get(series);
      if (!price || !("value" in price)) {
        tooltipRef.current.style.opacity = "0";
        return;
      }

      // Format date based on whether time is unix or string
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
        <div style="font-weight:700;color:#B1FC03;font-size:0.95rem">$${price.value.toFixed(4)}</div>
      `;
      tooltipRef.current.style.opacity = "1";

      const coordinate = param.point;
      if (coordinate && containerRef.current) {
        const containerWidth = containerRef.current.clientWidth;
        let left = coordinate.x + 16;
        if (left + 150 > containerWidth) left = coordinate.x - 160;
        tooltipRef.current.style.left = `${left}px`;
        tooltipRef.current.style.top = `${coordinate.y - 10}px`;
      }
    });

    // Resize
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        chart.applyOptions({ width: entry.contentRect.width });
      }
    });
    resizeObserver.observe(containerRef.current);
    resizeObserverRef.current = resizeObserver;

    setLoading(false);
  }, []);

  useEffect(() => {
    loadData(activeRange);
    return () => {
      resizeObserverRef.current?.disconnect();
      chartRef.current?.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRangeChange = useCallback((range: PriceRange) => {
    setActiveRange(range);
    loadData(range);
  }, [loadData]);

  return (
    <div className="chart-card-v2 chart-card-hero price-chart-card">
      <div className="chart-card-v2-header">
        <div className="price-header-left">
          <span className="chart-card-v2-title">
            TX Price
            {priceChange !== null && (
              <span className={`chart-card-v2-badge-inline ${priceChange > 0 ? "badge-up" : priceChange < -3 ? "badge-down" : "badge-neutral"}`}>
                {priceChange >= 0 ? "+" : ""}{priceChange.toFixed(1)}%
              </span>
            )}
          </span>
          {currentPrice !== null && (
            <span className="price-current" style={{ color: priceChange && priceChange >= 0 ? "#4a7a1a" : "#b44a3e" }}>
              ${currentPrice.toFixed(4)}
            </span>
          )}
        </div>
        <div className="price-range-pills">
          {PRICE_RANGES.map((range) => (
            <button
              key={range}
              className={`time-pill ${activeRange === range ? "active" : ""}`}
              onClick={() => handleRangeChange(range)}
            >
              {range}
            </button>
          ))}
        </div>
      </div>
      <div className="price-chart-container" ref={containerRef} style={{ position: "relative", minHeight: 380 }}>
        {loading && (
          <div className="price-chart-loading">Loading price data...</div>
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
    </div>
  );
}
