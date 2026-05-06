"use client";

import { useState, useEffect, useRef } from "react";
import type { TimeRange } from "@/lib/analytics-utils";
import { formatLargeNumber } from "@/lib/analytics-utils";
import { useAnalyticsData } from "@/hooks/useAnalyticsData";
import { useTokenData } from "@/hooks/useTokenData";
import TimeRangeSelector from "./analytics/TimeRangeSelector";
import StatCard from "./analytics/StatCard";
import AnalyticsChart from "./analytics/AnalyticsChart";
import PriceChart from "./analytics/PriceChart";
import StakingFeed from "./analytics/StakingFeed";
import SpikeChart from "./analytics/SpikeChart";

export default function AnalyticsTab() {
  const [globalRange, setGlobalRange] = useState<TimeRange>("1Y");
  const {
    datasets,
    pendingUndelegations,
  } = useAnalyticsData(globalRange);

  // Sticky time range
  const pillsRef = useRef<HTMLDivElement>(null);
  const [isSticky, setIsSticky] = useState(false);

  useEffect(() => {
    const el = pillsRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsSticky(!entry.isIntersecting),
      { threshold: 0, rootMargin: "-60px 0px 0px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const getDs = (id: string) => datasets.find((d) => d.id === id)!;

  const stakingApr = getDs("staking-apr");
  const totalStake = getDs("total-stake");
  const activeAddresses = getDs("active-addresses");
  const transactions = getDs("transactions");
  const stakedPct = getDs("staked-pct");
  const totalSupply = getDs("total-supply");
  const circulatingSupply = getDs("circulating-supply");

  // Live chain overlay for headline numbers. The daily collector
  // writes daily_metrics at 02:00 UTC, so without this overlay the
  // "Total Staked" and "Circulating Supply" cards stay up to ~24h
  // behind reality. Especially visible right after a PSE distribution
  // when bonded tokens jump by hundreds of millions overnight (cycle
  // 2 added ~420M, page was stuck on the pre-cycle value).
  // The historical chart still uses daily_metrics for trend points;
  // only the latestValue label gets overridden.
  const { tokenData, stakingData } = useTokenData();
  const liveBonded = stakingData?.bondedTokens ?? null;
  const liveCirculating = tokenData?.circulatingSupply ?? null;
  const liveTotalSupply = tokenData?.totalSupply ?? null;
  const liveStakedPct =
    liveBonded != null && liveCirculating != null && liveCirculating > 0
      ? (liveBonded / liveCirculating) * 100
      : null;
  // Base APR uses the same formula as fetchStakingData (and the
  // Validators page): annualProvisions * (1 - communityTax) / bonded.
  // Reading the live computed value off stakingData keeps the Analytics
  // headline in lockstep with whatever Validators page shows.
  const liveApr =
    stakingData?.apr != null && Number.isFinite(stakingData.apr)
      ? stakingData.apr
      : null;

  const overlayLatest = (
    ds: typeof totalStake,
    liveValue: number | null,
    unit: "TX" | "%" | "" = ds.unit,
  ) => {
    if (liveValue == null || !Number.isFinite(liveValue)) return ds;
    return {
      ...ds,
      latestRaw: liveValue,
      latestValue:
        unit === "%"
          ? `${liveValue.toFixed(1)}%`
          : `${formatLargeNumber(liveValue)} ${unit}`.trim(),
    };
  };

  const totalStakeLive = overlayLatest(totalStake, liveBonded);
  const circulatingSupplyLive = overlayLatest(circulatingSupply, liveCirculating);
  const totalSupplyLive = overlayLatest(totalSupply, liveTotalSupply);
  const stakedPctLive = overlayLatest(stakedPct, liveStakedPct, "%");
  const stakingAprLive = overlayLatest(stakingApr, liveApr, "%");

  return (
    <div className="analytics-tab">
      {/* ═══ STICKY TIME RANGE (appears on scroll) ═══ */}
      {isSticky && (
        <div className="sticky-pills-bar">
          <TimeRangeSelector value={globalRange} onChange={setGlobalRange} />
        </div>
      )}

      {/* ═══ HEADER ═══ */}
      <div className="section-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
        <div>
          <h1 className="page-title">
            TX Network Pulse
            <span className="live-dot" />
          </h1>
          <span className="section-sub" style={{ fontSize: "0.8rem", opacity: 0.6 }}>
            What's happening, what changed, what to do
          </span>
        </div>
        <div ref={pillsRef}>
          <TimeRangeSelector value={globalRange} onChange={setGlobalRange} />
        </div>
      </div>

      {/* ═══ SIGNAL CARDS ═══ */}
      <div className="stat-grid">
        <StatCard
          label={stakingAprLive.label}
          value={stakingAprLive.latestValue}
          change={stakingAprLive.change}
          health={stakingAprLive.health}
          healthContext={stakingAprLive.healthContext}
          explanation={stakingAprLive.explanation}
          variant="olive"
        />
        <StatCard
          label={totalStakeLive.label}
          value={totalStakeLive.latestValue}
          change={totalStakeLive.change}
          health={totalStakeLive.health}
          healthContext={totalStakeLive.healthContext}
          explanation={totalStakeLive.explanation}
          variant="olive"
        />
        <StatCard
          label={activeAddresses.label}
          value={activeAddresses.latestValue}
          change={activeAddresses.change}
          health={activeAddresses.health}
          healthContext={activeAddresses.healthContext}
          explanation={activeAddresses.explanation}
          variant="olive"
        />
        <StatCard
          label={transactions.label}
          value={transactions.latestValue}
          change={transactions.change}
          health={transactions.health}
          healthContext={transactions.healthContext}
          explanation={transactions.explanation}
        />
        <StatCard
          label={stakedPctLive.label}
          value={stakedPctLive.latestValue}
          change={stakedPctLive.change}
          health={stakedPctLive.health}
          healthContext={stakedPctLive.healthContext}
          explanation={stakedPctLive.explanation}
        />
        <StatCard
          label={totalSupplyLive.label}
          value={totalSupplyLive.latestValue}
          change={totalSupplyLive.change}
          health={totalSupplyLive.health}
          healthContext={totalSupplyLive.healthContext}
          explanation={totalSupplyLive.explanation}
        />
      </div>

      {/* ═══ HERO CHART: TX Price (most important) ═══ */}
      <PriceChart />

      {/* ═══ STAKING ACTIVITY FEED ═══ */}
      <StakingFeed />

      {/* ═══ SECONDARY: Staking APR + Total Staked ═══ */}
      <div className="chart-grid-2">
        <AnalyticsChart
          title={stakingApr.label}
          data={stakingApr.data}
          color={stakingApr.color}
          unit={stakingApr.unit}
          globalRange={globalRange}
          size="medium"
        />
        <AnalyticsChart
          title={totalStake.label}
          data={totalStake.data}
          color={totalStake.color}
          unit={totalStake.unit}
          globalRange={globalRange}
          size="medium"
        />
      </div>

      {/* ═══ TERTIARY: Transactions, Addresses, Staked Ratio ═══ */}
      <div className="chart-grid-3">
        <AnalyticsChart
          title={transactions.label}
          data={transactions.data}
          color={transactions.color}
          unit={transactions.unit}
          globalRange={globalRange}
          size="small"
        />
        <AnalyticsChart
          title={activeAddresses.label}
          data={activeAddresses.data}
          color={activeAddresses.color}
          unit={activeAddresses.unit}
          globalRange={globalRange}
          size="small"
        />
        <AnalyticsChart
          title={stakedPct.label}
          data={stakedPct.data}
          color={stakedPct.color}
          unit={stakedPct.unit}
          globalRange={globalRange}
          size="small"
        />
      </div>

      {/* ═══ BOTTOM: Circulating Supply + Undelegation Spikes ═══ */}
      <div className="chart-grid-2">
        {circulatingSupply.data.length >= 2 ? (
          <AnalyticsChart
            title={circulatingSupply.label}
            data={circulatingSupply.data}
            color={circulatingSupply.color}
            unit={circulatingSupply.unit}
            globalRange={globalRange}
            size="small"
          />
        ) : (
          <div className="chart-card-v2 chart-card-small chart-card-placeholder">
            <div className="chart-card-v2-header">
              <span className="chart-card-v2-title">{circulatingSupplyLive.label}</span>
              <span className="chart-card-v2-badge badge-neutral">{circulatingSupplyLive.latestValue}</span>
            </div>
            <div className="chart-placeholder-msg">
              Chart populating as daily data builds
            </div>
          </div>
        )}
        <SpikeChart
          title="Pending Undelegations"
          data={pendingUndelegations.data}
          total={pendingUndelegations.formatted}
        />
      </div>
    </div>
  );
}
