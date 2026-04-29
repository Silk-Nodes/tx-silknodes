// GET /api/flows-recent?limit=50&window=24h
//
// Latest exchange flows feed for the "Recent Large Flows" section on
// the Flows tab. Each row is one Bank Send touching a tracked exchange
// address; we annotate the counterparty with its top_delegators rank
// (if any) so the UI can show "Whale #47" tags without an extra
// round-trip.
//
// Response:
//   {
//     window: ...,
//     flows: [
//       {
//         txHash, timestamp, exchange, exchangeAddress, direction,
//         counterparty, counterpartyLabel?, counterpartyRank?, amount
//       },
//       ...
//     ],
//     updatedAt
//   }
//
// counterpartyLabel: human label from known_entities (e.g. another
//   exchange, validator self-stake, etc.) when available
// counterpartyRank: top_delegators rank if the counterparty is in the
//   top 500 — the "whale tag" signal.

import { NextResponse } from "next/server";
import { Op } from "sequelize";
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

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

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

    // Pull the recent flows + lookup tables in parallel. counterparty
    // joins are done in JS afterwards because Sequelize's native joins
    // require associations and we'd rather not add them just for this.
    const [flowRows, exchangeRows] = await Promise.all([
      ExchangeFlow.findAll({
        where: sinceDate ? { timestamp: { [Op.gte]: sinceDate } } : {},
        order: [["timestamp", "DESC"]],
        limit,
        raw: true,
      }),
      ExchangeAddress.findAll({ raw: true }),
    ]);

    if (flowRows.length === 0) {
      return NextResponse.json(
        { window: windowKey, flows: [], updatedAt: new Date().toISOString() },
        { headers: { "cache-control": "no-store" } },
      );
    }

    // Build the counterparty enrichment maps from the addresses we
    // actually need — keeps the queries minimal regardless of how many
    // rows total are in known_entities or top_delegators.
    const counterparties = Array.from(
      new Set(flowRows.map((f) => f.counterparty)),
    );
    const [knownRows, topRows] = await Promise.all([
      KnownEntity.findAll({
        where: { address: { [Op.in]: counterparties } },
        raw: true,
      }),
      TopDelegator.findAll({
        where: { address: { [Op.in]: counterparties } },
        raw: true,
      }),
    ]);
    const knownByAddr = new Map(knownRows.map((k) => [k.address, k]));
    const rankByAddr = new Map(topRows.map((t) => [t.address, t.rank]));
    const exchangeByAddr = new Map(
      exchangeRows.map((e) => [e.address, e.exchange_name]),
    );

    const flows = flowRows.map((f) => ({
      txHash: f.tx_hash,
      timestamp: f.timestamp.toISOString(),
      exchange: exchangeByAddr.get(f.exchange_address) ?? "Unknown",
      exchangeAddress: f.exchange_address,
      direction: f.direction,
      counterparty: f.counterparty,
      counterpartyLabel: knownByAddr.get(f.counterparty)?.label ?? null,
      counterpartyRank: rankByAddr.get(f.counterparty) ?? null,
      amount: Number(f.amount),
    }));

    return NextResponse.json(
      {
        window: windowKey,
        flows,
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
