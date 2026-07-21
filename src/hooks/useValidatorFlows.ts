"use client";

import { useEffect, useState } from "react";

// Per-validator stake flow over a rolling window, from /api/validator-flows.
// Powers the "30d Flow" column on the Validators page so delegators can see
// which validators are gaining stake and which are bleeding it.
//
// Polls on the same 60s cadence as useStakingFeed: the underlying
// staking_events table is written by the same VM collector, so a faster
// refresh would just re-read identical rows.

const FLOWS_URL = "/api/validator-flows";
const POLL_INTERVAL_MS = 60_000;

export interface ValidatorFlow {
  moniker: string;
  delegatedIn: number;
  redelegatedIn: number;
  undelegatedOut: number;
  redelegatedOut: number;
  net: number;
}

interface FlowsResponse {
  updatedAt: string;
  days: number;
  flows: Record<string, ValidatorFlow>;
}

export function useValidatorFlows(days = 30) {
  const [flows, setFlows] = useState<Record<string, ValidatorFlow>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch(`${FLOWS_URL}?days=${days}&t=${Date.now()}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as FlowsResponse;
        if (cancelled) return;
        setFlows(data.flows || {});
      } catch {
        // Leave whatever we already have on a transient blip. The column
        // renders a dash for missing validators, so a failed load degrades
        // to "no flow data" rather than breaking the table.
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [days]);

  return { flows, loading };
}
