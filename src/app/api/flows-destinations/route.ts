// GET /api/flows-destinations?window=24h
//
// Classifies every outflow (TX leaving an exchange) by where it went:
//   staked          counterparty has a delegate event within 7 d after
//                   the outflow — likely going to staking
//   other_exchange  counterparty is itself a tracked exchange wallet
//   private         everything else (cold storage, regular wallets, etc.)
//
// Response shape:
//   {
//     window: "24h" | ...,
//     totalOutflow: number,
//     buckets: [
//       { category: "staked",         amount, txCount, pct },
//       { category: "other_exchange", amount, txCount, pct },
//       { category: "private",        amount, txCount, pct },
//     ],
//     updatedAt
//   }
//
// pct is the share of totalOutflow that bucket represents (0..100).
//
// Query strategy: classify each outflow with EXISTS subqueries against
// exchange_addresses and staking_events, group by the resulting
// category. EXISTS avoids JOIN duplication when a counterparty has
// many delegate events. Indexed on staking_events(delegator,
// timestamp) so the lookup is fast.

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

// Lookahead window for "did this counterparty stake?". 7 days lets us
// catch typical "withdraw → wait a couple days → stake" patterns
// without diluting the bucket with unrelated stake events much later.
const STAKE_LOOKAHEAD_DAYS = 7;

type Category = "staked" | "other_exchange" | "private";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const requested = url.searchParams.get("window") ?? "24h";
    const windowKey = (Object.prototype.hasOwnProperty.call(WINDOWS, requested)
      ? requested
      : "24h") as keyof typeof WINDOWS;
    const lookback = WINDOWS[windowKey];
    const sinceDate = lookback == null ? null : new Date(Date.now() - lookback);

    const sql = `
      WITH classified AS (
        SELECT
          ef.amount,
          CASE
            WHEN EXISTS (
              SELECT 1 FROM exchange_addresses ea WHERE ea.address = ef.counterparty
            ) THEN 'other_exchange'
            WHEN EXISTS (
              SELECT 1 FROM staking_events se
              WHERE se.delegator = ef.counterparty
                AND se.type = 'delegate'
                AND se.timestamp >= ef.timestamp
                AND se.timestamp <= ef.timestamp + (INTERVAL '1 day' * :lookahead)
            ) THEN 'staked'
            ELSE 'private'
          END AS category
        FROM exchange_flows ef
        WHERE ef.direction = 'outflow'
          ${sinceDate ? "AND ef.timestamp >= :sinceDate" : ""}
      )
      SELECT
        category,
        SUM(amount) AS total_amount,
        COUNT(*)   AS tx_count
      FROM classified
      GROUP BY category;
    `;

    const rows = (await sequelize.query<{
      category: Category;
      total_amount: string;
      tx_count: string;
    }>(sql, {
      type: QueryTypes.SELECT,
      replacements: {
        lookahead: STAKE_LOOKAHEAD_DAYS,
        ...(sinceDate ? { sinceDate } : {}),
      },
    })) as unknown as Array<{
      category: Category;
      total_amount: string;
      tx_count: string;
    }>;

    // Initialise a row for every category so the UI can render all
    // three even when a category had zero activity in this window.
    const totals: Record<Category, { amount: number; txCount: number }> = {
      staked:         { amount: 0, txCount: 0 },
      other_exchange: { amount: 0, txCount: 0 },
      private:        { amount: 0, txCount: 0 },
    };
    for (const r of rows) {
      totals[r.category] = {
        amount: Number(r.total_amount),
        txCount: Number(r.tx_count),
      };
    }
    const totalOutflow =
      totals.staked.amount + totals.other_exchange.amount + totals.private.amount;

    const buckets = (["staked", "other_exchange", "private"] as Category[]).map(
      (c) => ({
        category: c,
        amount: totals[c].amount,
        txCount: totals[c].txCount,
        pct: totalOutflow > 0 ? (totals[c].amount / totalOutflow) * 100 : 0,
      }),
    );

    return NextResponse.json(
      {
        window: windowKey,
        totalOutflow,
        buckets,
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
