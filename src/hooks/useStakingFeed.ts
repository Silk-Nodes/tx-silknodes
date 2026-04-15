"use client";

import { useEffect, useState } from "react";
import type { StakingEvent, StakingEventsData } from "@/lib/staking-events";

const BASE_PATH = process.env.NODE_ENV === "production" ? "/tx-silknodes" : "";
const POLL_INTERVAL_MS = 60_000; // 60s: match the vm-service poll cadence
const TICK_INTERVAL_MS = 30_000; // 30s: refresh relative timestamps
// The collector pushes a heartbeat every 30 min even with no new events, so
// any updatedAt older than this means the collector is wedged or the deploy
// pipeline is broken. Threshold is 2x the heartbeat interval to absorb
// GitHub Pages rebuild lag without false positives.
const STALE_THRESHOLD_MS = 60 * 60_000; // 60 min

export function useStakingFeed() {
  const [events, setEvents] = useState<StakingEvent[]>([]);
  const [validators, setValidators] = useState<Record<string, string>>({});
  const [updatedAt, setUpdatedAt] = useState<string>("");
  const [now, setNow] = useState(() => Date.now());
  const [fetchError, setFetchError] = useState(false);

  // Tick for relative timestamps ("7m ago" → "8m ago")
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  // Fetch the live JSON and poll at runtime. Cache-bust with ?t= so
  // CDN/browser caches can't serve stale copies.
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch(`${BASE_PATH}/analytics/staking-events.json?t=${Date.now()}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as StakingEventsData;
        if (cancelled) return;
        setEvents(data.events || []);
        setValidators(data.validators || {});
        setUpdatedAt(data.updatedAt || "");
        setNow(Date.now());
        setFetchError(false);
      } catch {
        // Don't wipe existing data on a transient blip; just flag the error
        // so the UI can show a soft warning.
        if (!cancelled) setFetchError(true);
      }
    };

    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const updatedAtMs = updatedAt ? new Date(updatedAt).getTime() : 0;
  // Don't flag stale until we've actually loaded something. An empty initial
  // state shouldn't render a warning during the first fetch.
  const isStale = updatedAtMs > 0 && now - updatedAtMs > STALE_THRESHOLD_MS;

  return {
    events,
    validators,
    updatedAt,
    now,
    isStale,
    fetchError,
  };
}
