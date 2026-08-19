// GET /api/validator/[address]/events?before=<height>&limit=<n>
//
// Cursor-paginated stake events for one validator's Events tab. The main
// /api/validator/[address] route ships the first page inline; this serves
// every page after it so the tab can load the full history on demand
// instead of a hardcoded 40-row cap.
//
// Cursor is the height of the last row already shown, not an offset: new
// events arrive at the top between clicks, and an offset would then repeat
// or skip rows. "everything strictly older than height H" is stable no
// matter what lands above it.
//
// Same 5,000 TX floor as the main route, because the collector applies it
// at write time; there are no smaller rows to page into.

import { NextResponse } from "next/server";
import { QueryTypes } from "sequelize";
import { sequelize } from "@/lib/db";

const PAGE_DEFAULT = 50;
const PAGE_MAX = 200;

interface EventRow {
  txHash: string;
  height: number;
  timestamp: string;
  type: "delegate" | "undelegate" | "redelegate";
  delegator: string;
  amount: string;
  sourceValidator: string | null;
  outgoing: boolean;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  try {
    const { address } = await params;
    if (!address.startsWith("corevaloper")) {
      return NextResponse.json({ error: "invalid validator address" }, { status: 400 });
    }
    const url = new URL(req.url);
    const beforeRaw = url.searchParams.get("before");
    const limitRaw = Number(url.searchParams.get("limit"));
    const limit = Math.min(PAGE_MAX, Math.max(1, Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : PAGE_DEFAULT));
    // before is a block height. Absent = start from the newest.
    const before = beforeRaw !== null && /^\d+$/.test(beforeRaw) ? Number(beforeRaw) : null;

    // One extra row tells us whether another page exists without a second
    // COUNT query. We fetch limit+1, return limit, and set hasMore from the
    // overflow.
    const rows = await sequelize.query<EventRow>(
      `SELECT tx_hash AS "txHash", height, timestamp, type, delegator, amount,
              source_validator AS "sourceValidator",
              CASE WHEN source_validator = :v THEN true ELSE false END AS outgoing
         FROM staking_events
        WHERE (validator = :v OR source_validator = :v)
          ${before !== null ? "AND height < :before" : ""}
        ORDER BY height DESC
        LIMIT :lim`,
      {
        replacements: before !== null
          ? { v: address, before, lim: limit + 1 }
          : { v: address, lim: limit + 1 },
        type: QueryTypes.SELECT,
      },
    );

    const hasMore = rows.length > limit;
    const events = hasMore ? rows.slice(0, limit) : rows;
    const nextBefore = events.length > 0 ? events[events.length - 1].height : null;

    return NextResponse.json(
      { events, hasMore, nextBefore },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to load events" },
      { status: 500 },
    );
  }
}
