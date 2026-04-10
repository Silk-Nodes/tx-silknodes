"use client";

import { useMemo } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ReferenceDot,
} from "recharts";
import type { DataPoint, TimeRange } from "@/lib/analytics-utils";
import {
  formatLargeNumber,
  formatPct,
  formatChartDate,
  formatTooltipDate,
  calcChange,
} from "@/lib/analytics-utils";

interface AnalyticsChartProps {
  title: string;
  data: DataPoint[];
  color: string;
  unit: "TX" | "%" | "";
  globalRange: TimeRange;
  size?: "hero" | "medium" | "small";
}

// ═══ TREND COLORS ═══
function getTrendColors(change: number | null, baseColor: string) {
  if (change === null || Math.abs(change) < 3) {
    return { stroke: baseColor, gradientColor: baseColor, glowColor: `${baseColor}99` };
  }
  if (change > 0) {
    return { stroke: "#4a7a1a", gradientColor: "#4a7a1a", glowColor: "rgba(177,252,3,0.5)" };
  }
  return { stroke: "#b44a3e", gradientColor: "#b44a3e", glowColor: "rgba(180,74,62,0.4)" };
}

// ═══ FORMATTERS ═══
function formatAxisValue(value: number, unit: string): string {
  if (unit === "%") return `${value.toFixed(0)}%`;
  return formatLargeNumber(value, 0);
}

function formatTooltipValue(value: number, unit: string): string {
  if (unit === "%") return formatPct(value);
  if (unit === "TX") return `${formatLargeNumber(value, 2)} TX`;
  return value.toLocaleString();
}

// ═══ TOOLTIP WITH % CHANGE ═══
function CustomTooltip({ active, payload, label, unit, data }: any) {
  if (!active || !payload || !payload.length) return null;

  const currentValue = payload[0].value;
  const currentIndex = data?.findIndex((d: DataPoint) => d.date === label);
  let pctChange: number | null = null;

  if (data && currentIndex > 0) {
    const prevValue = data[currentIndex - 1].value;
    if (prevValue !== 0) {
      pctChange = ((currentValue - prevValue) / prevValue) * 100;
    }
  }

  return (
    <div style={{
      background: "rgba(15, 27, 7, 0.94)",
      color: "#f4f1eb",
      border: "1px solid rgba(177, 252, 3, 0.2)",
      borderRadius: 10,
      padding: "10px 14px",
      fontFamily: "var(--font-mono)",
      fontSize: "0.72rem",
      boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
      minWidth: 120,
    }}>
      <div style={{ color: "rgba(244,241,235,0.45)", marginBottom: 4, fontSize: "0.62rem" }}>
        {formatTooltipDate(label || "")}
      </div>
      <div style={{ fontWeight: 700, color: "#B1FC03", fontSize: "0.88rem" }}>
        {formatTooltipValue(currentValue, unit)}
      </div>
      {pctChange !== null && Math.abs(pctChange) > 0.01 && (
        <div style={{
          fontSize: "0.62rem",
          marginTop: 3,
          color: pctChange >= 0 ? "rgba(177,252,3,0.7)" : "rgba(232,146,122,0.8)",
          fontWeight: 600,
        }}>
          {pctChange >= 0 ? "+" : ""}{pctChange.toFixed(2)}% from prev
        </div>
      )}
    </div>
  );
}

// ═══ MAIN COMPONENT ═══
export default function AnalyticsChart({
  title,
  data,
  color,
  unit,
  globalRange,
  size = "medium",
}: AnalyticsChartProps) {
  const change = useMemo(() => calcChange(data), [data]);
  const trendColors = useMemo(() => getTrendColors(change, color), [change, color]);

  const gradientId = `grad-${title.replace(/\s+/g, "-").toLowerCase()}`;
  const fadeId = `fade-${title.replace(/\s+/g, "-").toLowerCase()}`;

  const strokeWidth = size === "hero" ? 2.8 : size === "medium" ? 2.2 : 1.8;
  const chartHeight = size === "hero" ? 360 : size === "medium" ? 260 : 200;

  const tickFormatter = useMemo(
    () => (dateStr: string) => formatChartDate(dateStr, globalRange),
    [globalRange]
  );
  const yTickFormatter = useMemo(
    () => (value: number) => formatAxisValue(value, unit),
    [unit]
  );

  // Show 4 ticks for small charts, 5 for medium, 6 for hero
  const maxTicks = size === "hero" ? 6 : size === "medium" ? 5 : 4;
  const tickInterval = data.length > maxTicks * 2
    ? Math.floor(data.length / maxTicks)
    : data.length > 10 ? Math.floor(data.length / 4) : undefined;

  const lastPoint = data.length > 0 ? data[data.length - 1] : null;
  const changeBadge = change !== null ? (
    change > 3 ? "badge-up" : change < -3 ? "badge-down" : "badge-neutral"
  ) : null;

  return (
    <div className={`chart-card-v2 chart-card-${size}`}>
      <div className="chart-card-v2-header">
        <span className="chart-card-v2-title">
          {title}
          {changeBadge && (
            <span className={`chart-card-v2-badge-inline ${changeBadge}`}>
              {change! >= 0 ? "+" : ""}{change!.toFixed(1)}%
            </span>
          )}
        </span>
      </div>
      <div className="chart-card-v2-body">
        <ResponsiveContainer width="100%" height={chartHeight}>
          <AreaChart data={data} margin={{ top: 12, right: 80, bottom: 4, left: 0 }}>
            <defs>
              {/* Horizontal fade for stroke: past very faint, recent strong */}
              <linearGradient id={fadeId} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={trendColors.stroke} stopOpacity={0.06} />
                <stop offset="40%" stopColor={trendColors.stroke} stopOpacity={0.2} />
                <stop offset="75%" stopColor={trendColors.stroke} stopOpacity={0.6} />
                <stop offset="100%" stopColor={trendColors.stroke} stopOpacity={1} />
              </linearGradient>
              {/* Area fill: barely visible on left, subtle on right */}
              <linearGradient id={`${fadeId}-fill`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={trendColors.gradientColor} stopOpacity={0.0} />
                <stop offset="70%" stopColor={trendColors.gradientColor} stopOpacity={0.04} />
                <stop offset="100%" stopColor={trendColors.gradientColor} stopOpacity={0.14} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="4 4"
              stroke="rgba(59,45,38,0.03)"
              vertical={false}
            />
            <XAxis
              dataKey="date"
              tickFormatter={tickFormatter}
              tick={{ fill: "rgba(106,90,81,0.3)", fontSize: 10, fontFamily: "var(--font-mono)" }}
              axisLine={false}
              tickLine={false}
              interval={tickInterval}
              dy={6}
            />
            <YAxis
              tickFormatter={yTickFormatter}
              tick={{ fill: "rgba(106,90,81,0.25)", fontSize: 10, fontFamily: "var(--font-mono)" }}
              axisLine={false}
              tickLine={false}
              width={50}
              dx={-2}
              tickCount={3}
            />
            <RechartsTooltip
              content={<CustomTooltip unit={unit} data={data} />}
              cursor={{ stroke: "rgba(59,45,38,0.06)", strokeDasharray: "3 3" }}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke={`url(#${fadeId})`}
              strokeWidth={strokeWidth}
              fill={`url(#${fadeId}-fill)`}
              dot={false}
              activeDot={{
                r: 5,
                fill: trendColors.stroke,
                stroke: "#fff",
                strokeWidth: 2,
                style: { filter: `drop-shadow(0 0 3px ${trendColors.glowColor})` },
              }}
              animationDuration={800}
              animationEasing="ease-out"
            />
            {/* Only the latest point: glow + value label */}
            {lastPoint && (
              <ReferenceDot
                x={lastPoint.date}
                y={lastPoint.value}
                shape={(props: any) => {
                  const { cx, cy } = props;
                  if (!cx || !cy) return <g />;
                  return (
                    <g>
                      <circle cx={cx} cy={cy} r={8} fill={trendColors.glowColor} opacity={0.18}>
                        <animate attributeName="r" values="6;10;6" dur="2.5s" repeatCount="indefinite" />
                        <animate attributeName="opacity" values="0.2;0.06;0.2" dur="2.5s" repeatCount="indefinite" />
                      </circle>
                      <circle cx={cx} cy={cy} r={3.5} fill={trendColors.stroke} stroke="#fff" strokeWidth={1.5} />
                      <text
                        x={cx + 10}
                        y={cy - 1}
                        fill={trendColors.stroke}
                        fontSize={size === "hero" ? 15 : size === "medium" ? 12 : 10}
                        fontWeight={700}
                        fontFamily="var(--font-mono)"
                        dominantBaseline="middle"
                      >
                        {formatTooltipValue(lastPoint.value, unit)}
                      </text>
                    </g>
                  );
                }}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
