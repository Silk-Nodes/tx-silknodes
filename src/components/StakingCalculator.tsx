"use client";

import { useState, useMemo } from "react";
import { getProjectionSummary } from "@/lib/pse-calculator";
import type { CalculatorInputs } from "@/lib/types";

interface StakingCalculatorProps {
  currentPrice: number;
  currentSupply: number;
  currentStakingRatio: number;
  currentInflation?: number;
  bondedTokens?: number;
  walletStakedAmount?: number;
}

function formatTX(num: number): string {
  if (num >= 1e6) return `~${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `~${(num / 1e3).toFixed(1)}K`;
  return `~${Math.round(num).toLocaleString()}`;
}

export default function StakingCalculator({
  currentPrice,
  currentSupply,
  currentStakingRatio,
  currentInflation,
  walletStakedAmount,
}: StakingCalculatorProps) {
  const [stakeInput, setStakeInput] = useState(
    walletStakedAmount?.toString() || "10000"
  );
  const [targetRatio, setTargetRatio] = useState("67");
  const [targetPrice, setTargetPrice] = useState("1");

  const stakedAmount = parseFloat(stakeInput.replace(/,/g, "")) || 0;

  const makeInputs = (amount: number): CalculatorInputs => ({
    stakedAmount: amount,
    targetStakingRatio: parseFloat(targetRatio) || 67,
    targetPrice: parseFloat(targetPrice) || currentPrice,
    currentSupply: currentSupply || 1_927_475_509,
    currentStakingRatio: currentStakingRatio || 40,
    currentPrice: currentPrice || 0.05,
    currentInflation: currentInflation || 0.00093,
  });

  const summary = useMemo(() => {
    return getProjectionSummary(makeInputs(stakedAmount));
  }, [
    stakedAmount, targetRatio, targetPrice,
    currentSupply, currentStakingRatio, currentPrice, currentInflation,
  ]);

  // "Start now vs wait" — compare starting today vs 3 months later
  const waitComparison = useMemo(() => {
    if (stakedAmount <= 0) return null;
    const nowBag = summary.fullCycle.totalBag;
    // If you wait 3 months, you only get 81 months of compounding
    // Approximate: lose ~3 months of PSE bonus
    const threeMonthPSE = summary.projections
      .slice(0, 3)
      .reduce((s, p) => s + p.pseReward + p.stakingRewards, 0);
    const waitBag = nowBag - threeMonthPSE;
    const diff = nowBag - waitBag;
    const diffPct = ((diff / waitBag) * 100).toFixed(1);
    return { nowBag, waitBag: Math.round(waitBag), diff: Math.round(diff), diffPct };
  }, [summary, stakedAmount]);

  const growthPct = stakedAmount > 0
    ? (((summary.fullCycle.totalBag - stakedAmount) / stakedAmount) * 100).toFixed(0)
    : "0";

  return (
    <div className="cell area-calculator" style={{ padding: 14 }}>
      <div className="cell-content">
        <div className="cell-header" style={{ marginBottom: 6 }}>
          <span className="label" style={{ color: "var(--black)", fontSize: 9 }}>IF YOU STAKE TODAY</span>
          <span className="label color-accent" style={{ fontSize: 8 }}>84-MO PROJECTION</span>
        </div>

        {/* Stake amount with slider */}
        <div style={{ marginBottom: 6 }}>
          <div className="input-group" style={{ height: 28, marginBottom: 4 }}>
            <div className="input-addon label" style={{ fontSize: 7 }}>STAKE</div>
            <input
              type="text"
              value={stakeInput}
              onChange={(e) => setStakeInput(e.target.value)}
              placeholder="10000"
              style={{ fontSize: 12 }}
            />
            <div className="input-addon label" style={{ fontSize: 7 }}>TX</div>
          </div>
          <input
            type="range"
            min="1000"
            max="1000000"
            step="1000"
            value={stakedAmount || 10000}
            onChange={(e) => setStakeInput(e.target.value)}
            className="slider-input"
          />
        </div>

        {/* Target inputs */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 6 }}>
          <div>
            <span className="label" style={{ display: "block", marginBottom: 1, fontSize: 7 }}>Target Ratio</span>
            <div className="input-group" style={{ marginBottom: 0, height: 24 }}>
              <input type="text" value={targetRatio} onChange={(e) => setTargetRatio(e.target.value)} style={{ fontSize: 10 }} />
              <div className="input-addon label" style={{ fontSize: 7 }}>%</div>
            </div>
          </div>
          <div>
            <span className="label" style={{ display: "block", marginBottom: 1, fontSize: 7 }}>Target Price</span>
            <div className="input-group" style={{ marginBottom: 0, height: 24 }}>
              <div className="input-addon label" style={{ fontSize: 7 }}>$</div>
              <input type="text" value={targetPrice} onChange={(e) => setTargetPrice(e.target.value)} style={{ fontSize: 10 }} />
            </div>
          </div>
        </div>

        {/* HERO OUTCOME */}
        <div className="outcome-card" style={{ marginBottom: 4 }}>
          <div className="outcome-row">
            <div>
              <span className="label" style={{ fontSize: 6 }}>YOUR BAG AFTER 84 MONTHS</span>
              <div className="mono" style={{ fontSize: 18, fontWeight: 800, color: "var(--black)" }}>
                {summary.fullCycle.totalBag.toLocaleString()} <span style={{ fontSize: 10 }}>TX</span>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <span className="label" style={{ fontSize: 6 }}>GROWTH</span>
              <div className="mono color-accent" style={{ fontSize: 18, fontWeight: 800 }}>+{growthPct}%</div>
            </div>
          </div>
          <div className="outcome-row" style={{ marginTop: 3, paddingTop: 3, borderTop: "1px solid rgba(164,228,0,0.2)" }}>
            <div>
              <span className="label" style={{ fontSize: 6 }}>EST. VALUE</span>
              <span className="mono" style={{ fontSize: 11, fontWeight: 600 }}>
                ${(summary.fullCycle.totalBag * parseFloat(targetPrice || "0")).toLocaleString()}
              </span>
            </div>
            <div style={{ textAlign: "right" }}>
              <span className="label" style={{ fontSize: 6 }}>PSE BONUS</span>
              <span className="mono color-accent" style={{ fontSize: 11, fontWeight: 600 }}>
                +{formatTX(summary.fullCycle.pseBonus)}
              </span>
            </div>
          </div>
        </div>

        {/* START NOW VS WAIT — the killer feature */}
        {waitComparison && (
          <div style={{
            padding: "5px 8px",
            background: "#111",
            borderRadius: 4,
            marginBottom: 4,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 7, color: "rgba(255,255,255,0.35)", letterSpacing: "0.08em" }}>
                  START TODAY
                </span>
                <div className="mono" style={{ fontSize: 11, fontWeight: 700, color: "#fff" }}>
                  {waitComparison.nowBag.toLocaleString()} TX
                </div>
              </div>
              <div style={{ textAlign: "center" }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 7, color: "rgba(255,255,255,0.25)" }}>vs</span>
              </div>
              <div style={{ textAlign: "right" }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 7, color: "rgba(255,255,255,0.35)", letterSpacing: "0.08em" }}>
                  WAIT 3 MONTHS
                </span>
                <div className="mono" style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)" }}>
                  {waitComparison.waitBag.toLocaleString()} TX
                </div>
              </div>
            </div>
            <div style={{ marginTop: 3, textAlign: "center" }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: "#e53e3e", fontWeight: 700 }}>
                Waiting costs you ~{waitComparison.diff.toLocaleString()} TX ({waitComparison.diffPct}% less)
              </span>
            </div>
          </div>
        )}

        {/* Compact breakdown */}
        <table className="data-table label" style={{ marginTop: 2, fontSize: 8 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}></th>
              <th>Yield</th>
              <th>PSE</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ textAlign: "left" }}>1 Mo</td>
              <td className="mono">{formatTX(summary.oneMonth.baseYield)}</td>
              <td className="mono color-accent">+{formatTX(summary.oneMonth.pseBonus)}</td>
              <td className="mono">{summary.oneMonth.totalBag.toLocaleString()}</td>
            </tr>
            <tr>
              <td style={{ textAlign: "left" }}>12 Mo</td>
              <td className="mono">{formatTX(summary.oneYear.baseYield)}</td>
              <td className="mono color-accent">+{formatTX(summary.oneYear.pseBonus)}</td>
              <td className="mono">{summary.oneYear.totalBag.toLocaleString()}</td>
            </tr>
            <tr>
              <td style={{ textAlign: "left", fontWeight: 600 }}>84 Mo</td>
              <td className="mono">{formatTX(summary.fullCycle.baseYield)}</td>
              <td className="mono color-accent">+{formatTX(summary.fullCycle.pseBonus)}</td>
              <td className="mono" style={{ fontWeight: 700 }}>{summary.fullCycle.totalBag.toLocaleString()}</td>
            </tr>
          </tbody>
        </table>

        <div style={{ marginTop: "auto", paddingTop: 3 }}>
          <span className="label" style={{ color: "var(--muted)", fontSize: 6 }}>
            Estimates only — real PSE depends on your score vs all stakers
          </span>
        </div>
      </div>
    </div>
  );
}
