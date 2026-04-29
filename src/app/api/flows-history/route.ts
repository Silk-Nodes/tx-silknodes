// GET /api/flows-history?window=30d
//
// Per-day inflow/outflow rollup for the Flows tab chart. One row per UTC
// day in the window, with totals for inflow and outflow across all
// tracked exchange addresses combined.
//
// Response:
//   {
//     window: "24h" | "7d" | "30d" | "90d" | "all",
//     points: [
//       { date: "2026-04-12", inflow: 102345.6, outflow: 87654.3 },
//       ...
//     ],
//     updatedAt: ISO string
//   }
//
// Inflow/outflow are positive numbers in TX. Net is computed client-side
// (so the chart can stack inflow above zero and outflow below zero).
//
// 24h window resolution: still grouped per-UTC-day. With sub-day data
// the chart degenerates to one or two bars; that's expected and the
// per-exchange cards above the chart already cover the snapshot view.

import { NextResponse } from "next/server";
import { QueryTypes } from "sequelize";
import { sequelize } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const WINDOWS: Record<string, number | null> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d":  7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
  "all": null,
};

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const requested = url.searchParams.get("window") ?? "30d";
    const windowKey = (Object.prototype.hasOwnProperty.call(WINDOWS, requested)
      ? requested
      : "30d") as keyof typeof WINDOWS;
    const lookback = WINDOWS[windowKey];
    const sinceDate = lookback == null ? null : new Date(Date.now() - lookback);

    // Group by UTC date + direction. Casting timestamp to a UTC date
    // keeps days stable across the user's local time zone. Sequelize's
    // model-level group/raw API mixes badly with `literal()` in
    // TypeScript, so we drop to a raw query — simpler and safer for a
    // one-off aggregation.
    const rows = (await sequelize.query<{
      day: Date | string;
      direction: "inflow" | "outflow";
      total: string;
    }>(
      `
      SELECT (timestamp at time zone 'UTC')::date AS day,
             direction,
             COALESCE(SUM(amount), 0) AS total
      FROM exchange_flows
      ${sinceDate ? "WHERE timestamp >= :sinceDate" : ""}
      GROUP BY day, direction
      ORDER BY day ASC
      `,
      {
        type: QueryTypes.SELECT,
        replacements: sinceDate ? { sinceDate } : {},
      },
    )) as unknown as Array<{
      day: Date | string;
      direction: "inflow" | "outflow";
      total: string;
    }>;

    // Pivot rows -> one entry per day with both directions populated.
    const byDay = new Map<string, { inflow: number; outflow: number }>();
    for (const r of rows) {
      const day =
        typeof r.day === "string"
          ? r.day.slice(0, 10)
          : new Date(r.day).toISOString().slice(0, 10);
      const cur = byDay.get(day) ?? { inflow: 0, outflow: 0 };
      const amount = Number(r.total);
      if (r.direction === "inflow") cur.inflow = amount;
      else if (r.direction === "outflow") cur.outflow = amount;
      byDay.set(day, cur);
    }

    const points = Array.from(byDay.entries())
      .map(([date, v]) => ({ date, inflow: v.inflow, outflow: v.outflow }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json(
      { window: windowKey, points, updatedAt: new Date().toISOString() },
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

