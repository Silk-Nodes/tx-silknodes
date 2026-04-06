"use client";

import { useMemo } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { PSE_CONFIG, getPSEDistributionInfo } from "@/lib/pse-calculator";

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
      background: "rgba(15, 27, 7, 0.92)",
      color: "#f4f1eb",
      padding: "10px 14px",
      fontSize: "0.75rem",
      fontFamily: "var(--font-mono)",
      border: "1px solid rgba(177, 252, 3, 0.3)",
      borderRadius: 8,
      boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
    }}>
      <div style={{ color: "rgba(177, 252, 3, 0.7)", marginBottom: 4, fontWeight: 600 }}>Month {label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ color: p.dataKey === "staked" ? "#B1FC03" : "rgba(244,241,235,0.7)", marginBottom: 2 }}>
          {p.name}: {formatSupply(p.value)}
        </div>
      ))}
    </div>
  );
};

// Total monthly PSE emission (all pools combined)
const TOTAL_MONTHLY_PSE = 1_190_476_190; // 100B / 84

export default function SupplyChart({ currentSupply, currentStakingRatio, currentInflation }: SupplyChartProps) {
  const chartData = useMemo(() => {
    const pseInfo = getPSEDistributionInfo();
    const distributionsDone = Math.max(0, pseInfo.completedCycles);
    const pseMonthsRemaining = Math.max(0, 84 - distributionsDone);

    let supply = currentSupply || 1_927_475_509;
    const startRatio = (currentStakingRatio || 40) / 100;
    const targetRatio = 0.67;
    const inflation = currentInflation || 0.000972;

    const data: { month: number; supply: number; staked: number }[] = [];

    for (let m = 0; m <= pseMonthsRemaining; m++) {
      const progress = pseMonthsRemaining > 0 ? m / pseMonthsRemaining : 0;
      const ratio = startRatio + (targetRatio - startRatio) * progress;
      data.push({
        month: m,
        supply: Math.round(supply),
        staked: Math.round(supply * ratio),
      });
      // Each month: PSE tokens enter circulation + inflation
      if (m < pseMonthsRemaining) {
        supply += TOTAL_MONTHLY_PSE;
        supply += (inflation * supply) / 12;
      }
    }

    // Sample every 6 months for chart readability
    return data.filter((_, i) => i % 6 === 0 || i === data.length - 1);
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
