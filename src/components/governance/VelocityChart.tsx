"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { VelocityPoint } from "@/hooks/useProposalDetail";
import { formatTxAmount } from "@/lib/governance";

interface Props {
  series: VelocityPoint[];
  bondedSnapshot: number;
  quorumRequired: number;
}

// Cumulative stacked area of YES/NO/VETO/ABSTAIN over the voting period.
// Tells delegators "when did the vote actually happen" and whether it
// settled early vs late. We bucket server-side into 24 points.
export default function VelocityChart({ series, bondedSnapshot, quorumRequired }: Props) {
  if (series.length === 0) {
    return <div className="vel-empty">No vote timing data available for this proposal.</div>;
  }
  const quorumLine = bondedSnapshot * quorumRequired;
  const data = series.map((p) => ({
    t: new Date(p.t).getTime(),
    yes: p.yes,
    no: p.no,
    veto: p.veto,
    abstain: p.abstain,
    total: p.yes + p.no + p.veto + p.abstain,
  }));

  return (
    <div className="vel-wrap">
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={data} margin={{ top: 10, right: 14, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
          <XAxis
            dataKey="t"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(t) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            fontSize={11}
          />
          <YAxis
            tickFormatter={(v) => formatTxAmount(v as number)}
            fontSize={11}
            width={70}
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload || payload.length === 0) return null;
              const p = payload[0].payload as typeof data[number];
              return (
                <div className="vel-tooltip">
                  <div className="vel-tooltip-time">
                    {new Date(label as number).toLocaleString()}
                  </div>
                  <Row label="Yes" value={p.yes} cls="vel-tip-yes" />
                  <Row label="No" value={p.no} cls="vel-tip-no" />
                  <Row label="Veto" value={p.veto} cls="vel-tip-veto" />
                  <Row label="Abstain" value={p.abstain} cls="vel-tip-abstain" />
                  <div className="vel-tooltip-total">
                    Cumulative: {formatTxAmount(p.total)} TX
                    {bondedSnapshot > 0 && (
                      <> ({((p.total / bondedSnapshot) * 100).toFixed(1)}% of bonded)</>
                    )}
                  </div>
                </div>
              );
            }}
          />
          <Area dataKey="yes" stackId="1" stroke="#2d8a4a" fill="#2d8a4a" fillOpacity={0.55} />
          <Area dataKey="no" stackId="1" stroke="#c4582a" fill="#c4582a" fillOpacity={0.55} />
          <Area dataKey="veto" stackId="1" stroke="#a8341c" fill="#a8341c" fillOpacity={0.55} />
          <Area dataKey="abstain" stackId="1" stroke="#888" fill="#888" fillOpacity={0.35} />
        </AreaChart>
      </ResponsiveContainer>
      <div className="vel-legend">
        <LegendDot color="#2d8a4a" label="Yes" />
        <LegendDot color="#c4582a" label="No" />
        <LegendDot color="#a8341c" label="Veto" />
        <LegendDot color="#888" label="Abstain" />
        <div className="vel-legend-spacer" />
        <span className="vel-legend-quorum">
          Quorum line: {formatTxAmount(quorumLine)} TX (
          {(quorumRequired * 100).toFixed(0)}% of bonded)
        </span>
      </div>
    </div>
  );
}

function Row({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className={`vel-tip-row ${cls}`}>
      <span>{label}</span>
      <span>{formatTxAmount(value)} TX</span>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="vel-legend-item">
      <span className="vel-legend-dot" style={{ background: color }} />
      {label}
    </span>
  );
}
