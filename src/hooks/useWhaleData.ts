"use client";

import { useEffect, useState } from "react";

// Phase 2.2: previously we fetched four separate JSON files
// (top-delegators, known-entities, whale-changes, whale-history) that
// the VM collector committed to the repo. All four are now served
// through a single /api/whale-data endpoint backed by Postgres via
// Sequelize — one round trip per poll instead of four. The wire
// shapes are preserved exactly so components consuming this hook
// need no changes.

const WHALE_DATA_URL = "/api/whale-data";
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

// Daily snapshot written by the VM (compact shape — no full label text
// because label metadata lives in top-delegators.json / known-entities.json
// and would balloon the history file).
export interface WhaleHistoryEntry {
  rank: number;
  address: string;
  totalStake: number;
  labelType: string | null;
}
export interface WhaleHistorySnapshot {
  date: string; // YYYY-MM-DD UTC
  entries: WhaleHistoryEntry[];
}
export interface WhaleHistoryPayload {
  updatedAt: string | null;
  snapshots: WhaleHistorySnapshot[]; // oldest first
}

interface WhaleDataResponse {
  topDelegators: TopDelegatorsPayload;
  knownEntities: { updatedAt?: string; entries?: Record<string, KnownEntityMeta> };
  whaleChanges: WhaleChangesPayload;
  whaleHistory: WhaleHistoryPayload;
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

const EMPTY_HISTORY: WhaleHistoryPayload = {
  updatedAt: null,
  snapshots: [],
};

export function useWhaleData() {
  const [topDelegators, setTopDelegators] = useState<TopDelegatorsPayload>({
    updatedAt: null,
    entries: [],
  });
  const [knownEntities, setKnownEntities] = useState<Record<string, KnownEntityMeta>>({});
  const [whaleChanges, setWhaleChanges] = useState<WhaleChangesPayload>(EMPTY_CHANGES);
  const [whaleHistory, setWhaleHistory] = useState<WhaleHistoryPayload>(EMPTY_HISTORY);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch(`${WHALE_DATA_URL}?t=${Date.now()}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as WhaleDataResponse;
        if (cancelled) return;
        setTopDelegators(data.topDelegators ?? { updatedAt: null, entries: [] });
        setKnownEntities(data.knownEntities?.entries ?? {});
        setWhaleChanges(data.whaleChanges ?? EMPTY_CHANGES);
        setWhaleHistory(data.whaleHistory ?? EMPTY_HISTORY);
      } catch {
        // Soft-fail: keep current state so a transient blip doesn't
        // wipe the UI. The 5 min poll will try again.
      }
    };

    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return { topDelegators, knownEntities, whaleChanges, whaleHistory };
}
