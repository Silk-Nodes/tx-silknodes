"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { getPSEDistributionInfo } from "@/lib/pse-calculator";

// ~476.19M TX per month to community = ~0.184 TX per second
const TX_PER_SECOND = 476_190_476 / (30 * 24 * 3600);

export default function PSECountdown() {
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  const [distributed, setDistributed] = useState(0);
  const startTime = useRef(Date.now());

  // Memoize to avoid creating new Date objects every render
  const pseInfo = useMemo(() => getPSEDistributionInfo(), []);
  const targetMs = pseInfo.nextDistribution.getTime();

  // Cycle progress: how far into current 30-day period
  const cycleProgress = useMemo(() => {
    const now = new Date();
    const prevDistribution = new Date(pseInfo.nextDistribution);
    prevDistribution.setMonth(prevDistribution.getMonth() - 1);
    const cycleTotalMs = targetMs - prevDistribution.getTime();
    const cycleElapsedMs = now.getTime() - prevDistribution.getTime();
    return Math.min(100, Math.max(0, (cycleElapsedMs / cycleTotalMs) * 100));
  }, [targetMs, pseInfo.nextDistribution]);

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const diff = targetMs - now;
      if (diff > 0) {
        setTimeLeft({
          days: Math.floor(diff / (1000 * 60 * 60 * 24)),
          hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
          minutes: Math.floor((diff / (1000 * 60)) % 60),
          seconds: Math.floor((diff / 1000) % 60),
        });
      }
      // Live counter: TX distributed since page load
      const elapsed = (now - startTime.current) / 1000;
      setDistributed(elapsed * TX_PER_SECOND);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [targetMs]);

  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    <div className="cell area-pse pse-hero">
      <div className="cell-content" style={{ justifyContent: "space-between" }}>
        {/* Top row */}
        <div className="cell-header" style={{ marginBottom: 4 }}>
          <span className="pse-title">PROOF OF SUPPORT EMISSION</span>
          <span className="pse-dist-badge">
            <span className="dot orange animate-blink" />
            CYCLE #{pseInfo.currentCycle}
          </span>
        </div>

        {/* Live TX/sec — the alive signal */}
        <div style={{ marginBottom: 8 }}>
          <div style={{
            display: "flex", alignItems: "baseline", gap: 6,
            padding: "6px 10px",
            background: "rgba(164, 228, 0, 0.06)",
            borderRadius: 4,
            border: "1px solid rgba(164, 228, 0, 0.1)",
          }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: "rgba(255,255,255,0.35)", letterSpacing: "0.08em" }}>
              DISTRIBUTING
            </span>
            <span className="mono animate-pulse-glow" style={{ fontSize: 14, fontWeight: 700, color: "var(--accent)" }}>
              ~{TX_PER_SECOND.toFixed(2)} TX/sec
            </span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: "rgba(255,255,255,0.25)" }}>
              RIGHT NOW
            </span>
          </div>
          <div style={{ marginTop: 4, fontFamily: "var(--font-mono)", fontSize: 9, color: "rgba(255,255,255,0.3)" }}>
            +{distributed.toFixed(1)} TX distributed since you opened this page
          </div>
        </div>

        {/* Countdown */}
        <div>
          <span className="pse-subtitle">NEXT DISTRIBUTION</span>
          <div className="pse-countdown">
            <div className="pse-digit">
              <span className="pse-number">{pad(timeLeft.days)}</span>
              <span className="pse-unit">DAYS</span>
            </div>
            <span className="pse-separator">:</span>
            <div className="pse-digit">
              <span className="pse-number">{pad(timeLeft.hours)}</span>
              <span className="pse-unit">HRS</span>
            </div>
            <span className="pse-separator">:</span>
            <div className="pse-digit">
              <span className="pse-number">{pad(timeLeft.minutes)}</span>
              <span className="pse-unit">MIN</span>
            </div>
            <span className="pse-separator">:</span>
            <div className="pse-digit">
              <span className="pse-number">{pad(timeLeft.seconds)}</span>
              <span className="pse-unit">SEC</span>
            </div>
          </div>
        </div>

        {/* Cycle progress bar */}
        <div style={{ marginTop: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 7, color: "rgba(255,255,255,0.3)", letterSpacing: "0.1em" }}>
              CURRENT CYCLE PROGRESS
            </span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: "var(--accent)", fontWeight: 600 }}>
              {cycleProgress.toFixed(0)}%
            </span>
          </div>
          <div style={{ width: "100%", height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
            <div
              className="animate-pulse-glow"
              style={{
                width: `${cycleProgress}%`,
                height: "100%",
                background: "linear-gradient(90deg, var(--accent), #7ab800)",
                borderRadius: 2,
                transition: "width 1s ease",
                boxShadow: "0 0 8px rgba(164, 228, 0, 0.3)",
              }}
            />
          </div>
        </div>

        {/* Early advantage signal */}
        <div style={{ marginTop: 8, padding: "6px 10px", background: "rgba(255,255,255,0.03)", borderRadius: 4 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>
            <span style={{ color: "var(--accent)", fontWeight: 700 }}>You are early.</span>{" "}
            Cycle #{pseInfo.currentCycle} of 84. Most rewards go to long-term stakers — starting earlier compounds faster.
          </span>
        </div>
      </div>
    </div>
  );
}
