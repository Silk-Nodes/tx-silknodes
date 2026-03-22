"use client";

import { useState, useMemo, useCallback } from "react";
import { useWallet } from "@/hooks/useWallet";
import {
  getProjectionSummary,
  estimatePSERewardFullPeriod,
  getPSEDistributionInfo,
  PSE_ALLOCATION,
} from "@/lib/pse-calculator";
import { delegateTokens } from "@/lib/wallet";
import { SILK_NODES_VALIDATOR, SILK_NODES_MONIKER } from "@/lib/chain-config";
import type { CalculatorInputs } from "@/lib/types";

interface StakingPageProps {
  currentPrice: number;
  currentSupply: number;
  currentStakingRatio: number;
  currentInflation: number;
  bondedTokens: number;
  apr: number;
}

function formatTX(num: number): string {
  if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B TX`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M TX`;
  if (num >= 1e3) return `~${(num / 1e3).toFixed(1)}K TX`;
  return `~${Math.round(num).toLocaleString()} TX`;
}

export default function StakingPage({
  currentPrice,
  currentSupply,
  currentStakingRatio,
  currentInflation,
  bondedTokens,
  apr,
}: StakingPageProps) {
  const { wallet, connect } = useWallet();
  const [stakeInput, setStakeInput] = useState(
    wallet.stakedAmount > 0 ? wallet.stakedAmount.toString() : "10000"
  );
  const [targetRatio, setTargetRatio] = useState("67");
  const [targetPrice, setTargetPrice] = useState("1");
  const [delegateAmount, setDelegateAmount] = useState("");
  const [delegating, setDelegating] = useState(false);
  const [delegateResult, setDelegateResult] = useState<string | null>(null);
  const [delegateError, setDelegateError] = useState<string | null>(null);

  const stakedAmount = parseFloat(stakeInput.replace(/,/g, "")) || 0;
  const pseInfo = getPSEDistributionInfo();

  const nextPSEReward = useMemo(() => {
    if (bondedTokens <= 0) return 0;
    const amount = wallet.connected ? wallet.stakedAmount : stakedAmount;
    return estimatePSERewardFullPeriod(amount, bondedTokens);
  }, [wallet, stakedAmount, bondedTokens]);

  const summary = useMemo(() => {
    const inputs: CalculatorInputs = {
      stakedAmount,
      targetStakingRatio: parseFloat(targetRatio) || 67,
      targetPrice: parseFloat(targetPrice) || currentPrice,
      currentSupply: currentSupply || 1_927_475_509,
      currentStakingRatio: currentStakingRatio || 40,
      currentPrice: currentPrice || 0.05,
      currentInflation: currentInflation || 0.00093,
    };
    return getProjectionSummary(inputs);
  }, [stakedAmount, targetRatio, targetPrice, currentSupply, currentStakingRatio, currentPrice, currentInflation]);

  const handleDelegate = useCallback(async () => {
    const amount = parseFloat(delegateAmount);
    if (!amount || amount <= 0) return;
    setDelegating(true);
    setDelegateError(null);
    setDelegateResult(null);
    try {
      const txHash = await delegateTokens(SILK_NODES_VALIDATOR, amount);
      setDelegateResult(txHash);
      setDelegateAmount("");
    } catch (err: any) {
      setDelegateError(err.message || "Delegation failed");
    } finally {
      setDelegating(false);
    }
  }, [delegateAmount]);

  // "Start now vs wait" comparison
  const waitComparison = useMemo(() => {
    if (stakedAmount <= 0) return null;
    const nowBag = summary.fullCycle.totalBag;
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
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* TOP — PSE Metrics row */}
      <div className="metrics-row" style={{ gridTemplateColumns: "2fr 1.5fr 1fr 1fr 1fr" }}>
        <div className="metric-cell">
          <div className="metric-top">
            <span className="label">PSE Progress</span>
            <span className="label color-accent">{pseInfo.progressPercent}%</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="value-large mono">{pseInfo.distributionNumber}/{pseInfo.totalDistributions}</span>
            <div style={{ flex: 1, height: 4, background: "#e8e8e8", borderRadius: 2 }}>
              <div style={{ width: `${pseInfo.progressPercent}%`, height: "100%", background: "var(--accent)", borderRadius: 2 }} />
            </div>
          </div>
        </div>
        <div className="metric-cell">
          <div className="metric-top">
            <span className="label">{wallet.connected ? "Your Est. PSE" : "Est. PSE / month"}</span>
          </div>
          <span className="value-large mono color-accent">{formatTX(nextPSEReward)}</span>
        </div>
        <div className="metric-cell">
          <div className="metric-top"><span className="label">Community Pool</span></div>
          <span className="value-large mono" style={{ fontSize: 16 }}>{formatTX(pseInfo.communityPerDistribution)}</span>
        </div>
        <div className="metric-cell">
          <div className="metric-top">
            <span className="label">Base APR</span>
          </div>
          <span className="value-large mono">{apr > 0 ? `${apr.toFixed(2)}%` : "..."}</span>
          <span className="label" style={{ fontSize: 6, color: "var(--accent-dark)", marginTop: -2 }}>+ PSE rewards</span>
        </div>
        <div className="metric-cell">
          <div className="metric-top"><span className="label">PSE Ends</span></div>
          <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>
            {pseInfo.endDate.toLocaleDateString("en-US", { year: "numeric", month: "short" })}
          </span>
        </div>
      </div>

      {/* MAIN — 2 column */}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>

        {/* LEFT — "What if" Calculator */}
        <div style={{ flex: "1 1 55%", padding: 14, borderRight: "var(--line)", display: "flex", flexDirection: "column" }}>
          <span className="label" style={{ marginBottom: 6, fontSize: 10, color: "var(--black)" }}>
            IF YOU STAKE TODAY — WHAT HAPPENS?
          </span>

          {/* Stake input with slider */}
          <div style={{ marginBottom: 6 }}>
            <div className="input-group" style={{ height: 32, marginBottom: 4 }}>
              <div className="input-addon label" style={{ fontSize: 8 }}>STAKE</div>
              <input type="text" value={stakeInput} onChange={(e) => setStakeInput(e.target.value)} placeholder="10000" style={{ fontSize: 12 }} />
              <div className="input-addon label" style={{ fontSize: 8 }}>TX</div>
              {wallet.connected && (
                <button className="input-action" style={{ fontSize: 8 }} onClick={() => setStakeInput(wallet.stakedAmount.toString())}>MY BAG</button>
              )}
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

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>
            <div>
              <span className="label" style={{ display: "block", marginBottom: 2, fontSize: 7 }}>Target Staking Ratio (84mo)</span>
              <div className="input-group" style={{ marginBottom: 0, height: 26 }}>
                <input type="text" value={targetRatio} onChange={(e) => setTargetRatio(e.target.value)} style={{ fontSize: 10 }} />
                <div className="input-addon label" style={{ fontSize: 7 }}>%</div>
              </div>
            </div>
            <div>
              <span className="label" style={{ display: "block", marginBottom: 2, fontSize: 7 }}>Target TX Price (84mo)</span>
              <div className="input-group" style={{ marginBottom: 0, height: 26 }}>
                <div className="input-addon label" style={{ fontSize: 7 }}>$</div>
                <input type="text" value={targetPrice} onChange={(e) => setTargetPrice(e.target.value)} style={{ fontSize: 10 }} />
              </div>
            </div>
          </div>

          {/* HERO OUTCOME */}
          <div className="outcome-card" style={{ marginBottom: 6 }}>
            <div className="outcome-row">
              <div>
                <span className="label" style={{ fontSize: 7 }}>YOUR BAG AFTER 84 MONTHS</span>
                <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: "var(--black)" }}>
                  {summary.fullCycle.totalBag.toLocaleString()} <span style={{ fontSize: 12, color: "var(--muted)" }}>TX</span>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <span className="label" style={{ fontSize: 7 }}>GROWTH</span>
                <div className="mono color-accent" style={{ fontSize: 22, fontWeight: 800 }}>+{growthPct}%</div>
              </div>
            </div>
            <div className="outcome-row" style={{ marginTop: 4, paddingTop: 4, borderTop: "1px solid rgba(164,228,0,0.2)" }}>
              <div>
                <span className="label" style={{ fontSize: 7 }}>EST. VALUE AT ${targetPrice}</span>
                <span className="mono" style={{ fontSize: 13, fontWeight: 700 }}>
                  ${(summary.fullCycle.totalBag * parseFloat(targetPrice || "0")).toLocaleString()}
                </span>
              </div>
              <div style={{ textAlign: "right" }}>
                <span className="label" style={{ fontSize: 7 }}>PSE BONUS EARNED</span>
                <span className="mono color-accent" style={{ fontSize: 13, fontWeight: 700 }}>
                  +{formatTX(summary.fullCycle.pseBonus)}
                </span>
              </div>
            </div>
          </div>

          {/* Timeline breakdown */}
          <table className="data-table label" style={{ marginTop: 0, fontSize: 9 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Timeline</th>
                <th>Base Yield</th>
                <th>PSE Bonus</th>
                <th>Total Bag</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ textAlign: "left" }}>1 Month</td>
                <td className="mono">{formatTX(summary.oneMonth.baseYield)}</td>
                <td className="mono color-accent">+{formatTX(summary.oneMonth.pseBonus)}</td>
                <td className="mono">{summary.oneMonth.totalBag.toLocaleString()} TX</td>
              </tr>
              <tr>
                <td style={{ textAlign: "left" }}>12 Months</td>
                <td className="mono">{formatTX(summary.oneYear.baseYield)}</td>
                <td className="mono color-accent">+{formatTX(summary.oneYear.pseBonus)}</td>
                <td className="mono">{summary.oneYear.totalBag.toLocaleString()} TX</td>
              </tr>
              <tr>
                <td style={{ textAlign: "left", fontWeight: 700 }}>84 Months</td>
                <td className="mono">{formatTX(summary.fullCycle.baseYield)}</td>
                <td className="mono color-accent">+{formatTX(summary.fullCycle.pseBonus)}</td>
                <td className="mono" style={{ fontWeight: 700 }}>{summary.fullCycle.totalBag.toLocaleString()} TX</td>
              </tr>
            </tbody>
          </table>

          {/* Start now vs wait */}
          {waitComparison && (
            <div style={{
              padding: "6px 10px",
              background: "#111",
              borderRadius: 4,
              marginTop: 6,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 7, color: "rgba(255,255,255,0.35)", letterSpacing: "0.08em" }}>START TODAY</span>
                  <div className="mono" style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>{waitComparison.nowBag.toLocaleString()} TX</div>
                </div>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 7, color: "rgba(255,255,255,0.2)" }}>vs</span>
                <div style={{ textAlign: "right" }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 7, color: "rgba(255,255,255,0.35)", letterSpacing: "0.08em" }}>WAIT 3 MONTHS</span>
                  <div className="mono" style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.4)" }}>{waitComparison.waitBag.toLocaleString()} TX</div>
                </div>
              </div>
              <div style={{ marginTop: 3, textAlign: "center" }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: "#e53e3e", fontWeight: 700 }}>
                  Waiting costs ~{waitComparison.diff.toLocaleString()} TX ({waitComparison.diffPct}% less)
                </span>
              </div>
            </div>
          )}

          {/* Bottom */}
          <div style={{ marginTop: "auto", paddingTop: 4 }}>
            <span className="label" style={{ fontSize: 6, color: "var(--muted)" }}>
              Estimates only — real PSE depends on your score vs all stakers. Not financial advice.
            </span>
          </div>
        </div>

        {/* RIGHT — Delegate + Info */}
        <div style={{ flex: "1 1 45%", display: "flex", flexDirection: "column" }}>

          {/* Delegate Panel */}
          <div style={{ padding: 14, flex: 1, borderBottom: "var(--line)" }}>
            <span className="label" style={{ marginBottom: 6, display: "block", fontSize: 10, color: "var(--black)" }}>
              STAKE WITH SILK NODES
            </span>

            <div className="value-medium" style={{ marginBottom: 8, fontSize: 13 }}>{SILK_NODES_MONIKER}</div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 12px", marginBottom: 10 }}>
              {[
                ["COMMISSION", "10.00%"],
                ["UNBONDING", "7 days"],
                ["MIN COMM.", "5.00%"],
                ["BASE APR", apr > 0 ? `${apr.toFixed(2)}%` : "..."],
              ].map(([label, value], i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px dotted #eee" }}>
                  <span className="label" style={{ fontSize: 7 }}>{label}</span>
                  <span className={`mono ${label === "BASE APR" ? "color-accent" : ""}`} style={{ fontSize: 10, fontWeight: 600 }}>{value}</span>
                </div>
              ))}
            </div>

            {/* Why stake callout */}
            <div style={{ padding: "6px 10px", background: "#111", borderRadius: 4, marginBottom: 10 }}>
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.6)", lineHeight: 1.6, display: "block" }}>
                <span style={{ color: "var(--accent)", fontWeight: 700 }}>Most rewards come from PSE — not base APR.</span>{" "}
                Your rewards grow over time — the longer you stay, the faster they accelerate. Unbonding resets your score and costs you compounding.
              </span>
            </div>

            {wallet.connected ? (
              <div>
                <span className="label" style={{ fontSize: 7, display: "block", marginBottom: 3 }}>
                  AVAILABLE: {wallet.balance.toFixed(2)} TX
                </span>
                <div className="input-group" style={{ marginBottom: 0, height: 30 }}>
                  <input type="text" value={delegateAmount} onChange={(e) => setDelegateAmount(e.target.value)} placeholder="Amount" style={{ fontSize: 11 }} />
                  <div className="input-addon label" style={{ fontSize: 8 }}>TX</div>
                  <button className="input-action" style={{ fontSize: 8 }} onClick={() => setDelegateAmount(Math.max(0, wallet.balance - 1).toString())}>MAX</button>
                </div>
                <button className="btn primary" onClick={handleDelegate} disabled={delegating || !delegateAmount} style={{ opacity: delegating || !delegateAmount ? 0.5 : 1, height: 32, marginTop: 6 }}>
                  {delegating ? "DELEGATING..." : "DELEGATE NOW"}
                </button>
                {delegateResult && (
                  <div style={{ marginTop: 4, padding: 4, background: "var(--accent-bg)", borderRadius: 2 }}>
                    <span className="label" style={{ fontSize: 7, color: "var(--accent-dark)" }}>✓ TX: {delegateResult.slice(0, 16)}...</span>
                  </div>
                )}
                {delegateError && (
                  <div style={{ marginTop: 4, padding: 4, background: "rgba(229,62,62,0.05)", borderRadius: 2 }}>
                    <span className="label" style={{ fontSize: 7, color: "var(--danger)" }}>{delegateError}</span>
                  </div>
                )}
              </div>
            ) : (
              <button className="btn primary" onClick={() => connect()} style={{ height: 32 }}>
                CONNECT WALLET TO STAKE
              </button>
            )}

            {wallet.connected && wallet.stakedAmount > 0 && (
              <div style={{ marginTop: 8, padding: "6px 8px", border: "var(--line)", borderRadius: 4, background: "var(--bg-secondary)" }}>
                <span className="label" style={{ fontSize: 7, marginBottom: 3, display: "block" }}>YOUR POSITION</span>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                  <span className="label" style={{ fontSize: 7 }}>Staked</span>
                  <span className="mono color-accent" style={{ fontSize: 9 }}>{wallet.stakedAmount.toFixed(2)} TX</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="label" style={{ fontSize: 7 }}>Pending Rewards</span>
                  <span className="mono" style={{ fontSize: 9 }}>{wallet.rewards.toFixed(4)} TX</span>
                </div>
              </div>
            )}
          </div>

          {/* PSE Allocation */}
          <div style={{ padding: "8px 14px", background: "var(--bg-secondary)", flexShrink: 0 }}>
            <span className="label" style={{ fontSize: 7, marginBottom: 4, display: "block" }}>PSE ALLOCATION (100B TX / 84 MO)</span>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1px 14px" }}>
              {Object.entries(PSE_ALLOCATION).map(([key, value]) => (
                <div key={key} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="label" style={{ fontSize: 7, textTransform: "capitalize" }}>{key.replace(/([A-Z])/g, " $1")}</span>
                  <span className="mono" style={{ fontSize: 9, color: key === "community" ? "var(--accent-dark)" : "var(--muted)", fontWeight: key === "community" ? 700 : 400 }}>
                    {(value * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
