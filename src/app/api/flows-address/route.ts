// GET /api/flows-address?address=core1...&window=24h
//
// Backs the counterparty side panel on the Flows tab. Pulls everything
// we know about ONE address's interactions with tracked exchanges in
// the selected window:
//
//   - basic metadata (label from known_entities, top_delegators rank)
//   - whether this address is itself an exchange (so the UI can decide
//     which panel layout to render)
//   - summary totals from the address's perspective:
//       totalSentToExchanges      = SUM where address was counterparty
//                                   in 'inflow' rows
//       totalReceivedFromExchanges= SUM where address was counterparty
//                                   in 'outflow' rows
//       net = received - sent (positive = receiving from exchanges)
//   - per-exchange breakdown (how much they moved with each exchange)
//   - recent flows (last 20) for this address only
//
// Direction in the recent[] array is preserved as the exchange-centric
// label that the schema already uses ('inflow'/'outflow') so the UI can
// reuse the same colour conventions as the main feed.

import { NextResponse } from "next/server";
import { Op } from "sequelize";
import { QueryTypes } from "sequelize";
import { sequelize } from "@/lib/db";
import {
  ExchangeAddress,
  ExchangeFlow,
  KnownEntity,
  TopDelegator,
} from "@/lib/db/models";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const WINDOWS: Record<string, number | null> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d":  7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
  "all": null,
};

const RECENT_LIMIT = 20;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const address = url.searchParams.get("address")?.trim() ?? "";
    if (!address) {
      return NextResponse.json(
        { error: "Missing 'address' query parameter" },
        { status: 400 },
      );
    }

    const requested = url.searchParams.get("window") ?? "24h";
    const windowKey = (Object.prototype.hasOwnProperty.call(WINDOWS, requested)
      ? requested
      : "24h") as keyof typeof WINDOWS;
    const lookback = WINDOWS[windowKey];
    const sinceDate = lookback == null ? null : new Date(Date.now() - lookback);

    // Look up everything we need in parallel.
    const [
      exchangeRow,
      knownRow,
      topRow,
      perExchangeRows,
      recentRows,
      allExchanges,
    ] = await Promise.all([
      ExchangeAddress.findOne({ where: { address }, raw: true }),
      KnownEntity.findOne({ where: { address }, raw: true }),
      TopDelegator.findOne({ where: { address }, raw: true }),
      // Aggregate per-exchange breakdown for this counterparty
      sequelize.query<{
        exchange_address: string;
        direction: "inflow" | "outflow";
        total_amount: string;
        tx_count: number;
      }>(
        `
        SELECT exchange_address, direction,
               SUM(amount)::numeric AS total_amount,
               COUNT(*)::int        AS tx_count
        FROM exchange_flows
        WHERE counterparty = :address
          ${sinceDate ? "AND timestamp >= :sinceDate" : ""}
        GROUP BY exchange_address, direction
        `,
        {
          type: QueryTypes.SELECT,
          replacements: sinceDate ? { address, sinceDate } : { address },
        },
      ),
      // Recent 20 flows touching this counterparty
      ExchangeFlow.findAll({
        where: {
          counterparty: address,
          ...(sinceDate ? { timestamp: { [Op.gte]: sinceDate } } : {}),
        },
        order: [["timestamp", "DESC"]],
        limit: RECENT_LIMIT,
        raw: true,
      }),
      ExchangeAddress.findAll({ raw: true }),
    ]);

    const exchangeNameByAddress = new Map(
      allExchanges.map((e) => [e.address, e.exchange_name]),
    );

    // Pivot per-exchange aggregation: one row per exchange with both
    // directions filled in.
    type PerExchange = {
      exchange: string;
      exchangeAddress: string;
      sentToExchange: number;     // counterparty -> exchange
      receivedFromExchange: number; // exchange -> counterparty
      txCount: number;
      net: number;                 // received - sent (positive = net withdrawer)
    };
    const byExchange = new Map<string, PerExchange>();
    for (const r of perExchangeRows as Array<{
      exchange_address: string;
      direction: "inflow" | "outflow";
      total_amount: string;
      tx_count: number;
    }>) {
      const cur =
        byExchange.get(r.exchange_address) ?? {
          exchange: exchangeNameByAddress.get(r.exchange_address) ?? "Unknown",
          exchangeAddress: r.exchange_address,
          sentToExchange: 0,
          receivedFromExchange: 0,
          txCount: 0,
          net: 0,
        };
      const amount = Number(r.total_amount);
      const count = Number(r.tx_count);
      // direction='inflow' = TX flowing INTO the exchange = the counterparty
      // SENT to the exchange. Mirror this on the wallet's perspective.
      if (r.direction === "inflow") cur.sentToExchange += amount;
      else if (r.direction === "outflow") cur.receivedFromExchange += amount;
      cur.txCount += count;
      cur.net = cur.receivedFromExchange - cur.sentToExchange;
      byExchange.set(r.exchange_address, cur);
    }
    const perExchange = Array.from(byExchange.values()).sort(
      (a, b) =>
        Math.abs(b.sentToExchange + b.receivedFromExchange) -
        Math.abs(a.sentToExchange + a.receivedFromExchange),
    );

    const totalSent = perExchange.reduce((s, e) => s + e.sentToExchange, 0);
    const totalReceived = perExchange.reduce((s, e) => s + e.receivedFromExchange, 0);
    const totalTx = perExchange.reduce((s, e) => s + e.txCount, 0);

    const recent = recentRows.map((r) => ({
      txHash: r.tx_hash,
      timestamp: r.timestamp.toISOString(),
      exchange: exchangeNameByAddress.get(r.exchange_address) ?? "Unknown",
      exchangeAddress: r.exchange_address,
      direction: r.direction,
      amount: Number(r.amount),
    }));

    return NextResponse.json(
      {
        address,
        label: knownRow?.label ?? null,
        labelType: knownRow?.type ?? null,
        rank: topRow?.rank ?? null,
        isExchange: !!exchangeRow,
        exchangeName: exchangeRow?.exchange_name ?? null,
        window: windowKey,
        summary: {
          totalSentToExchanges: totalSent,
          totalReceivedFromExchanges: totalReceived,
          net: totalReceived - totalSent,
          txCount: totalTx,
        },
        perExchange,
        recent,
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
