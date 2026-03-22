"use client";

import { useMemo } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { calculatePSEProjection } from "@/lib/pse-calculator";

interface SupplyChartProps {
  currentSupply?: number;
  currentStakingRatio?: number;
  currentInflation?: number;
}

function formatSupply(val: number): string {
  if (val >= 1e9) return `${(val / 1e9).toFixed(0)}B`;
  if (val >= 1e6) return `${(val / 1e6).toFixed(0)}M`;
  return val.toLocaleString();
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "var(--ink-main)",
      color: "var(--bg-paper)",
      padding: "8px 12px",
      fontSize: "0.75rem",
      fontFamily: "var(--font-mono)",
      border: "1px solid var(--ink-light)",
    }}>
      <div style={{ color: "rgba(244,241,235,0.6)", marginBottom: 4 }}>Month {label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ color: p.dataKey === "staked" ? "#d3efcd" : "rgba(244,241,235,0.8)", marginBottom: 2 }}>
          {p.name}: {formatSupply(p.value)}
        </div>
      ))}
    </div>
  );
};

export default function SupplyChart({ currentSupply, currentStakingRatio, currentInflation }: SupplyChartProps) {
  const chartData = useMemo(() => {
    const projections = calculatePSEProjection({
      stakedAmount: 10000,
      targetStakingRatio: 67,
      targetPrice: 1,
      currentSupply: currentSupply || 1_927_475_509,
      currentStakingRatio: currentStakingRatio || 40,
      currentPrice: 0.05,
      currentInflation: currentInflation || 0.00093,
    });

    return projections
      .filter((_, i) => i % 6 === 0 || i === projections.length - 1)
      .map((p) => ({
        month: p.month,
        supply: p.approxSupply,
        staked: Math.round(p.approxSupply * (p.stakingRatio / 100)),
      }));
  }, [currentSupply, currentStakingRatio, currentInflation]);

  return (
    <div className="chart-wrapper">
      <div style={{ width: "100%", height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="gradSupply" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#9a8a7a" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#9a8a7a" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradStaked" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#4a7a1a" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#B1FC03" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(59,45,38,0.08)" />
            <XAxis
              dataKey="month"
              tick={{ fill: "#6a5a51", fontSize: 11, fontFamily: "var(--font-mono)" }}
              axisLine={{ stroke: "rgba(59,45,38,0.15)" }}
              tickLine={false}
            />
            <YAxis
              tickFormatter={formatSupply}
              tick={{ fill: "#6a5a51", fontSize: 11, fontFamily: "var(--font-mono)" }}
              axisLine={{ stroke: "rgba(59,45,38,0.15)" }}
              tickLine={false}
              width={50}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone" dataKey="supply" name="Supply"
              stroke="#9a8a7a" fill="url(#gradSupply)" strokeWidth={0.8}
              strokeDasharray="4 3" strokeOpacity={0.5}
            />
            <Area
              type="monotone" dataKey="staked" name="Staked"
              stroke="#4a7a1a" fill="url(#gradStaked)" strokeWidth={2.8}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: "0.75rem" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 14, height: 2, background: "#9a8a7a", display: "inline-block", opacity: 0.6 }} />
          <span style={{ opacity: 0.5 }}>Total Supply</span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 14, height: 3, background: "#4a7a1a", display: "inline-block", borderRadius: 1 }} />
          <span style={{ fontWeight: 600, color: "var(--accent-olive)" }}>Staked</span>
        </span>
      </div>
    </div>
  );
}
