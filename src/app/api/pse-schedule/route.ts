// GET /api/pse-schedule
//
// The PSE payout schedule (unix seconds, ascending), read from the indexer on
// the server. The browser used to ask the indexer directly; a visitor whose
// network cannot reach it (seen 2026-11-25) then got no countdown at all,
// while this server could read it fine. Cached for an hour: the schedule
// only changes by governance.

import { NextResponse } from "next/server";
import { fetchPSESchedule } from "@/lib/pse-calculator";
import { cached, cacheHeaders } from "@/lib/response-cache";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const schedule = await cached("pse-schedule", 60 * 60_000, async () => {
      const s = await fetchPSESchedule();
      // An empty answer is a failed read, and a failure is never cached.
      if (s.length === 0) throw new Error("indexer returned no schedule");
      return s;
    });
    return NextResponse.json({ schedule }, { headers: cacheHeaders(300) });
  } catch (e) {
    console.warn(`[api/pse-schedule] ${(e as Error).message}`);
    return NextResponse.json({ error: "The PSE schedule could not be read." }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
