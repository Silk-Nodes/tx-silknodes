// GET /api/flows-counterparties?window=24h&limit=10
//
// Top counterparties by aggregate volume in the selected window:
//   depositors  = top N addresses by total INFLOW they generated to
//                 exchanges (i.e. addresses sending TX into exchanges)
//   withdrawers = top N addresses by total OUTFLOW they received from
//                 exchanges (i.e. addresses pulling TX out of exchanges)
//
// Each row is enriched with the counterparty's known_entities label
// (when available) and top_delegators rank (when in the top 500), so
// the UI can show "Whale #47 — Coinbase Cold Wallet" without an extra
// round-trip.
//
// Response:
//   {
//     window,
//     depositors:  [ { address, label, rank, totalAmount, txCount }, ... ],
//     withdrawers: [ ... ],
//     updatedAt
//   }

import { NextResponse } from "next/server";
import { Op } from "sequelize";
import { QueryTypes } from "sequelize";
import { sequelize } from "@/lib/db";
import { KnownEntity, TopDelegator } from "@/lib/db/models";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const WINDOWS: Record<string, number | null> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d":  7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
  "all": null,
};

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const requested = url.searchParams.get("window") ?? "24h";
    const windowKey = (Object.prototype.hasOwnProperty.call(WINDOWS, requested)
      ? requested
      : "24h") as keyof typeof WINDOWS;
    const lookback = WINDOWS[windowKey];
    const sinceDate = lookback == null ? null : new Date(Date.now() - lookback);

    const rawLimit = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
        : DEFAULT_LIMIT;

    // Two queries — one for each direction. Each groups by counterparty
    // and orders by total amount so we get the top N efficiently.
    const buildSql = (direction: "inflow" | "outflow") => `
      SELECT
        counterparty,
        SUM(amount)::numeric AS total_amount,
        COUNT(*)::int        AS tx_count
      FROM exchange_flows
      WHERE direction = :direction
        ${sinceDate ? "AND timestamp >= :sinceDate" : ""}
      GROUP BY counterparty
      ORDER BY total_amount DESC
      LIMIT :limit
    `;

    const [depositorRows, withdrawerRows] = (await Promise.all([
      sequelize.query<{
        counterparty: string;
        total_amount: string;
        tx_count: number;
      }>(buildSql("inflow"), {
        type: QueryTypes.SELECT,
        replacements: {
          direction: "inflow",
          limit,
          ...(sinceDate ? { sinceDate } : {}),
        },
      }),
      sequelize.query<{
        counterparty: string;
        total_amount: string;
        tx_count: number;
      }>(buildSql("outflow"), {
        type: QueryTypes.SELECT,
        replacements: {
          direction: "outflow",
          limit,
          ...(sinceDate ? { sinceDate } : {}),
        },
      }),
    ])) as unknown as [
      Array<{ counterparty: string; total_amount: string; tx_count: number }>,
      Array<{ counterparty: string; total_amount: string; tx_count: number }>,
    ];

    // Enrich both lists in one round-trip pair: collect every unique
    // counterparty address, then batch-query known_entities and
    // top_delegators with a single IN(...) per table.
    const allAddresses = Array.from(
      new Set([
        ...depositorRows.map((r) => r.counterparty),
        ...withdrawerRows.map((r) => r.counterparty),
      ]),
    );

    const [knownRows, topRows] = await Promise.all([
      allAddresses.length
        ? KnownEntity.findAll({
            where: { address: { [Op.in]: allAddresses } },
            raw: true,
          })
        : Promise.resolve([]),
      allAddresses.length
        ? TopDelegator.findAll({
            where: { address: { [Op.in]: allAddresses } },
            raw: true,
          })
        : Promise.resolve([]),
    ]);
    const labelByAddr = new Map(knownRows.map((k) => [k.address, k.label]));
    const rankByAddr = new Map(topRows.map((t) => [t.address, t.rank]));

    const enrich = (rows: typeof depositorRows) =>
      rows.map((r) => ({
        address: r.counterparty,
        label: labelByAddr.get(r.counterparty) ?? null,
        rank: rankByAddr.get(r.counterparty) ?? null,
        totalAmount: Number(r.total_amount),
        txCount: Number(r.tx_count),
      }));

    return NextResponse.json(
      {
        window: windowKey,
        depositors: enrich(depositorRows),
        withdrawers: enrich(withdrawerRows),
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
