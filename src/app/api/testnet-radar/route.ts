// GET /api/testnet-radar: contracts deployed on TX testnet in the last 60
// days, grouped by product line. Scanned from the chain, cached for an hour
// in lib/testnet-radar. A failed scan answers 503; the page says so rather
// than showing an empty radar.

import { NextResponse } from "next/server";
import { cacheHeaders } from "@/lib/response-cache";
import { testnetRadar } from "@/lib/testnet-radar";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await testnetRadar(), { headers: cacheHeaders(300) });
  } catch (e) {
    console.warn(`[api/testnet-radar] ${(e as Error).message}`);
    return NextResponse.json({ error: "testnet unreachable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
