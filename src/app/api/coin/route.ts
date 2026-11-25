// /api/coin: the TX price for the whole site.
//
// Read from price_ticks (migration 024), which vm-service/collect-price.mjs
// fills once a minute from the exchanges that list TX: Gate, Ourbit, Kraken,
// MEXC and Bitrue, volume-weighted, outliers dropped. CoinGecko's free plan
// was the only source before and hit 80% of its monthly cap on 2026-10-01;
// it is now a fallback, used only when no recent tick exists (the collector
// is down, or locally with no database), and cached for ten minutes there.
//
// The response keeps the CoinGecko shape (data.market_data.*) so every
// consumer reads it unchanged. market_cap is left out on purpose: callers
// compute it from on-chain circulating supply, which keeps it independent of
// any aggregator. `source` says where the number came from.

import { NextResponse } from "next/server";
import { QueryTypes } from "sequelize";
import { sequelize } from "@/lib/db";
import { cached, cacheHeaders } from "@/lib/response-cache";

export const dynamic = "force-dynamic";

// A tick older than this is not "the price now". The collector runs every
// minute, so five minutes is four missed runs.
const FRESH_MS = 5 * 60_000;

const CG_URL =
  "https://api.coingecko.com/api/v3/coins/tx?localization=false&tickers=false&community_data=false&developer_data=false";
const CG_KEY = process.env.COINGECKO_API_KEY || "";

// Official circulating supply, from the TX chain data API (a public
// third-party endpoint). Read here so no browser depends on reaching tx.org.
// Ten minutes fresh; on a failed read the last good figure is served, and
// with none the field is left out and callers calculate it from the chain.
const TX_CIRCULATING_URL = "https://api.mainnet-1.tx.org/api/chain-data/v1/circulating-supply";
let lastCirculating: number | null = null;
// After a failed read, wait a minute before trying again. Without this every
// price request would sit through the timeout while tx.org is down.
const RETRY_MS = 60_000;
let failedAt = 0;

async function circulating(): Promise<number | null> {
  if (Date.now() - failedAt < RETRY_MS) return lastCirculating;
  try {
    lastCirculating = await cached("coin:tx:circulating", 10 * 60_000, async () => {
      const res = await fetch(TX_CIRCULATING_URL, { signal: AbortSignal.timeout(4_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const n = parseFloat(await res.text());
      if (!(n > 0)) throw new Error("no figure in the answer");
      return n;
    });
  } catch (e) {
    failedAt = Date.now();
    console.warn(`[api/coin] circulating supply read failed: ${(e as Error).message}`);
  }
  return lastCirculating;
}

type Payload = { data: { market_data: Record<string, unknown> } };
/** Adds the official circulating supply, replacing an aggregator's if present. */
async function withCirculating<T extends Payload>(p: T): Promise<T> {
  const n = await circulating();
  return n ? { ...p, data: { ...p.data, market_data: { ...p.data.market_data, circulating_supply: n } } } : p;
}

type Tick = { taken_at: string; price_usd: string; open_24h: string | null; volume_usd: string | null; venues_used: number };

async function latestTick(): Promise<Tick | null> {
  try {
    const [t] = await sequelize.query<Tick>(
      `SELECT taken_at, price_usd, open_24h, volume_usd, venues_used FROM price_ticks ORDER BY taken_at DESC LIMIT 1`,
      { type: QueryTypes.SELECT },
    );
    return t ?? null;
  } catch {
    return null; // no database, or migration 024 not run
  }
}

function fromTick(t: Tick, stale: boolean) {
  const price = Number(t.price_usd);
  const open = t.open_24h != null ? Number(t.open_24h) : null;
  return {
    data: {
      market_data: {
        current_price: { usd: price },
        price_change_percentage_24h: open ? (price / open - 1) * 100 : 0,
        total_volume: { usd: t.volume_usd != null ? Number(t.volume_usd) : 0 },
      },
    },
    at: new Date(t.taken_at).toISOString(),
    source: "exchanges",
    venues: t.venues_used,
    stale,
  };
}

// Fallback only. Ten minutes, so a collector outage cannot burn the quota.
function coingecko() {
  return cached("coin:tx:coingecko", 10 * 60_000, async () => {
    const res = await fetch(CG_URL, {
      headers: CG_KEY ? { "x-cg-demo-api-key": CG_KEY } : {},
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`coingecko HTTP ${res.status}`);
    const data = await res.json();
    if (!(data?.market_data?.current_price?.usd > 0)) throw new Error("coingecko returned no price");
    return { data, at: new Date().toISOString(), source: "coingecko", stale: false };
  });
}

export async function GET() {
  const tick = await latestTick();
  const fresh = tick && Date.now() - new Date(tick.taken_at).getTime() < FRESH_MS;
  if (tick && fresh) return NextResponse.json(await withCirculating(fromTick(tick, false)), { headers: cacheHeaders(30) });

  try {
    if (tick) console.warn(`[api/coin] newest price tick is ${tick.taken_at}; is silknodes-price.timer running? using CoinGecko`);
    return NextResponse.json(await withCirculating(await coingecko()), { headers: cacheHeaders(60) });
  } catch (e) {
    console.warn(`[api/coin] CoinGecko fallback failed: ${(e as Error).message}`);
    // An old exchange price, marked stale, beats no price at all.
    if (tick) return NextResponse.json(await withCirculating(fromTick(tick, true)), { headers: cacheHeaders(30) });
    return NextResponse.json({ error: "price unavailable" }, { status: 503 });
  }
}
