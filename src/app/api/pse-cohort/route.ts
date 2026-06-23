// GET /api/pse-cohort
//
// Powers the "What recipients do with PSE" section on the PSE page.
// Returns the latest snapshot for every (cycle, cohort_top_n) pair from
// pse_cohort_snapshots - the daily collector (silknodes-pse-cohort)
// writes these during each cycle's 7-day post-distribution window and
// freezes the final one once window_complete flips true.
//
// The section reads "did recipients keep their PSE staked or sell it",
// so we surface the three TX splits as percentages of what was received:
//   keptStakedPct  - bonded the auto-staked reward and held it
//   unbondedPct    - unbonded within the window (sell intent)
//   leftWalletPct  - of the unbonded, how much actually left the wallet
//
// leftWalletPct ≤ unbondedPct always (it's a subset). On this chain the
// two track ~1:1 because nobody unbonds and then sits liquid.
//
// Cache: 60s in-process. Data only changes once a day, so this is
// generous but keeps the page snappy.

import { NextResponse } from "next/server";
import { QueryTypes } from "sequelize";
import { sequelize } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const CACHE_TTL_MS = 60_000;

type Row = {
  cycle: number;
  cohort_top_n: number;
  measured_at: Date;
  window_days_covered: string;
  window_complete: boolean;
  cohort_size: number;
  received_tx: string;
  kept_bonded_tx: string;
  unbonded_tx: string;
  exited_wallet_tx: string;
};

type CohortPoint = {
  cycle: number;
  cohortTopN: number;
  windowComplete: boolean;
  windowDaysCovered: number;
  cohortSize: number;
  receivedTx: number;
  keptStakedPct: number;
  unbondedPct: number;
  leftWalletPct: number;
};

type Body = {
  updatedAt: string;
  cohortSizes: number[];
  points: CohortPoint[];
};

let cached: { at: number; body: Body } | null = null;

export async function GET() {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json(cached.body, { headers: { "x-cache": "HIT" } });
  }

  let rows: Row[] = [];
  try {
    rows = await sequelize.query<Row>(
      `SELECT DISTINCT ON (cycle, cohort_top_n)
              cycle, cohort_top_n, measured_at, window_days_covered,
              window_complete, cohort_size,
              received_tx, kept_bonded_tx, unbonded_tx, exited_wallet_tx
         FROM pse_cohort_snapshots
        ORDER BY cycle, cohort_top_n, measured_at DESC`,
      { type: QueryTypes.SELECT },
    );
  } catch (err) {
    console.warn(
      `[pse-cohort] query failed: ${err instanceof Error ? err.message : err}`,
    );
    rows = [];
  }

  const points: CohortPoint[] = rows.map((r) => {
    const received = Number(r.received_tx) || 0;
    const pct = (v: string) =>
      received > 0 ? (Number(v) / received) * 100 : 0;
    return {
      cycle: Number(r.cycle),
      cohortTopN: Number(r.cohort_top_n),
      windowComplete: r.window_complete,
      windowDaysCovered: Number(r.window_days_covered) || 0,
      cohortSize: Number(r.cohort_size) || 0,
      receivedTx: received,
      keptStakedPct: round1(pct(r.kept_bonded_tx)),
      unbondedPct: round1(pct(r.unbonded_tx)),
      leftWalletPct: round1(pct(r.exited_wallet_tx)),
    };
  });

  const cohortSizes = [...new Set(points.map((p) => p.cohortTopN))].sort(
    (a, b) => a - b,
  );

  const body: Body = {
    updatedAt: new Date().toISOString(),
    cohortSizes,
    points,
  };
  cached = { at: Date.now(), body };
  return NextResponse.json(body, { headers: { "x-cache": "MISS" } });
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
