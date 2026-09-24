// /api/coin: CoinGecko market data for TX, fetched once per minute for every
// visitor.
//
// This used to be called from the browser. CoinGecko's free tier rate limits
// per IP and started answering 429 after two calls, the failed refresh
// resolved with price 0, and the Today card replaced a good price with "-".
// One server fetch per minute stays well under the limit, a demo key lifts it
// further, and the last good answer is served when CoinGecko refuses.

import { NextResponse } from "next/server";
import { cached, cacheHeaders } from "@/lib/response-cache";

export const dynamic = "force-dynamic";

const URL_COIN =
  "https://api.coingecko.com/api/v3/coins/tx?localization=false&tickers=false&community_data=false&developer_data=false";
const KEY = process.env.COINGECKO_API_KEY || "";

let lastGood: { data: unknown; at: string } | null = null;

async function load() {
  const res = await fetch(URL_COIN, {
    headers: KEY ? { "x-cg-demo-api-key": KEY } : {},
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`coingecko HTTP ${res.status}`);
  const data = await res.json();
  if (!(data?.market_data?.current_price?.usd > 0)) throw new Error("coingecko returned no price");
  lastGood = { data, at: new Date().toISOString() };
  return lastGood;
}

export async function GET() {
  try {
    const r = await cached("coin:tx", 60_000, load);
    return NextResponse.json({ ...r, stale: false }, { headers: cacheHeaders(60) });
  } catch (e) {
    console.warn(`[api/coin] ${(e as Error).message}${lastGood ? ", serving last good" : ""}`);
    if (lastGood) return NextResponse.json({ ...lastGood, stale: true }, { headers: cacheHeaders(30) });
    return NextResponse.json({ error: "price unavailable" }, { status: 503 });
  }
}
