"use client";

import { useEffect, useState } from "react";

// The VM writes public/analytics/top-delegators.json every 6 h and
// public/analytics/known-entities.json alongside the same push cycle.
// We fetch both at runtime so new VM pushes propagate to already-loaded
// browser tabs within the poll window without a hard refresh.

const BASE_PATH = process.env.NODE_ENV === "production" ? "/tx-silknodes" : "";
const POLL_INTERVAL_MS = 5 * 60_000; // 5 min

export interface TopDelegatorLabel {
  text: string;
  type: string;
  verified: boolean;
}

export interface TopDelegatorEntry {
  rank: number;
  address: string;
  totalStake: number; // in TX (not ucore — VM already converts)
  validatorCount: number;
  label: TopDelegatorLabel | null;
}

export interface TopDelegatorsPayload {
  updatedAt: string | null;
  entries: TopDelegatorEntry[];
}

export interface KnownEntityMeta {
  label: string;
  type: string;
  verified: boolean;
  source?: string;
}

async function safeFetchJson<T>(filename: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${BASE_PATH}/analytics/${filename}?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

export function useWhaleData() {
  const [topDelegators, setTopDelegators] = useState<TopDelegatorsPayload>({
    updatedAt: null,
    entries: [],
  });
  const [knownEntities, setKnownEntities] = useState<Record<string, KnownEntityMeta>>({});

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const [td, ke] = await Promise.all([
        safeFetchJson<TopDelegatorsPayload>("top-delegators.json", { updatedAt: null, entries: [] }),
        safeFetchJson<{ updatedAt?: string; entries?: Record<string, KnownEntityMeta> }>(
          "known-entities.json",
          { entries: {} },
        ),
      ]);
      if (cancelled) return;
      setTopDelegators(td);
      setKnownEntities(ke.entries || {});
    };

    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return { topDelegators, knownEntities };
}
