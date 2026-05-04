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

    // Three queries fan out in parallel: aggregated flow per day,
    // per-exchange flow per day (for the heatmap), and the daily
    // price series. Merging client-side is simpler than one SQL
    // pivot, and PG handles the GROUP BY cheaply on the (timestamp,
    // exchange_address) index.
    const [rows, perExchangeRows, priceRows, exchanges] = (await Promise.all([
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
      sequelize.query<{
        day: Date | string;
        exchange_address: string;
        direction: "inflow" | "outflow";
        total: string;
      }>(
        `
        SELECT (timestamp at time zone 'UTC')::date AS day,
               exchange_address,
               direction,
               COALESCE(SUM(amount), 0) AS total
        FROM exchange_flows
        ${sinceDate ? "WHERE timestamp >= :sinceDate" : ""}
        GROUP BY day, exchange_address, direction
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
      sequelize.query<{ address: string; exchange_name: string }>(
        `SELECT address, exchange_name FROM exchange_addresses ORDER BY exchange_name ASC`,
        { type: QueryTypes.SELECT },
      ),
    ])) as unknown as [
      Array<{ day: Date | string; direction: "inflow" | "outflow"; total: string }>,
      Array<{
        day: Date | string;
        exchange_address: string;
        direction: "inflow" | "outflow";
        total: string;
      }>,
      Array<{ date: Date | string; price_usd: string }>,
      Array<{ address: string; exchange_name: string }>,
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

    // daily_metrics.price_usd is populated by an external collector
    // and lags the freshest exchange_flows rows by 1 to 4 days. That
    // would leave the price line stubbed at the start of each window
    // (e.g. a 7D view ending today shows the price line stopping
    // around day 3). Fall back to CoinGecko's market_chart for any
    // windowed day that has flow data but no daily_metrics price.
    //
    // NOTE: do NOT pass `interval=daily` here. CoinGecko restricted
    // that parameter to paid plans, so on the free tier it returns
    // 401 and the entire fallback silently fails. Without the param
    // the free tier auto granularity returns hourly points for
    // 2 to 90 day windows; we collapse those to one price per day
    // by keeping the first hourly value seen, which is good enough
    // for the chart line.
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
        const cgUrl = `https://api.coingecko.com/api/v3/coins/tx/market_chart?vs_currency=usd&days=${Math.min(spanDays + 1, 365)}`;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        const res = await fetch(cgUrl, {
          signal: ctrl.signal,
          headers: { accept: "application/json" },
        });
        clearTimeout(timer);
        if (res.ok) {
          const cg = (await res.json()) as { prices?: Array<[number, number]> };
          let filled = 0;
          for (const [ms, usd] of cg.prices ?? []) {
            const day = new Date(ms).toISOString().slice(0, 10);
            // Only fill gaps; never overwrite the canonical daily_metrics value.
            if (!priceByDay.has(day) && Number.isFinite(usd)) {
              priceByDay.set(day, usd);
              filled++;
            }
          }
          console.log(
            `[flows-history] CG fallback filled ${filled} day(s) for ${missingDays.length} missing`,
          );
        } else {
          console.warn(
            `[flows-history] CG fallback HTTP ${res.status} on ${cgUrl}`,
          );
        }
      } catch (e) {
        console.warn(
          `[flows-history] CG fallback failed: ${e instanceof Error ? e.message : e}`,
        );
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

    // Build the per-exchange daily heatmap matrix. Each cell carries
    // the net flow (inflow - outflow) for that exchange on that day,
    // so the client can colour positive (red, accumulation) and
    // negative (green, releasing) without re-aggregating.
    const exchangeMeta = exchanges.map((e) => ({
      address: e.address,
      name: e.exchange_name,
    }));
    const heatmapByKey = new Map<string, { inflow: number; outflow: number }>();
    for (const r of perExchangeRows) {
      const day =
        typeof r.day === "string"
          ? r.day.slice(0, 10)
          : new Date(r.day).toISOString().slice(0, 10);
      const key = `${day}|${r.exchange_address}`;
      const cur = heatmapByKey.get(key) ?? { inflow: 0, outflow: 0 };
      const amount = Number(r.total);
      if (r.direction === "inflow") cur.inflow = amount;
      else if (r.direction === "outflow") cur.outflow = amount;
      heatmapByKey.set(key, cur);
    }
    const heatmap = points.map((p) => ({
      date: p.date,
      cells: exchangeMeta.map((e) => {
        const v = heatmapByKey.get(`${p.date}|${e.address}`) ?? {
          inflow: 0,
          outflow: 0,
        };
        return {
          address: e.address,
          inflow: v.inflow,
          outflow: v.outflow,
          net: v.inflow - v.outflow,
        };
      }),
    }));

    return NextResponse.json(
      {
        window: windowKey,
        points,
        exchanges: exchangeMeta,
        heatmap,
        updatedAt: new Date().toISOString(),
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

