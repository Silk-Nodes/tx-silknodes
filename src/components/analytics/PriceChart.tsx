"use client";

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
import type { DataPoint } from "@/lib/analytics-utils";
import { calcChange } from "@/lib/analytics-utils";
import priceDataRaw from "@/data/analytics/price-usd.json";

// TX era only
const TX_ERA = "2026-03-06";
const priceData: DataPoint[] = (priceDataRaw as DataPoint[]).filter((d) => d.date >= TX_ERA);

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload || !payload.length) return null;
  const d = new Date(label + "T00:00:00");
  const formatted = d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
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
    }}>
      <div style={{ color: "rgba(244,241,235,0.5)", marginBottom: 3, fontSize: "0.62rem" }}>{formatted}</div>
      <div style={{ fontWeight: 700, color: "#B1FC03", fontSize: "0.95rem" }}>${payload[0].value.toFixed(4)}</div>
    </div>
  );
}

export default function PriceChart() {
  if (priceData.length === 0) return null;

  const latest = priceData[priceData.length - 1];
  const change = calcChange(priceData);
  const isUp = change !== null && change >= 0;
  const lineColor = isUp ? "#4a7a1a" : "#b44a3e";
  const gradientId = "price-grad";
  const fadeId = "price-fade";

  return (
    <div className="chart-card-v2 chart-card-hero price-chart-card">
      <div className="price-header-left">
        <span className="chart-card-v2-title">
          TX Price
          {change !== null && (
            <span className={`chart-card-v2-badge-inline ${change > 0 ? "badge-up" : change < -3 ? "badge-down" : "badge-neutral"}`}>
              {change >= 0 ? "+" : ""}{change.toFixed(1)}%
            </span>
          )}
        </span>
        <span className="price-current" style={{ color: lineColor }}>
          ${latest.value.toFixed(4)}
        </span>
      </div>
      <div style={{ width: "100%", height: 380 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={priceData} margin={{ top: 12, right: 70, bottom: 4, left: 0 }}>
            <defs>
              <linearGradient id={fadeId} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={lineColor} stopOpacity={0.06} />
                <stop offset="55%" stopColor={lineColor} stopOpacity={0.45} />
                <stop offset="100%" stopColor={lineColor} stopOpacity={1} />
              </linearGradient>
              <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={lineColor} stopOpacity={0.0} />
                <stop offset="70%" stopColor={lineColor} stopOpacity={0.04} />
                <stop offset="100%" stopColor={lineColor} stopOpacity={0.14} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="4 4" stroke="rgba(59,45,38,0.03)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(d: string) => {
                const dt = new Date(d + "T00:00:00");
                return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][dt.getMonth()]} ${dt.getDate()}`;
              }}
              tick={{ fill: "rgba(106,90,81,0.3)", fontSize: 10, fontFamily: "var(--font-mono)" }}
              axisLine={false}
              tickLine={false}
              interval={Math.floor(priceData.length / 6)}
              dy={6}
            />
            <YAxis
              tickFormatter={(v: number) => `$${v.toFixed(3)}`}
              tick={{ fill: "rgba(106,90,81,0.25)", fontSize: 10, fontFamily: "var(--font-mono)" }}
              axisLine={false}
              tickLine={false}
              width={55}
              tickCount={4}
              domain={["auto", "auto"]}
            />
            <RechartsTooltip content={<CustomTooltip />} cursor={{ stroke: "rgba(59,45,38,0.06)", strokeDasharray: "3 3" }} />
            <Area
              type="monotone"
              dataKey="value"
              stroke={`url(#${fadeId})`}
              strokeWidth={2.5}
              fill={`url(#${gradientId})`}
              dot={false}
              activeDot={{ r: 5, fill: lineColor, stroke: "#fff", strokeWidth: 2 }}
              animationDuration={800}
              animationEasing="ease-out"
            />
            <ReferenceDot
              x={latest.date}
              y={latest.value}
              shape={(props: any) => {
                const { cx, cy } = props;
                if (!cx || !cy) return <g />;
                return (
                  <g>
                    <circle cx={cx} cy={cy} r={8} fill={lineColor} opacity={0.15}>
                      <animate attributeName="r" values="6;10;6" dur="2.5s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.2;0.06;0.2" dur="2.5s" repeatCount="indefinite" />
                    </circle>
                    <circle cx={cx} cy={cy} r={3.5} fill={lineColor} stroke="#fff" strokeWidth={1.5} />
                    <text x={cx + 10} y={cy - 1} fill={lineColor} fontSize={13} fontWeight={700} fontFamily="var(--font-mono)" dominantBaseline="middle">
                      ${latest.value.toFixed(4)}
                    </text>
                  </g>
                );
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
