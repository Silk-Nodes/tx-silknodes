// GET /api/pse-distributions
//
// One row per settled PSE community distribution: when it happened, how big
// the pool was, what TX was worth that day, and the change since the previous
// one. Requested by a holder who wanted to see the price at each distribution
// and compare cycles over time.
//
// Two sources joined server-side so every caller gets the same answer:
//
//   pse_distribution_allocation (Hasura)  cycle timing, pool size, the block
//                                         height range the payout landed in
//   daily_metrics.price_usd (our DB)      the daily close for that date
//
// The height range is returned because the wallet passport needs it: the
// per-address PSE endpoint reports each drop by block height, not by date, so
// matching a drop to its cycle (and therefore to a price) is a height lookup.

import { NextResponse } from "next/server";
import { Op } from "sequelize";
import { DailyMetric } from "@/lib/db/models";
import { withCache } from "@/lib/response-cache";

const ROUTE_TAG = "pse-distributions";
const HASURA_URL = "https://hasura.mainnet-1.coreum.dev/v1/graphql";

interface AllocationRow {
  scheduled_at: string | number;
  start_at_height: string | number;
  end_at_height: string | number;
  total_amount: string;
  total_score: string;
}

async function handler(req: Request) {
  try {
    const nowUnix = Math.floor(Date.now() / 1000);

    // Settled community distributions only. Future scheduled rows exist in the
    // same table and would show as cycles that have not happened yet.
    const res = await fetch(HASURA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `query D($now: bigint!) {
          pse_distribution_allocation(
            where: {
              allocation_type: { _eq: "pse_community" }
              scheduled_at: { _lte: $now }
            }
            order_by: { scheduled_at: asc }
          ) {
            scheduled_at
            start_at_height
            end_at_height
            total_amount
            total_score
          }
        }`,
        variables: { now: nowUnix },
      }),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`hasura HTTP ${res.status}`);
    const json = await res.json();
    if (json.errors) throw new Error(`hasura errors: ${JSON.stringify(json.errors)}`);

    const allocations: AllocationRow[] = json.data?.pse_distribution_allocation ?? [];
    if (allocations.length === 0) {
      return NextResponse.json({ distributions: [] });
    }

    // Price for each distribution date. One query for the whole span rather
    // than one per cycle.
    const dates = allocations.map((a) =>
      new Date(Number(a.scheduled_at) * 1000).toISOString().slice(0, 10),
    );
    // Price is an enrichment, so its failure must not take the cycles with it.
    // Without this the whole route 500s when the database is unreachable, and
    // the reader loses the distribution history too, which comes from Hasura
    // and was perfectly fine. A row with a missing price renders as "-"; a
    // failed request renders as nothing at all.
    const priceByDate = new Map<string, number>();
    try {
      const priceRows = await DailyMetric.findAll({
        where: { date: { [Op.in]: dates } },
        attributes: ["date", "price_usd"],
        raw: true,
      });
      for (const r of priceRows) {
        const d = typeof r.date === "string" ? r.date : String(r.date).slice(0, 10);
        const v = r.price_usd === null ? null : Number(r.price_usd);
        if (v !== null && Number.isFinite(v)) priceByDate.set(d, v);
      }
    } catch (err) {
      console.error(`[${ROUTE_TAG}] price lookup failed, trying the analytics series:`, err);
    }

    // Fallback to the analytics endpoint, which serves the same price_usd
    // column through its own cache. Worth having for its own sake: if the
    // database is briefly unreachable but that response is still warm, the
    // table keeps its prices instead of dropping to dashes. It is also what
    // makes this route testable locally, where there is no database but
    // /api/analytics-data is proxied to the live site.
    if (priceByDate.size === 0) {
      try {
        const origin = new URL(req.url).origin;
        const r = await fetch(`${origin}/api/analytics-data`, {
          headers: { "sec-fetch-site": "same-origin" },
          signal: AbortSignal.timeout(15000),
        });
        if (r.ok) {
          const series: { date: string; value: number }[] =
            (await r.json())?.datasets?.["price-usd"] ?? [];
          for (const pt of series) {
            if (dates.includes(pt.date) && Number.isFinite(pt.value)) {
              priceByDate.set(pt.date, pt.value);
            }
          }
        }
      } catch (err) {
        console.error(`[${ROUTE_TAG}] analytics price fallback failed:`, err);
      }
    }

    let previousPrice: number | null = null;
    const distributions = allocations.map((a, i) => {
      const scheduledAt = Number(a.scheduled_at);
      const date = new Date(scheduledAt * 1000).toISOString().slice(0, 10);
      const priceUsd = priceByDate.get(date) ?? null;
      // Change against the previous distribution that HAS a price, so one
      // missing day does not silently reframe the next row as a comparison
      // against something further back than it claims.
      const changePct =
        priceUsd !== null && previousPrice !== null && previousPrice > 0
          ? ((priceUsd - previousPrice) / previousPrice) * 100
          : null;
      if (priceUsd !== null) previousPrice = priceUsd;

      const poolTX = Number(a.total_amount || 0) / 1_000_000;
      return {
        cycle: i + 1,
        date,
        scheduledAt,
        poolTX,
        priceUsd,
        changePct,
        // Value of the whole pool at that day's price. The headline number
        // for "what was this distribution actually worth".
        poolUsd: priceUsd !== null ? poolTX * priceUsd : null,
        totalScore: a.total_score,
        startAtHeight: Number(a.start_at_height),
        endAtHeight: Number(a.end_at_height),
      };
    });

    return NextResponse.json({
      distributions,
      // Named so the UI can attribute it rather than presenting a price as our
      // own measurement. Everything here traces to one provider.
      priceSource: "CoinGecko daily close",
    });
  } catch (err) {
    console.error(`[${ROUTE_TAG}]`, err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

// Settled distributions never change and a new one lands monthly, so this can
// be cached hard.
export const GET = withCache("pse-distributions", 600, handler);
