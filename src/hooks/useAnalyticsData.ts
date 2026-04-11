import { useMemo } from "react";
import type { DataPoint, TimeRange } from "@/lib/analytics-utils";
import {
  filterByTimeRange,
  formatLargeNumber,
  formatPct,
  getLatestValue,
  calcChange,
  downsample,
} from "@/lib/analytics-utils";
import {
  getHealthStatus,
  getHealthContext,
  getExplanation,
  generateInsightNarrative,
  generateTodaySignals,
  generateStrategySuggestions,
  type HealthStatus,
  type TodaySignal,
  type StrategySuggestion,
} from "@/lib/analytics-insights";

import activeAddressesRaw from "@/data/analytics/active-addresses.json";
import transactionsRaw from "@/data/analytics/transactions.json";
import totalStakeRaw from "@/data/analytics/total-stake.json";
import stakedPctRaw from "@/data/analytics/staked-pct.json";
import stakingAprRaw from "@/data/analytics/staking-apr.json";
import totalSupplyRaw from "@/data/analytics/total-supply.json";
import circulatingSupplyRaw from "@/data/analytics/circulating-supply.json";
import pendingUndelegationsRaw from "@/data/analytics/pending-undelegations.json";

// TX era starts March 6, 2026 (Coreum + Solo merge into TX)
const TX_ERA_START = "2026-03-06";
function txEraOnly(data: DataPoint[]): DataPoint[] {
  return data.filter((d) => d.date >= TX_ERA_START);
}

export interface DatasetConfig {
  id: string;
  label: string;
  fullData: DataPoint[];
  data: DataPoint[];
  unit: "TX" | "%" | "";
  chartType: "area" | "line";
  color: string;
  latestValue: string;
  latestRaw: number;
  change: number | null;
  health: HealthStatus;
  healthContext: string;
  explanation: string;
}

const DATASETS: {
  id: string;
  label: string;
  raw: DataPoint[];
  unit: "TX" | "%" | "";
  chartType: "area" | "line";
  color: string;
}[] = [
  { id: "staking-apr", label: "Staking APR", raw: txEraOnly(stakingAprRaw as DataPoint[]), unit: "%", chartType: "line", color: "#FFB078" },
  { id: "total-stake", label: "Total Staked", raw: txEraOnly(totalStakeRaw as DataPoint[]), unit: "TX", chartType: "area", color: "#4a7a1a" },
  { id: "active-addresses", label: "Active Addresses", raw: txEraOnly(activeAddressesRaw as DataPoint[]), unit: "", chartType: "line", color: "#4a7a1a" },
  { id: "transactions", label: "Transactions", raw: txEraOnly(transactionsRaw as DataPoint[]), unit: "", chartType: "line", color: "#B1FC03" },
  { id: "staked-pct", label: "Staked Ratio", raw: txEraOnly(stakedPctRaw as DataPoint[]), unit: "%", chartType: "area", color: "#4a7a1a" },
  { id: "total-supply", label: "Total Supply", raw: txEraOnly(totalSupplyRaw as DataPoint[]), unit: "TX", chartType: "area", color: "#9a8a7a" },
  { id: "circulating-supply", label: "Circulating Supply", raw: txEraOnly(circulatingSupplyRaw as DataPoint[]), unit: "TX", chartType: "area", color: "#4a7a1a" },
];

function formatValue(value: number, unit: "TX" | "%" | ""): string {
  if (unit === "%") return formatPct(value);
  if (unit === "TX") return formatLargeNumber(value);
  return formatLargeNumber(value, 0);
}

export function useAnalyticsData(globalRange: TimeRange) {
  const datasets = useMemo<DatasetConfig[]>(() => {
    return DATASETS.map((ds) => {
      const filtered = filterByTimeRange(ds.raw, globalRange);
      const data = globalRange === "ALL" ? downsample(filtered) : filtered;
      const latestRaw = getLatestValue(ds.raw);
      const change = calcChange(filtered);
      const health = getHealthStatus(ds.id, change, latestRaw);
      const healthContext = getHealthContext(ds.id, change, latestRaw);
      const explanation = getExplanation(ds.id);

      return {
        id: ds.id,
        label: ds.label,
        fullData: ds.raw,
        data,
        unit: ds.unit,
        chartType: ds.chartType,
        color: ds.color,
        latestValue: formatValue(latestRaw, ds.unit),
        latestRaw,
        change,
        health,
        healthContext,
        explanation,
      };
    });
  }, [globalRange]);

  const insightNarrative = useMemo(() => {
    const summaries = datasets.map((d) => ({
      id: d.id,
      label: d.label,
      change: d.change,
      value: d.latestRaw,
      health: d.health,
    }));
    return generateInsightNarrative(summaries);
  }, [datasets]);

  const todaySignals = useMemo(() => {
    const summaries = datasets.map((d) => ({
      id: d.id,
      label: d.label,
      change: d.change,
      value: d.latestRaw,
      health: d.health,
    }));
    return generateTodaySignals(summaries);
  }, [datasets]);

  const strategySuggestions = useMemo(() => {
    const summaries = datasets.map((d) => ({
      id: d.id,
      label: d.label,
      change: d.change,
      value: d.latestRaw,
      health: d.health,
    }));
    return generateStrategySuggestions(summaries);
  }, [datasets]);

  const pendingUndelegations = useMemo(() => {
    const data = txEraOnly(pendingUndelegationsRaw as DataPoint[]);
    const total = data.reduce((sum, d) => sum + d.value, 0);
    return {
      data,
      total,
      formatted: formatLargeNumber(total),
    };
  }, []);

  return {
    datasets,
    insightNarrative,
    todaySignals,
    strategySuggestions,
    pendingUndelegations,
  };
}
