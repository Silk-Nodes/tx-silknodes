"use client";

import { useEffect, useState } from "react";
import type { StakingEvent, StakingEventsData } from "@/lib/staking-events";

const BASE_PATH = process.env.NODE_ENV === "production" ? "/tx-silknodes" : "";
const POLL_INTERVAL_MS = 60_000; // 60s: match the vm-service poll cadence
const TICK_INTERVAL_MS = 30_000; // 30s: refresh relative timestamps

export function useStakingFeed() {
  const [events, setEvents] = useState<StakingEvent[]>([]);
  const [validators, setValidators] = useState<Record<string, string>>({});
  const [updatedAt, setUpdatedAt] = useState<string>("");
  const [now, setNow] = useState(() => Date.now());

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
        if (!res.ok) return;
        const data = (await res.json()) as StakingEventsData;
        if (cancelled) return;
        setEvents(data.events || []);
        setValidators(data.validators || {});
        setUpdatedAt(data.updatedAt || "");
        setNow(Date.now());
      } catch {
        // network blip, try again next tick
      }
    };

    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return {
    events,
    validators,
    updatedAt,
    now,
  };
}
