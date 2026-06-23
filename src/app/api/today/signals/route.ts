// GET /api/today/signals
//
// Powers the Today page signals grid. Returns 6 SQL-backed insights in
// one payload so the page makes a single HTTP call. Each signal is
// designed to drive a click to a deeper page (flows, analytics,
// validators) and not duplicate anything that already lives elsewhere
// on the Today page (governance + PSE are surfaced in the right rail
// already).
//
// Cache: 60s in-process. All queries are bounded by indexed time
// ranges so even a cache miss stays under ~150ms in normal load.
//
// Response:
//   {
//     updatedAt: ISO,
//     signals: {
//       exchangeFlow:    { netTx, inflowTx, outflowTx } | null
//       whaleMoves:      { count, largest } | null
//       newWhales:       { arrivals, exits, updatedAt } | null
//       unbondingWave:   { totalTx, peakDate, peakTx, days[] } | null
//       activeStakers:   { count24h, avg30d, deltaPct } | null
//       topValidator:    { moniker, operator, netTx, direction } | null
//     }
//   }

import { NextResponse } from "next/server";
import { QueryTypes } from "sequelize";
import { sequelize } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const CACHE_TTL_MS = 60_000;
const WHALE_MIN_TX = 1_000_000; // 1M TX = "whale move" threshold for this UI

type SignalsBody = {
  updatedAt: string;
  signals: {
    exchangeFlow: { netTx: number; inflowTx: number; outflowTx: number } | null;
    whaleMoves: {
      count: number;
      largest: {
        amountTx: number;
        type: "delegate" | "undelegate" | "redelegate";
        validator: string | null;
        moniker: string | null;
      } | null;
    } | null;
    newWhales: {
      arrivals: number;
      exits: number;
      updatedAt: string | null;
    } | null;
    unbondingWave: {
      totalTx: number;
      peakDate: string | null;
      peakTx: number;
      days: Array<{ date: string; tx: number }>;
    } | null;
    activeStakers: {
      count24h: number;
      avg30d: number;
      deltaPct: number; // signed % vs 30d avg
    } | null;
    topValidator: {
      moniker: string | null;
      operator: string;
      netTx: number;
      direction: "in" | "out";
    } | null;
  };
};

let cached: { at: number; body: SignalsBody } | null = null;

export async function GET() {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json(cached.body, { headers: { "x-cache": "HIT" } });
  }

  // Each query is wrapped in its own .catch so one missing table or
  // failed scan doesn't blank the entire grid. Render whatever lands.
  const [
    exchangeRows,
    whaleRows,
    whaleChangesRow,
    unbondingRows,
    activeRow,
    avgRow,
    topValRows,
  ] = await Promise.all([
    sequelize
      .query<{ direction: "inflow" | "outflow"; total: string }>(
        `SELECT direction, COALESCE(SUM(amount), 0)::text AS total
           FROM exchange_flows
          WHERE timestamp >= NOW() - INTERVAL '24 hours'
          GROUP BY direction`,
        { type: QueryTypes.SELECT },
      )
      .catch(() => [] as Array<{ direction: "inflow" | "outflow"; total: string }>),
    // Whale moves in last 24h: count + the biggest one with moniker.
    // LIMIT 1 of an indexed ORDER BY amount DESC scan over a 24h
    // window is cheap.
    sequelize
      .query<{
        type: "delegate" | "undelegate" | "redelegate";
        validator: string;
        amount: string;
        moniker: string | null;
        n: string;
      }>(
        `WITH whales AS (
           SELECT type, validator, amount
             FROM staking_events
            WHERE timestamp >= NOW() - INTERVAL '24 hours'
              AND amount >= ${WHALE_MIN_TX}
         )
         SELECT w.type, w.validator, w.amount::text AS amount,
                v.moniker,
                (SELECT COUNT(*)::text FROM whales) AS n
           FROM whales w
           LEFT JOIN validators v ON v.operator_address = w.validator
          ORDER BY w.amount DESC
          LIMIT 1`,
        { type: QueryTypes.SELECT },
      )
      .catch(() => [] as Array<{
        type: "delegate" | "undelegate" | "redelegate";
        validator: string;
        amount: string;
        moniker: string | null;
        n: string;
      }>),
    sequelize
      .query<{ arrivals: unknown; exits: unknown; updated_at: Date }>(
        `SELECT arrivals, exits, updated_at FROM whale_changes WHERE id = 1`,
        { type: QueryTypes.SELECT },
      )
      .catch(() => [] as Array<{ arrivals: unknown; exits: unknown; updated_at: Date }>),
    sequelize
      .query<{ date: string; value: string }>(
        `SELECT date::text, value::text
           FROM pending_undelegations
          WHERE date >= CURRENT_DATE
            AND date <  CURRENT_DATE + INTERVAL '7 days'
          ORDER BY date ASC`,
        { type: QueryTypes.SELECT },
      )
      .catch(() => [] as Array<{ date: string; value: string }>),
    sequelize
      .query<{ n: string }>(
        `SELECT COUNT(DISTINCT delegator)::text AS n
           FROM staking_events
          WHERE timestamp >= NOW() - INTERVAL '24 hours'`,
        { type: QueryTypes.SELECT },
      )
      .catch(() => [] as Array<{ n: string }>),
    // Avg distinct delegators per day over last 30 days. Excludes today
    // so we don't bias the comparison toward "in-progress" day.
    sequelize
      .query<{ avg: string }>(
        `SELECT COALESCE(AVG(daily), 0)::text AS avg
           FROM (
             SELECT DATE(timestamp) AS d, COUNT(DISTINCT delegator) AS daily
               FROM staking_events
              WHERE timestamp >= NOW() - INTERVAL '30 days'
                AND timestamp <  CURRENT_DATE
              GROUP BY DATE(timestamp)
           ) sub`,
        { type: QueryTypes.SELECT },
      )
      .catch(() => [] as Array<{ avg: string }>),
    // Top validator by absolute net stake change in 24h. ABS sort so a
    // big *outflow* qualifies as much as a big inflow - both are news.
    sequelize
      .query<{ operator: string; moniker: string | null; net: string }>(
        `SELECT se.validator AS operator,
                v.moniker,
                SUM(
                  CASE se.type
                    WHEN 'delegate'   THEN  se.amount
                    WHEN 'undelegate' THEN -se.amount
                    ELSE 0
                  END
                )::text AS net
           FROM staking_events se
           LEFT JOIN validators v ON v.operator_address = se.validator
          WHERE se.timestamp >= NOW() - INTERVAL '24 hours'
            AND se.type IN ('delegate','undelegate')
          GROUP BY se.validator, v.moniker
          ORDER BY ABS(SUM(
                  CASE se.type
                    WHEN 'delegate'   THEN  se.amount
                    WHEN 'undelegate' THEN -se.amount
                    ELSE 0
                  END
                )) DESC
          LIMIT 1`,
        { type: QueryTypes.SELECT },
      )
      .catch(() => [] as Array<{ operator: string; moniker: string | null; net: string }>),
  ]);

  // ── Shape each signal ──────────────────────────────────────────────
  const inflowTx = Number(
    exchangeRows.find((r) => r.direction === "inflow")?.total || 0,
  );
  const outflowTx = Number(
    exchangeRows.find((r) => r.direction === "outflow")?.total || 0,
  );
  const exchangeFlow = exchangeRows.length
    ? {
        // Net out-of-exchange (positive = accumulation, negative = distribution
        // toward exchanges, which usually precedes selling).
        netTx: outflowTx - inflowTx,
        inflowTx,
        outflowTx,
      }
    : null;

  const whaleTop = whaleRows[0];
  const whaleMoves = whaleTop
    ? {
        count: Number(whaleTop.n) || 0,
        largest: {
          amountTx: Number(whaleTop.amount) || 0,
          type: whaleTop.type,
          validator: whaleTop.validator,
          moniker: whaleTop.moniker,
        },
      }
    : { count: 0, largest: null };

  const wc = whaleChangesRow[0];
  const newWhales = wc
    ? {
        arrivals: Array.isArray(wc.arrivals) ? wc.arrivals.length : 0,
        exits: Array.isArray(wc.exits) ? wc.exits.length : 0,
        updatedAt: wc.updated_at ? new Date(wc.updated_at).toISOString() : null,
      }
    : null;

  const days = unbondingRows.map((r) => ({
    date: r.date,
    tx: Number(r.value) || 0,
  }));
  const totalTx = days.reduce((sum, d) => sum + d.tx, 0);
  const peak = days.reduce(
    (best, d) => (d.tx > best.tx ? d : best),
    { date: null as string | null, tx: 0 },
  );
  const unbondingWave = days.length
    ? { totalTx, peakDate: peak.date, peakTx: peak.tx, days }
    : null;

  const count24h = Number(activeRow[0]?.n || 0);
  const avg30d = Number(avgRow[0]?.avg || 0);
  const activeStakers =
    count24h > 0
      ? {
          count24h,
          avg30d,
          deltaPct: avg30d > 0 ? ((count24h - avg30d) / avg30d) * 100 : 0,
        }
      : null;

  const tv = topValRows[0];
  const topValidator = tv
    ? {
        moniker: tv.moniker,
        operator: tv.operator,
        netTx: Number(tv.net) || 0,
        direction: (Number(tv.net) || 0) >= 0 ? ("in" as const) : ("out" as const),
      }
    : null;

  const body: SignalsBody = {
    updatedAt: new Date().toISOString(),
    signals: {
      exchangeFlow,
      whaleMoves,
      newWhales,
      unbondingWave,
      activeStakers,
      topValidator,
    },
  };
  cached = { at: Date.now(), body };
  return NextResponse.json(body, { headers: { "x-cache": "MISS" } });
}
