// GET /api/flows-private-destinations?window=24h&limit=20
//
// Returns the top N counterparties classified as "private" by the
// destinations endpoint, with total amount and tx count, so the team
// can audit them and add the recognisable ones (other CEX hot wallets,
// bridges, DEXes, etc.) to known_entities. Each entry that gets a
// label moves volume out of the "private" bucket and into a more
// specific destination type.
//
// Response:
//   {
//     window: "24h" | ...,
//     limit: number,
//     destinations: [
//       {
//         address, totalAmount, txCount,
//         label: string | null,    // current known_entities.label if any
//         type:  string | null     // current known_entities.type if any
//       },
//       ...
//     ],
//     updatedAt
//   }
//
// We intentionally include addresses that ARE already labelled in
// known_entities but still got bucketed as "private" — those are
// labelled but with a type like "individual" that doesn't move them
// to a different bucket, so they're still useful to surface for
// re-classification.

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

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
// Minimum total TX (per counterparty across the window) for the row
// to qualify. Addresses moving 5K or 10K aren't useful for the audit
// workflow — those are just regular wallets, not exchange/bridge
// hot wallets that the team needs to label. Defaults to 1M; override
// with ?min= for analyst exploration.
const DEFAULT_MIN_AMOUNT = 1_000_000;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const requested = url.searchParams.get("window") ?? "24h";
    const windowKey = (Object.prototype.hasOwnProperty.call(WINDOWS, requested)
      ? requested
      : "24h") as keyof typeof WINDOWS;
    const lookback = WINDOWS[windowKey];
    const sinceDate = lookback == null ? null : new Date(Date.now() - lookback);
    const limitParam = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
    const limit =
      Number.isFinite(limitParam) && limitParam > 0
        ? Math.min(Math.floor(limitParam), MAX_LIMIT)
        : DEFAULT_LIMIT;
    const minParam = Number(url.searchParams.get("min") ?? DEFAULT_MIN_AMOUNT);
    const minAmount =
      Number.isFinite(minParam) && minParam >= 0 ? minParam : DEFAULT_MIN_AMOUNT;

    // Pull the top counterparties whose category would be "private"
    // under the same logic as flows-destinations:
    //   not in exchange_addresses, not in top_delegators, not in
    //   staking_events as a delegate. LEFT JOIN known_entities so we
    //   surface any existing label/type the team might want to update.
    const sql = `
      WITH outflows AS (
        SELECT counterparty, amount
        FROM exchange_flows
        WHERE direction = 'outflow'
          ${sinceDate ? "AND timestamp >= :sinceDate" : ""}
      ),
      private_only AS (
        SELECT o.counterparty, o.amount
        FROM outflows o
        WHERE NOT EXISTS (
          SELECT 1 FROM exchange_addresses ea WHERE ea.address = o.counterparty
        )
        AND NOT EXISTS (
          SELECT 1 FROM top_delegators td WHERE td.address = o.counterparty
        )
        AND NOT EXISTS (
          SELECT 1 FROM staking_events se
          WHERE se.delegator = o.counterparty
            AND se.type = 'delegate'
        )
      ),
      grouped AS (
        SELECT counterparty,
               SUM(amount) AS total_amount,
               COUNT(*)    AS tx_count
        FROM private_only
        GROUP BY counterparty
        HAVING SUM(amount) >= :minAmount
      ),
      ranked AS (
        SELECT *
        FROM grouped
        ORDER BY total_amount DESC
        LIMIT :limit
      )
      SELECT r.counterparty,
             r.total_amount,
             r.tx_count,
             ke.label,
             ke.type
      FROM ranked r
      LEFT JOIN known_entities ke ON ke.address = r.counterparty
      ORDER BY r.total_amount DESC;
    `;

    const rows = (await sequelize.query<{
      counterparty: string;
      total_amount: string;
      tx_count: string;
      label: string | null;
      type: string | null;
    }>(sql, {
      type: QueryTypes.SELECT,
      replacements: {
        limit,
        minAmount,
        ...(sinceDate ? { sinceDate } : {}),
      },
    })) as unknown as Array<{
      counterparty: string;
      total_amount: string;
      tx_count: string;
      label: string | null;
      type: string | null;
    }>;

    // Pending submission counts per address. Fetched in a separate
    // query and swallowed if the entity_submissions table doesn't
    // exist yet (migration 005 not run). The audit panel still
    // works, the "Pending review" badge just won't show until
    // migrations are caught up.
    const pendingByAddress = new Map<string, number>();
    if (rows.length > 0) {
      try {
        const addresses = rows.map((r) => r.counterparty);
        const pendingRows = (await sequelize.query<{
          address: string;
          pending_count: string;
        }>(
          `SELECT address, COUNT(*)::text AS pending_count
           FROM entity_submissions
           WHERE status = 'pending'
             AND address IN (:addresses)
           GROUP BY address`,
          {
            type: QueryTypes.SELECT,
            replacements: { addresses },
          },
        )) as unknown as Array<{ address: string; pending_count: string }>;
        for (const r of pendingRows) {
          pendingByAddress.set(r.address, Number(r.pending_count));
        }
      } catch (e) {
        console.warn(
          `[flows-private-destinations] pending count query failed (run migration 005?): ${e instanceof Error ? e.message : e}`,
        );
      }
    }

    return NextResponse.json(
      {
        window: windowKey,
        limit,
        minAmount,
        destinations: rows.map((r) => ({
          address: r.counterparty,
          totalAmount: Number(r.total_amount),
          txCount: Number(r.tx_count),
          label: r.label,
          type: r.type,
          pendingCount: pendingByAddress.get(r.counterparty) ?? 0,
        })),
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
