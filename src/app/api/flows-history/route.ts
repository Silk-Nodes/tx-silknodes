// GET /api/flows-history?window=30d
//
// Per-day inflow/outflow rollup + the day's TX/USD price, for the Flows
// tab chart. One row per UTC day in the window.
//
// Response:
//   {
//     window: "24h" | "7d" | "30d" | "90d" | "all",
//     points: [
//       { date: "2026-04-12", inflow: 102345.6, outflow: 87654.3, price: 0.0091 },
//       ...
//     ],
//     updatedAt: ISO string
//   }
//
// Inflow/outflow are positive numbers in TX. Price is the daily snapshot
// from daily_metrics (null for days the metrics collector hasn't covered
// yet — the chart skips those points on the price line). Net flow is
// computed client-side so the chart can stack inflow above zero and
// outflow below zero with the price line on a secondary axis.
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

    // Two queries fan out in parallel: flows aggregation + price series
    // from daily_metrics. Merging client-side is simpler than a single
    // SQL with conditional aggregation, especially with the LEFT-OUTER
    // semantics required (price-only days, flow-only days both possible).
    const [rows, priceRows] = (await Promise.all([
      sequelize.query<{
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
      ),
      sequelize.query<{ date: Date | string; price_usd: string }>(
        `
        SELECT date, price_usd
        FROM daily_metrics
        WHERE price_usd IS NOT NULL
          ${sinceDate ? "AND date >= :sinceDate::date" : ""}
        `,
        {
          type: QueryTypes.SELECT,
          replacements: sinceDate ? { sinceDate } : {},
        },
      ),
    ])) as unknown as [
      Array<{ day: Date | string; direction: "inflow" | "outflow"; total: string }>,
      Array<{ date: Date | string; price_usd: string }>,
    ];

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

    // Build price lookup map. daily_metrics.date is a DATEONLY column
    // so it may surface as a JS Date or as a YYYY-MM-DD string depending
    // on the pg-types config; normalise both.
    const priceByDay = new Map<string, number>();
    for (const r of priceRows) {
      const day =
        typeof r.date === "string"
          ? r.date.slice(0, 10)
          : new Date(r.date).toISOString().slice(0, 10);
      const v = Number(r.price_usd);
      if (Number.isFinite(v)) priceByDay.set(day, v);
    }

    // daily_metrics.price_usd lags by 1–4 days because the metrics
    // collector backfills on its own cadence. That left the chart with
    // a stub price line covering only the first few days of each
    // window. Fall back to CoinGecko's daily market_chart for any day
    // that has flow data but is missing a price snapshot. Failures
    // are non-fatal — we just leave the price as null and the chart
    // skips the segment, matching the prior behaviour.
    const allDays = Array.from(byDay.keys());
    const missingDays = allDays.filter((d) => !priceByDay.has(d));
    if (missingDays.length > 0 && allDays.length > 0) {
      try {
        const earliest = allDays.reduce((a, b) => (a < b ? a : b));
        const earliestMs = new Date(earliest + "T00:00:00Z").getTime();
        const spanDays = Math.max(
          1,
          Math.ceil((Date.now() - earliestMs) / (24 * 60 * 60 * 1000)),
        );
        // CoinGecko returns `prices: [[ms, usd], ...]` — daily granularity
        // is enforced automatically when days >= 2 on the public endpoint.
        const cgUrl = `https://api.coingecko.com/api/v3/coins/tx/market_chart?vs_currency=usd&days=${Math.min(spanDays + 1, 365)}&interval=daily`;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4000);
        const res = await fetch(cgUrl, {
          signal: ctrl.signal,
          headers: { accept: "application/json" },
        });
        clearTimeout(timer);
        if (res.ok) {
          const cg = (await res.json()) as { prices?: Array<[number, number]> };
          for (const [ms, usd] of cg.prices ?? []) {
            const day = new Date(ms).toISOString().slice(0, 10);
            // Only fill gaps; never overwrite the canonical daily_metrics value.
            if (!priceByDay.has(day) && Number.isFinite(usd)) {
              priceByDay.set(day, usd);
            }
          }
        }
      } catch {
        // swallow — null prices on missing days is the prior contract.
      }
    }

    const points = Array.from(byDay.entries())
      .map(([date, v]) => ({
        date,
        inflow: v.inflow,
        outflow: v.outflow,
        price: priceByDay.get(date) ?? null,
      }))
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

