"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  Cell,
} from "recharts";
import type { DataPoint } from "@/lib/analytics-utils";
import { formatLargeNumber, formatTooltipDate } from "@/lib/analytics-utils";
import Shareable from "@/components/share/Shareable";

interface SpikePoint extends DataPoint {
  walletCount?: number;
}

interface SpikeChartProps {
  title: string;
  subtitle?: string;
  data: SpikePoint[];
  total: string;
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload || !payload.length) return null;
  const point = payload[0].payload as SpikePoint;
  const wallets = point?.walletCount ?? 0;
  return (
    <div style={{
      background: "rgba(15, 27, 7, 0.94)",
      color: "#f4f1eb",
      border: "1px solid rgba(180, 74, 62, 0.3)",
      borderRadius: 10,
      padding: "10px 14px",
      fontFamily: "var(--font-mono)",
      fontSize: "0.72rem",
      boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
    }}>
      <div style={{ color: "rgba(244,241,235,0.5)", marginBottom: 3, fontSize: "0.65rem" }}>
        {formatTooltipDate(label || "")}
      </div>
      <div style={{ fontWeight: 700, color: "#e8927a", fontSize: "0.9rem" }}>
        {formatLargeNumber(payload[0].value, 1)} TX
      </div>
      {wallets > 0 && (
        <div style={{ color: "rgba(244,241,235,0.7)", marginTop: 3, fontSize: "0.68rem" }}>
          {wallets.toLocaleString()} {wallets === 1 ? "wallet" : "wallets"}
        </div>
      )}
    </div>
  );
}

export default function SpikeChart({ title, subtitle, data, total }: SpikeChartProps) {
  const maxVal = Math.max(...data.map((d) => d.value), 0);

  return (
    <Shareable title={title} framed={false}>
    <div className="chart-card-v2 chart-card-small">
      <div className="chart-card-v2-header">
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span className="chart-card-v2-title">{title}</span>
          {subtitle && (
            <span style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.62rem",
              color: "rgba(106,90,81,0.7)",
              letterSpacing: "0.02em",
            }}>
              {subtitle}
            </span>
          )}
        </div>
        <span className="chart-card-v2-current" style={{ color: "#b44a3e" }}>
          {total} TX
        </span>
      </div>
      <div className="chart-card-v2-body">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <XAxis
              dataKey="date"
              tickFormatter={(d: string) => {
                const date = new Date(d + "T00:00:00");
                return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
              }}
              tick={{ fill: "rgba(106,90,81,0.5)", fontSize: 10, fontFamily: "var(--font-mono)" }}
              axisLine={false}
              tickLine={false}
              dy={4}
            />
            <YAxis
              tickFormatter={(v: number) => formatLargeNumber(v, 0)}
              tick={{ fill: "rgba(106,90,81,0.4)", fontSize: 10, fontFamily: "var(--font-mono)" }}
              axisLine={false}
              tickLine={false}
              width={45}
              tickCount={3}
            />
            <RechartsTooltip content={<CustomTooltip />} cursor={{ fill: "rgba(180,74,62,0.04)" }} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]} animationDuration={600}>
              {data.map((entry, i) => {
                const intensity = maxVal > 0 ? entry.value / maxVal : 0;
                const isSpike = intensity > 0.5;
                const isMajor = intensity > 0.8;
                return (
                  <Cell
                    key={i}
                    fill={isMajor ? "rgba(180, 74, 62, 0.85)" : isSpike ? "rgba(180, 74, 62, 0.5)" : "rgba(180, 74, 62, 0.15)"}
                    stroke={isMajor ? "#8b2e22" : "transparent"}
                    strokeWidth={isMajor ? 1.5 : 0}
                  />
                );
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
    </Shareable>
  );
}
