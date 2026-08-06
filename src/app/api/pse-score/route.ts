// GET /api/pse-score
//
// Returns the most-recent PSE network score row. Replaces the
// /pse-network-score.json file the VM's silknodes-pse-score timer
// used to write every 6 h. Small, one-shot read — separate route
// (rather than bundling into /api/analytics-data) so the PSE page's
// initial load doesn't pull the full analytics payload.
//
// Response shape mirrors the old JSON file so the page.tsx consumer
// needs no logic change:
//   {
//     networkTotalScore:   string (bigint as digits)
//     eligibleDelegators?: number
//     delegatorsWithScore?: number
//     fetchErrors?:        number
//     updatedAt:           ISO string
//     updatedAtTimestamp:  number (unix seconds)
//   }

import { NextResponse } from "next/server";
import { withCache } from "@/lib/response-cache";
import { PseScore } from "@/lib/db/models";

const ROUTE_TAG = "pse-score";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function handler(_req: Request) {
  try {
    const row = await PseScore.findOne({
      order: [["computed_at", "DESC"]],
      raw: true,
    });
    if (!row) {
      // No rows yet — return a null-ish payload so the frontend can
      // show its "score unavailable" state without throwing.
      return NextResponse.json(
        { networkTotalScore: null, updatedAt: null, updatedAtTimestamp: 0 },
        { headers: { "cache-control": "no-store" } },
      );
    }

    // `payload` is the full object the collector captured; we spread
    // it so callers that depend on its sub-fields (eligibleDelegators,
    // delegatorsWithScore, fetchErrors) still work exactly as they
    // did against the JSON file.
    const payload =
      typeof row.payload === "object" && row.payload != null
        ? (row.payload as Record<string, unknown>)
        : {};

    return NextResponse.json(
      {
        ...payload,
        networkTotalScore: row.score, // NUMERIC arrives as string — correct shape
        updatedAt: row.computed_at.toISOString(),
        updatedAtTimestamp: Math.floor(row.computed_at.getTime() / 1000),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err: unknown) {
    // The raw message can carry the DB role, connection string, internal
    // hostnames or upstream credentials, so it is logged and never returned.
    // Callers get a generic failure; operators get the detail in the journal.
    console.error(`[${ROUTE_TAG}]`, err);
    return NextResponse.json(
      { error: "internal error", at: new Date().toISOString() },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

// Cached and single-flighted: repeat traffic costs nothing upstream, and
// concurrent misses share one execution instead of one fan-out each.
export const GET = withCache("pse-score", 300, handler);
