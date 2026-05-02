// GET /api/flows
//
// Powers the Flows tab. Aggregates exchange_flows over the requested
// window (default 24h) and returns:
//
//   {
//     window: "24h" | "7d" | "30d",
//     totals:    { inflow, outflow, net, txCount },
//     exchanges: [
//       { name, address, inflow, outflow, net, txCount, latestAt },
//       ...
//     ],
//     updatedAt: ISO string
//   }
//
// Numbers are TX (display units, already converted by the collector).
// `net = inflow - outflow` from the EXCHANGE'S perspective:
//   net > 0  -> exchange accumulated TX (deposits > withdrawals) -> bearish
//   net < 0  -> exchange released TX  (withdrawals > deposits)   -> bullish

import { NextResponse } from "next/server";
import { Op, fn, col, literal } from "sequelize";
import { ExchangeAddress, ExchangeFlow } from "@/lib/db/models";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Window key -> milliseconds lookback. "all" omits the time filter so
// the aggregation runs over the entire exchange_flows table.
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
    const requested = url.searchParams.get("window") ?? "24h";
    const windowKey = (Object.prototype.hasOwnProperty.call(WINDOWS, requested)
      ? requested
      : "24h") as keyof typeof WINDOWS;
    // `prev=true` shifts the window back by one full window length so
    // the client can compare current vs previous period without a
    // second endpoint. Powers the "this period vs last period" panel.
    // Skipped for the "all" window (no prior period).
    const wantPrev = url.searchParams.get("prev") === "true";
    const lookback = WINDOWS[windowKey];
    const now = Date.now();
    const sinceDate =
      lookback == null
        ? null
        : new Date(now - (wantPrev ? 2 * lookback : lookback));
    const untilDate =
      lookback == null
        ? null
        : new Date(now - (wantPrev ? lookback : 0));

    const whereClause =
      sinceDate && untilDate
        ? { timestamp: { [Op.gte]: sinceDate, [Op.lt]: untilDate } }
        : sinceDate
          ? { timestamp: { [Op.gte]: sinceDate } }
          : {};

    const [exchanges, aggRows] = await Promise.all([
      ExchangeAddress.findAll({ raw: true, order: [["exchange_name", "ASC"]] }),
      // SUM by (exchange_address, direction). PG handles the GROUP BY in
      // one round trip — way cheaper than per-exchange queries.
      ExchangeFlow.findAll({
        attributes: [
          "exchange_address",
          "direction",
          [fn("COALESCE", fn("SUM", col("amount")), 0), "total_amount"],
          [fn("COUNT", literal("*")), "tx_count"],
          [fn("MAX", col("timestamp")), "latest_at"],
        ],
        where: whereClause,
        group: ["exchange_address", "direction"],
        raw: true,
      }) as unknown as Promise<
        Array<{
          exchange_address: string;
          direction: "inflow" | "outflow";
          total_amount: string;
          tx_count: string;
          latest_at: Date | null;
        }>
      >,
    ]);

    // Pivot the agg rows into per-address totals.
    type Row = {
      inflow: number;
      outflow: number;
      txCount: number;
      latestAt: Date | null;
    };
    const byAddr = new Map<string, Row>();
    for (const e of exchanges) {
      byAddr.set(e.address, {
        inflow: 0,
        outflow: 0,
        txCount: 0,
        latestAt: null,
      });
    }
    for (const a of aggRows) {
      const r = byAddr.get(a.exchange_address);
      if (!r) continue;
      const amount = Number(a.total_amount);
      const count = Number(a.tx_count);
      if (a.direction === "inflow") r.inflow = amount;
      else if (a.direction === "outflow") r.outflow = amount;
      r.txCount += count;
      if (a.latest_at && (!r.latestAt || a.latest_at > r.latestAt)) {
        r.latestAt = a.latest_at;
      }
    }

    let totalIn = 0;
    let totalOut = 0;
    let totalTx = 0;
    const perExchange = exchanges.map((e) => {
      const r = byAddr.get(e.address)!;
      totalIn += r.inflow;
      totalOut += r.outflow;
      totalTx += r.txCount;
      return {
        name: e.exchange_name,
        address: e.address,
        inflow: r.inflow,
        outflow: r.outflow,
        net: r.inflow - r.outflow,
        txCount: r.txCount,
        latestAt: r.latestAt?.toISOString() ?? null,
      };
    });

    return NextResponse.json(
      {
        window: windowKey,
        prev: wantPrev,
        totals: {
          inflow: totalIn,
          outflow: totalOut,
          net: totalIn - totalOut,
          txCount: totalTx,
        },
        exchanges: perExchange,
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
