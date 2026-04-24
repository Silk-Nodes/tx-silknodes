"use client";

import { useEffect, useMemo, useState } from "react";
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

// All per-day analytics series are fetched at runtime from public/analytics/
// instead of being statically imported. Static imports bake the data into the
// JS bundle at build time, which means any data update requires both a Pages
// rebuild AND a browser hard-refresh. Runtime fetch with a short poll keeps
// all already-loaded tabs in sync with the VM's daily pushes automatically.

// Phase 2: app served from its own origin; no more /tx-silknodes/ path
// prefix. Left as a constant so call sites don't need to change if a
// future reverse-proxy pathing requirement shows up.
const BASE_PATH = "";
const POLL_INTERVAL_MS = 5 * 60_000; // 5 min

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

interface DatasetMeta {
  id: string;
  label: string;
  file: string;
  unit: "TX" | "%" | "";
  chartType: "area" | "line";
  color: string;
}

const DATASETS_META: DatasetMeta[] = [
  { id: "staking-apr", label: "Staking APR", file: "staking-apr.json", unit: "%", chartType: "line", color: "#FFB078" },
  { id: "total-stake", label: "Total Staked", file: "total-stake.json", unit: "TX", chartType: "area", color: "#4a7a1a" },
  { id: "active-addresses", label: "Active Addresses", file: "active-addresses.json", unit: "", chartType: "line", color: "#4a7a1a" },
  { id: "transactions", label: "Transactions", file: "transactions.json", unit: "", chartType: "line", color: "#B1FC03" },
  { id: "staked-pct", label: "Staked Ratio", file: "staked-pct.json", unit: "%", chartType: "area", color: "#4a7a1a" },
  { id: "total-supply", label: "Total Supply", file: "total-supply.json", unit: "TX", chartType: "area", color: "#9a8a7a" },
  { id: "circulating-supply", label: "Circulating Supply", file: "circulating-supply.json", unit: "TX", chartType: "area", color: "#4a7a1a" },
];
function formatValue(value: number, unit: "TX" | "%" | ""): string {
  if (unit === "%") return formatPct(value);
  if (unit === "TX") return formatLargeNumber(value);
  return formatLargeNumber(value, 0);
}

async function fetchAnalyticsFile(filename: string): Promise<DataPoint[]> {
  try {
    const res = await fetch(`${BASE_PATH}/analytics/${filename}?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
    return (await res.json()) as DataPoint[];
  } catch {
    return [];
  }
}

// pending-undelegations.json uses a wrapped schema: { updatedAt, entries }
// The updatedAt field lets the external monitor treat it like a live
// snapshot. Legacy shape (bare array) is still accepted during rollout.
interface PendingUndelegationsPayload {
  updatedAt?: string;
  entries: DataPoint[];
}

async function fetchPendingUndelegationsFile(): Promise<PendingUndelegationsPayload> {
  try {
    const res = await fetch(`${BASE_PATH}/analytics/pending-undelegations.json?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!res.ok) return { entries: [] };
    const raw = await res.json();
    if (Array.isArray(raw)) return { entries: raw as DataPoint[] };
    return {
      updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : undefined,
      entries: Array.isArray(raw?.entries) ? (raw.entries as DataPoint[]) : [],
    };
  } catch {
    return { entries: [] };
  }
}

function todayUTC(): string {
  return new Date().toISOString().split("T")[0];
}

export function useAnalyticsData(globalRange: TimeRange) {
  // State keyed by dataset id. Starts empty; gets populated on first fetch.
  const [rawByDataset, setRawByDataset] = useState<Record<string, DataPoint[]>>({});
  const [pendingPayload, setPendingPayload] = useState<PendingUndelegationsPayload>({ entries: [] });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const datasetEntries = await Promise.all(
        DATASETS_META.map(async (ds) => {
          const data = await fetchAnalyticsFile(ds.file);
          return [ds.id, data] as const;
        }),
      );
      const pending = await fetchPendingUndelegationsFile();

      if (cancelled) return;
      setRawByDataset(Object.fromEntries(datasetEntries));
      setPendingPayload(pending);
    };

    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const datasets = useMemo<DatasetConfig[]>(() => {
    return DATASETS_META.map((ds) => {
      const raw = txEraOnly(rawByDataset[ds.id] || []);
      const filtered = filterByTimeRange(raw, globalRange);
      const data = globalRange === "ALL" ? downsample(filtered) : filtered;
      const latestRaw = getLatestValue(raw);
      const change = calcChange(filtered);
      const health = getHealthStatus(ds.id, change, latestRaw);
      const healthContext = getHealthContext(ds.id, change, latestRaw);
      const explanation = getExplanation(ds.id);

      return {
        id: ds.id,
        label: ds.label,
        fullData: raw,
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
  }, [rawByDataset, globalRange]);

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
    // Client-side defense: never render entries whose completion day is in
    // the past. The VM refreshes every 15 min, but within that window a
    // freshly-completed entry could still be in the file. This filter
    // makes stale data visually invisible regardless of server lag.
    const today = todayUTC();
    const data = txEraOnly(pendingPayload.entries).filter((d) => d.date >= today);
    const total = data.reduce((sum, d) => sum + d.value, 0);
    return {
      data,
      total,
      formatted: formatLargeNumber(total),
      updatedAt: pendingPayload.updatedAt,
    };
  }, [pendingPayload]);

  return {
    datasets,
    insightNarrative,
    todaySignals,
    strategySuggestions,
    pendingUndelegations,
  };
}
