"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { StakingData, ValidatorInfo } from "@/lib/types";
import type { Proposal } from "@/lib/governance";
import type { NextPSECycle } from "@/hooks/useNextPSECycle";

interface Props {
  validators: ValidatorInfo[];
  stakingData: StakingData | null;
  proposals: Proposal[];
  cycle: NextPSECycle | null;
}

// Compact signals row, designed as a news brief. Each row is one
// insight derived from data we already have. The whale + flow rows are
// API-dependent and silently disappear if their endpoints fail so the
// page still renders cleanly on a partial backend.
export default function TodaySignals({ validators, stakingData, proposals, cycle }: Props) {
  // ── Free-data signals ──────────────────────────────────────────────

  // Decentralization: share held by top-10 validators.
  const decentralization = useMemo(() => {
    if (!validators.length || !stakingData?.bondedTokens) return null;
    const sorted = [...validators].sort((a, b) => b.tokens - a.tokens);
    const top10 = sorted.slice(0, 10).reduce((sum, v) => sum + v.tokens, 0);
    const pct = (top10 / stakingData.bondedTokens) * 100;
    // Minimum-coalition size: how few of the largest validators sum to >50%
    // of bonded. That's the smallest set that could collectively decide
    // chain governance under simple-majority rules.
    let coalition = 0;
    let cum = 0;
    for (const v of sorted) {
      coalition++;
      cum += v.tokens;
      if (cum > stakingData.bondedTokens * 0.5) break;
    }
    return { pct, coalition, top10Count: Math.min(10, sorted.length) };
  }, [validators, stakingData?.bondedTokens]);

  // Governance velocity.
  const governance = useMemo(() => {
    if (!proposals.length) return null;
    const passed = proposals.filter((p) => p.status === "passed").length;
    const total = proposals.length;
    const passRate = (passed / total) * 100;
    const decided = proposals
      .filter((p) => p.status === "passed" || p.status === "rejected" || p.status === "failed")
      .sort((a, b) => {
        const at = a.votingEndTime ? new Date(a.votingEndTime).getTime() : 0;
        const bt = b.votingEndTime ? new Date(b.votingEndTime).getTime() : 0;
        return bt - at;
      });
    const lastDecided = decided[0];
    const daysSinceLast = lastDecided?.votingEndTime
      ? Math.floor((Date.now() - new Date(lastDecided.votingEndTime).getTime()) / 86_400_000)
      : null;
    return { passed, total, passRate, daysSinceLast };
  }, [proposals]);

  // Inflation impact in human terms.
  const inflation = useMemo(() => {
    if (!stakingData) return null;
    // annualProvisions is in TX/year; divide by 365 for per-day creation.
    const perDay = stakingData.annualProvisions / 365;
    const ratePct = stakingData.inflation;
    return { perDay, ratePct };
  }, [stakingData]);

  // PSE math: distributions remaining + average TX per remaining cycle.
  const pseMath = useMemo(() => {
    if (!cycle) return null;
    const remainingCycles = cycle.totalCycles - cycle.cycleNumber + 1;
    // Each distribution is the monthly emission from PSE_CONFIG. We don't
    // import it here to keep this component low-coupling; instead we use
    // a constant from the schedule API (~14.2M TX per distribution is the
    // current cadence). The actual per-cycle amount lives in pse-calculator.
    const perCycleApproxTX = 14_200_000;
    return {
      remainingCycles,
      perCycleApproxTX,
      yearsLeft: Math.round((remainingCycles / 12) * 10) / 10,
    };
  }, [cycle]);

  // ── API-dependent signals ──────────────────────────────────────────

  // Staking flow over the last 24h. /api/staking-feed returns a stream
  // of delegate/undelegate/redelegate events; we sum the delegate vs
  // undelegate flows from the last 24h to get a net signal.
  const flow = useStakingFlowSignal();
  const whale = useWhaleSignal();

  return (
    <section className="today-section">
      <div className="today-section-label">Today&apos;s signals</div>
      <div className="ts-list">
        {decentralization && (
          <SignalRow
            icon="🏦"
            href="/validators"
            headline={
              <>
                Top {decentralization.top10Count} validators control{" "}
                <strong>{decentralization.pct.toFixed(0)}%</strong> of voting power
              </>
            }
            sub={
              <>
                Minimum coalition to decide votes:{" "}
                <strong>{decentralization.coalition} validators</strong>
              </>
            }
            cta="Compare validators →"
          />
        )}
        {flow && (
          <SignalRow
            icon="⚡"
            href="/flows"
            tone={flow.net >= 0 ? "ok" : "warn"}
            headline={
              <>
                <strong>{flow.net >= 0 ? "+" : ""}{formatTX(flow.net)} TX</strong>{" "}
                net staked over the last 24h
              </>
            }
            sub={
              <>
                {formatTX(flow.delegated)} delegated · {formatTX(flow.undelegated)} unbonded
              </>
            }
            cta="See flows →"
          />
        )}
        {whale && (
          <SignalRow
            icon="🌊"
            href="/flows"
            headline={
              <>
                <strong>{whale.bigMoveCount}</strong> moves greater than 1M TX in the last 24h
              </>
            }
            sub={whale.largest
              ? <>Largest: <strong>{formatTX(whale.largest.amount)} TX</strong> {whale.largest.type}</>
              : <>Watch where the big stake is going.</>}
            cta="Whale tracker →"
          />
        )}
        {governance && (
          <SignalRow
            icon="📊"
            href="/governance"
            headline={
              <>
                <strong>{governance.passRate.toFixed(0)}%</strong> governance pass rate
                ({governance.passed} of {governance.total} proposals)
              </>
            }
            sub={governance.daysSinceLast !== null
              ? <>Last decided <strong>{governance.daysSinceLast}d ago</strong></>
              : <>No proposals decided yet.</>}
            cta="Browse proposals →"
          />
        )}
        {pseMath && (
          <SignalRow
            icon="🎯"
            href="/pse"
            headline={
              <>
                PSE: <strong>{pseMath.remainingCycles}</strong> distributions left
              </>
            }
            sub={
              <>
                ~<strong>{formatTX(pseMath.perCycleApproxTX)} TX</strong> per cycle ·{" "}
                <strong>{pseMath.yearsLeft}y</strong> remaining
              </>
            }
            cta="PSE deep dive →"
          />
        )}
        {inflation && (
          <SignalRow
            icon="💰"
            href="/analytics"
            headline={
              <>
                Inflation adds <strong>~{formatTX(inflation.perDay)} TX</strong> per day
              </>
            }
            sub={
              <>
                <strong>{(inflation.ratePct * 100).toFixed(1)}%</strong> annual rate,
                decreasing over time
              </>
            }
            cta="Supply analytics →"
          />
        )}
      </div>
    </section>
  );
}

// ── Hooks for API-dependent signals ───────────────────────────────────

interface FlowSignal { delegated: number; undelegated: number; net: number }
function useStakingFlowSignal(): FlowSignal | null {
  const [data, setData] = useState<FlowSignal | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Newest-first, capped at 10k. The endpoint returns up to ~6 months
        // of events; we only need the last 24h for this signal.
        const res = await fetch("/api/staking-feed?limit=2000", { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        const cutoff = Date.now() - 24 * 3600 * 1000;
        type Ev = { type: string; timestamp: string; amount: string | number };
        const events = (json.events as Ev[] | undefined) ?? [];
        let delegated = 0;
        let undelegated = 0;
        for (const e of events) {
          const t = new Date(e.timestamp).getTime();
          if (t < cutoff) break; // events are newest-first, safe to break
          const amt = typeof e.amount === "string" ? Number(e.amount) : e.amount;
          if (!Number.isFinite(amt)) continue;
          if (e.type === "delegate") delegated += amt;
          else if (e.type === "undelegate") undelegated += amt;
          // redelegate is wash from a network-flow perspective; ignored
        }
        if (delegated === 0 && undelegated === 0) return; // nothing to show
        setData({ delegated, undelegated, net: delegated - undelegated });
      } catch {
        // silent fail - signal just doesn't render
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return data;
}

interface WhaleSignal {
  bigMoveCount: number;
  largest: { amount: number; type: string } | null;
}
function useWhaleSignal(): WhaleSignal | null {
  const [data, setData] = useState<WhaleSignal | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/staking-feed?limit=2000", { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        type Ev = { type: string; timestamp: string; amount: string | number };
        const events = (json.events as Ev[] | undefined) ?? [];
        const cutoff = Date.now() - 24 * 3600 * 1000;
        const bigMoveThreshold = 1_000_000;
        let bigCount = 0;
        let largest: { amount: number; type: string } | null = null;
        for (const e of events) {
          const t = new Date(e.timestamp).getTime();
          if (t < cutoff) break;
          const amt = typeof e.amount === "string" ? Number(e.amount) : e.amount;
          if (!Number.isFinite(amt)) continue;
          if (amt >= bigMoveThreshold) {
            bigCount++;
            if (!largest || amt > largest.amount) {
              largest = { amount: amt, type: e.type === "delegate" ? "delegated" : e.type === "undelegate" ? "unbonded" : "redelegated" };
            }
          }
        }
        if (bigCount === 0) return;
        setData({ bigMoveCount: bigCount, largest });
      } catch {
        // silent fail
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return data;
}

// ── Row primitive ─────────────────────────────────────────────────────

function SignalRow({
  icon, headline, sub, cta, href, tone,
}: {
  icon: string;
  headline: React.ReactNode;
  sub: React.ReactNode;
  cta?: string;
  href?: string;
  tone?: "ok" | "warn";
}) {
  const inner = (
    <>
      <span className="ts-icon" aria-hidden="true">{icon}</span>
      <div className="ts-body">
        <div className={`ts-headline ${tone ? `tone-${tone}` : ""}`}>{headline}</div>
        <div className="ts-sub">{sub}</div>
      </div>
      {cta && <span className="ts-cta">{cta}</span>}
    </>
  );
  if (href) {
    return <Link href={href} className="ts-row ts-row-link">{inner}</Link>;
  }
  return <div className="ts-row">{inner}</div>;
}

function formatTX(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}
