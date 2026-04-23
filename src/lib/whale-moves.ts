// Client-side computation of "Whales on the Move" diffs over arbitrary time
// windows. The VM only precomputes the 6 h diff (whale-changes.json); for
// longer windows (24 H / 3 D / 7 D / 30 D / 90 D) we pick the historical
// snapshot from whale-history.json closest to the requested lookback and
// diff it against the current top-delegators list in the browser. This keeps
// the backend simple — it just writes one daily snapshot — while letting
// the UI surface any window the user picks.

import type {
  TopDelegatorEntry,
  TopDelegatorLabel,
  WhaleArrival,
  WhaleChangesPayload,
  WhaleExit,
  WhaleHistoryPayload,
  WhaleHistorySnapshot,
  WhaleRankMover,
  WhaleStakeMover,
} from "@/hooks/useWhaleData";

/** User-facing window options. "6h" is special-cased to use whale-changes.json. */
export type WhaleWindow = "6h" | "24h" | "3d" | "7d" | "30d" | "90d";

export const WINDOW_ORDER: WhaleWindow[] = ["6h", "24h", "3d", "7d", "30d", "90d"];
export const WINDOW_LABELS: Record<WhaleWindow, string> = {
  "6h": "6H",
  "24h": "24H",
  "3d": "3D",
  "7d": "7D",
  "30d": "30D",
  "90d": "90D",
};

/** How far back (in days) each window looks. 6h is ~0.25 but we never pick a
 *  snapshot for it — it uses the prebuilt whale-changes.json instead. */
const WINDOW_LOOKBACK_DAYS: Record<WhaleWindow, number> = {
  "6h": 0.25,
  "24h": 1,
  "3d": 3,
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

/** Matches the threshold the VM uses when writing whale-changes.json (5 ranks).
 *  Kept inline rather than imported from the hook to avoid a circular dep. */
const RANK_MOVER_THRESHOLD = 5;
/** 500 K TX — matches the VM's stake-mover threshold. */
const STAKE_MOVER_THRESHOLD = 500_000;

/** Pick the snapshot whose date is closest to (but not newer than) `now - lookbackDays`.
 *  Returns null if no snapshot is old enough. We require the snapshot to be at
 *  least 50% of the requested window old so "7 D" isn't silently satisfied by
 *  a 2-day-old snapshot when nothing else exists. */
export function findSnapshotForWindow(
  history: WhaleHistoryPayload,
  lookbackDays: number,
  nowMs: number = Date.now(),
): { snapshot: WhaleHistorySnapshot; actualAgeDays: number } | null {
  if (!history.snapshots.length) return null;

  const targetMs = nowMs - lookbackDays * 24 * 60 * 60 * 1000;
  const minAcceptableAgeMs = lookbackDays * 0.5 * 24 * 60 * 60 * 1000;
  // Snapshots are written at the START of each UTC day; their effective
  // timestamp is 00:00Z of that date. We compare against that.
  const snapshotMs = (s: WhaleHistorySnapshot) =>
    new Date(s.date + "T00:00:00Z").getTime();

  // Filter to snapshots old enough to honor the window, pick the one closest
  // to the target (smallest |snapshotMs - targetMs|).
  let best: { snapshot: WhaleHistorySnapshot; distance: number } | null = null;
  for (const s of history.snapshots) {
    const age = nowMs - snapshotMs(s);
    if (age < minAcceptableAgeMs) continue;
    const distance = Math.abs(snapshotMs(s) - targetMs);
    if (!best || distance < best.distance) best = { snapshot: s, distance };
  }
  if (!best) return null;

  return {
    snapshot: best.snapshot,
    actualAgeDays: (nowMs - snapshotMs(best.snapshot)) / (24 * 60 * 60 * 1000),
  };
}

/** Synthesize a label for an address using the current top-delegators entry if
 *  present, else null. The compact history snapshot only carries `labelType`
 *  and no display text, so a full badge requires the current entry's label.
 *  For exits (addresses no longer in top-500), label is null — the UI already
 *  handles that. */
function labelForAddress(
  address: string,
  currentByAddress: Map<string, TopDelegatorEntry>,
): TopDelegatorLabel | null {
  return currentByAddress.get(address)?.label ?? null;
}

/** Compute arrivals/exits/rank-movers/stake-movers between a historical
 *  snapshot and the current top-delegators list. Output shape matches
 *  WhaleChangesPayload so the existing "Whales on the Move" UI can render it
 *  without modification.
 *
 *  Direction convention:
 *    - rankDelta > 0 ⇒ climbed (moved to a lower rank number)
 *    - stakeDelta > 0 ⇒ added stake */
export function computeMovesForWindow(
  current: TopDelegatorEntry[],
  snapshot: WhaleHistorySnapshot,
  referenceDate: string,
): WhaleChangesPayload {
  const currentByAddr = new Map(current.map((e) => [e.address, e]));
  const snapshotByAddr = new Map(snapshot.entries.map((e) => [e.address, e]));

  const arrivals: WhaleArrival[] = [];
  const exits: WhaleExit[] = [];
  const rankMovers: WhaleRankMover[] = [];
  const stakeMovers: WhaleStakeMover[] = [];

  // Pass 1: iterate current list. Each entry is either a holdover (present in
  // snapshot → candidate for rank/stake mover) or an arrival (absent).
  for (const entry of current) {
    const prev = snapshotByAddr.get(entry.address);
    if (!prev) {
      arrivals.push({
        address: entry.address,
        rank: entry.rank,
        totalStake: entry.totalStake,
        label: entry.label,
      });
      continue;
    }
    const rankDelta = prev.rank - entry.rank; // positive = climbed
    if (Math.abs(rankDelta) >= RANK_MOVER_THRESHOLD) {
      rankMovers.push({
        address: entry.address,
        label: entry.label,
        previousRank: prev.rank,
        currentRank: entry.rank,
        rankDelta,
        totalStake: entry.totalStake,
      });
    }
    const stakeDelta = entry.totalStake - prev.totalStake;
    if (Math.abs(stakeDelta) >= STAKE_MOVER_THRESHOLD) {
      stakeMovers.push({
        address: entry.address,
        label: entry.label,
        previousStake: prev.totalStake,
        currentStake: entry.totalStake,
        stakeDelta,
        currentRank: entry.rank,
      });
    }
  }

  // Pass 2: exits — anyone in the snapshot no longer present in current.
  for (const prev of snapshot.entries) {
    if (currentByAddr.has(prev.address)) continue;
    exits.push({
      address: prev.address,
      lastRank: prev.rank,
      lastStake: prev.totalStake,
      // The compact snapshot lacks a full label (no text/verified). We try
      // the current list (won't match since they're not in it by definition)
      // and fall back to null; the UI renders truncateAddress in that case.
      label: labelForAddress(prev.address, currentByAddr),
    });
  }

  // Sort by magnitude so the "top 5 per list" slice the UI already does
  // surfaces the most interesting rows.
  rankMovers.sort((a, b) => Math.abs(b.rankDelta) - Math.abs(a.rankDelta));
  stakeMovers.sort((a, b) => Math.abs(b.stakeDelta) - Math.abs(a.stakeDelta));
  arrivals.sort((a, b) => a.rank - b.rank);
  exits.sort((a, b) => a.lastRank - b.lastRank);

  return {
    updatedAt: referenceDate,
    rankThreshold: RANK_MOVER_THRESHOLD,
    stakeThresholdTX: STAKE_MOVER_THRESHOLD,
    arrivals,
    exits,
    rankMovers,
    stakeMovers,
  };
}

/** Return the target lookback (days) for a given window. Useful for showing
 *  "insufficient history" UI when no snapshot satisfies the window. */
export function windowLookbackDays(w: WhaleWindow): number {
  return WINDOW_LOOKBACK_DAYS[w];
}
