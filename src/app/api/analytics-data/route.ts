// GET /api/analytics-data
//
// Replaces the 7 per-metric JSON files plus pending-undelegations.json
// that useAnalyticsData used to fetch in parallel. The wide daily_metrics
// table holds all 7 columns on one row per UTC day, so a single SELECT
// builds every series and the client goes from ~8 round trips per poll
// to 1.
//
// Response shape:
//   {
//     datasets: {
//       "staking-apr":          [{ date, value }, ...],
//       "total-stake":          [...],
//       "active-addresses":     [...],
//       "transactions":         [...],
//       "staked-pct":           [...],
//       "total-supply":         [...],
//       "circulating-supply":   [...],
//       "price-usd":            [...]
//     },
//     pending: {
//       updatedAt: ISO string,
//       entries:  [{ date, value }, ...]   // unbonding schedule
//     }
//   }
//
// The keys under `datasets` match the existing DATASETS_META ids in
// useAnalyticsData so the hook only needs a URL swap, and price-usd
// is included so PriceChart can consume the same response.

import { NextResponse } from "next/server";
import { DailyMetric, PendingUndelegation } from "@/lib/db/models";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Map DATASETS_META id (exposed to the UI) to the daily_metrics column.
// Kept in the route rather than imported so we don't reach back into
// the client-side hook for a server-side concern.
const DATASET_COLUMN: Record<
  string,
  keyof Pick<
    DailyMetric,
    | "staking_apr"
    | "total_stake"
    | "active_addresses"
    | "transactions"
    | "staked_pct"
    | "total_supply"
    | "circulating_supply"
    | "price_usd"
  >
> = {
  "staking-apr": "staking_apr",
  "total-stake": "total_stake",
  "active-addresses": "active_addresses",
  transactions: "transactions",
  "staked-pct": "staked_pct",
  "total-supply": "total_supply",
  "circulating-supply": "circulating_supply",
  "price-usd": "price_usd",
};

type DataPoint = { date: string; value: number };

export async function GET() {
  try {
    const [metricRows, pendingRows] = await Promise.all([
      DailyMetric.findAll({
        order: [["date", "ASC"]],
        raw: true,
      }),
      PendingUndelegation.findAll({
        order: [["date", "ASC"]],
        raw: true,
      }),
    ]);

    // Pivot: one row per day with 8 numeric columns -> 8 per-dataset
    // arrays. We drop null cells (e.g. a day that was partially
    // collected) so chart components don't render gaps as zero.
    const datasets: Record<string, DataPoint[]> = {};
    for (const id of Object.keys(DATASET_COLUMN)) datasets[id] = [];

    for (const row of metricRows) {
      // DATEONLY columns come back as YYYY-MM-DD strings with this
      // Sequelize version; guard against unexpected Date objects so
      // the JSON timeseries always uses the short form the UI expects.
      const date =
        typeof row.date === "string"
          ? row.date
          : new Date(row.date as unknown as string).toISOString().slice(0, 10);

      for (const [id, column] of Object.entries(DATASET_COLUMN)) {
        const raw = row[column as keyof typeof row];
        if (raw == null) continue;
        // NUMERIC columns arrive as strings to preserve precision.
        // BIGINT columns (transactions, active_addresses) also come as
        // strings for values > 2^53; our values are well under that so
        // Number() is safe and matches what the JSON files stored.
        const value = Number(raw);
        if (!Number.isFinite(value)) continue;
        datasets[id].push({ date, value });
      }
    }

    // Pending undelegations: same shape as the old wrapped JSON.
    // updatedAt = most recent row's updated_at (snapshot timestamp).
    let pendingUpdatedAt: string | undefined;
    const pendingEntries: DataPoint[] = pendingRows.map((p) => {
      const d =
        typeof p.date === "string"
          ? p.date
          : new Date(p.date as unknown as string).toISOString().slice(0, 10);
      if (p.updated_at && (!pendingUpdatedAt || p.updated_at.toISOString() > pendingUpdatedAt)) {
        pendingUpdatedAt = p.updated_at.toISOString();
      }
      return { date: d, value: Number(p.value) };
    });

    return NextResponse.json(
      {
        datasets,
        pending: { updatedAt: pendingUpdatedAt, entries: pendingEntries },
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: message, at: new Date().toISOString() },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
