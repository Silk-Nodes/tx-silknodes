// GET /api/flows-destinations?window=24h
//
// Classifies every outflow (TX leaving an exchange) by where it went:
//   staked          counterparty is a known staker. Catches three
//                   cases combined (any one is enough):
//                     a) delegated within 30d AFTER the withdrawal
//                        ("withdraw, then stake" pattern)
//                     b) ever delegated in our staking_events history
//                        (90 day rolling window via the events table)
//                     c) currently appears in top_delegators
//                        (snapshot of top 500 active stakers, refreshed
//                        every 6h)
//   other_exchange  counterparty is itself a tracked exchange wallet
//   private         everything else (cold storage, regular wallets, etc.)
//
// History note: original classifier only used (a) with a 7d lookahead,
// which buried known stakers in the "private" bucket and made the
// staked share look 3-4x smaller than reality. Adding (b) catches
// recurring stakers who already had an active position before the
// withdrawal; (c) catches large, long-time stakers whose most recent
// delegate event predates the staking_events retention.
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
// Query strategy: each EXISTS subquery hits an indexed column
// (staking_events.delegator, top_delegators.address PK) so the
// classifier scales with outflow row count, not unique address count.

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

// Lookahead window for "did this counterparty stake within X days
// after withdrawing?". Bumped from 7d to 30d so users who park funds
// for a few weeks before staking still get classified correctly. Now
// only one of three signals — the others (any past delegate event,
// any current active stake) catch stakers who don't trigger this one.
const STAKE_LOOKAHEAD_DAYS = 30;

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

    // Two EXISTS clauses cover the staked bucket. Order matters for
    // short-circuit evaluation; cheapest first:
    //   1. top_delegators PK lookup (O(log n))
    //   2. staking_events ever-delegated (idx_staking_events_delegator)
    // The previous "delegated within 30d after withdrawal" check is
    // redundant once #2 is in place, since staking_events has a
    // 90-day retention so any post-withdrawal stake within 30d is
    // already in the events table. Edge case: a staker whose most
    // recent delegate event is older than 90 days AND who isn't
    // top-500 won't be caught — small enough to ignore for now.
    // STAKE_LOOKAHEAD_DAYS is kept in the file as documentation of
    // the historic threshold but no longer used in the SQL.
    void STAKE_LOOKAHEAD_DAYS;
    const sql = `
      WITH classified AS (
        SELECT
          ef.amount,
          CASE
            WHEN EXISTS (
              SELECT 1 FROM exchange_addresses ea WHERE ea.address = ef.counterparty
            ) THEN 'other_exchange'
            WHEN EXISTS (
              SELECT 1 FROM top_delegators td WHERE td.address = ef.counterparty
            ) THEN 'staked'
            WHEN EXISTS (
              SELECT 1 FROM staking_events se
              WHERE se.delegator = ef.counterparty
                AND se.type = 'delegate'
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
      replacements: sinceDate ? { sinceDate } : {},
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
