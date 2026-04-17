"use client";

import { useEffect, useState } from "react";

// The VM writes public/analytics/top-delegators.json every 6 h and
// public/analytics/known-entities.json alongside the same push cycle.
// The diff-between-refreshes lives in whale-changes.json (same cadence).
// Daily top-100 snapshots accumulate in whale-history.json (future trend UI).
// We fetch all of them at runtime so new VM pushes propagate to already-loaded
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

// Whale movement diff (computed on the VM by comparing the current
// top-delegators refresh against the previous one).
export interface WhaleArrival {
  address: string;
  rank: number;
  totalStake: number;
  label: TopDelegatorLabel | null;
}
export interface WhaleExit {
  address: string;
  lastRank: number;
  lastStake: number;
  label: TopDelegatorLabel | null;
}
export interface WhaleRankMover {
  address: string;
  label: TopDelegatorLabel | null;
  previousRank: number;
  currentRank: number;
  rankDelta: number; // positive = climbed (moved to a lower rank number)
  totalStake: number;
}
export interface WhaleStakeMover {
  address: string;
  label: TopDelegatorLabel | null;
  previousStake: number;
  currentStake: number;
  stakeDelta: number; // positive = added stake
  currentRank: number;
}

export interface WhaleChangesPayload {
  updatedAt: string | null;
  rankThreshold: number;
  stakeThresholdTX: number;
  arrivals: WhaleArrival[];
  exits: WhaleExit[];
  rankMovers: WhaleRankMover[];
  stakeMovers: WhaleStakeMover[];
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

const EMPTY_CHANGES: WhaleChangesPayload = {
  updatedAt: null,
  rankThreshold: 5,
  stakeThresholdTX: 500_000,
  arrivals: [],
  exits: [],
  rankMovers: [],
  stakeMovers: [],
};

export function useWhaleData() {
  const [topDelegators, setTopDelegators] = useState<TopDelegatorsPayload>({
    updatedAt: null,
    entries: [],
  });
  const [knownEntities, setKnownEntities] = useState<Record<string, KnownEntityMeta>>({});
  const [whaleChanges, setWhaleChanges] = useState<WhaleChangesPayload>(EMPTY_CHANGES);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const [td, ke, wc] = await Promise.all([
        safeFetchJson<TopDelegatorsPayload>("top-delegators.json", { updatedAt: null, entries: [] }),
        safeFetchJson<{ updatedAt?: string; entries?: Record<string, KnownEntityMeta> }>(
          "known-entities.json",
          { entries: {} },
        ),
        safeFetchJson<WhaleChangesPayload>("whale-changes.json", EMPTY_CHANGES),
      ]);
      if (cancelled) return;
      setTopDelegators(td);
      setKnownEntities(ke.entries || {});
      setWhaleChanges(wc);
    };

    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return { topDelegators, knownEntities, whaleChanges };
}
