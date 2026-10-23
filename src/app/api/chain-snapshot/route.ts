// GET /api/chain-snapshot: the chain reads every page shares, made once a
// minute on the server instead of in each visitor's browser (lib/chain-snapshot).
//
// Before this, opening /validators made ~50 LCD calls from the browser: the
// staking pool, inflation, provisions and distribution params, the validator
// set three times over, and 29 delegation lookups in sequential batches of
// five to sum the stake excluded from PSE. An empty read answers 503 and the
// browser falls back to reading the chain itself.

import { NextResponse } from "next/server";
import { cacheHeaders } from "@/lib/response-cache";
import { chainSnapshot } from "@/lib/chain-snapshot";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await chainSnapshot(), { headers: cacheHeaders(30) });
  } catch (e) {
    console.warn(`[api/chain-snapshot] ${(e as Error).message}`);
    return NextResponse.json({ error: "chain unreachable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
