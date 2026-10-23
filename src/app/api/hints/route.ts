// GET /api/hints?page=stablecoins|analytics|passport: cards for the loading
// overlay on those pages (lib/hints). Cached five minutes per page. Never
// fails: a broken source drops its hint, and an empty list means no card.

import { NextResponse } from "next/server";
import { cacheHeaders } from "@/lib/response-cache";
import { hintsFor, HINT_PAGES, type HintPage } from "@/lib/hints";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const page = new URL(req.url).searchParams.get("page") as HintPage | null;
  if (!page || !HINT_PAGES.includes(page)) {
    return NextResponse.json({ error: "unknown page" }, { status: 400 });
  }
  const hints = await hintsFor(page).catch(() => []);
  return NextResponse.json({ hints }, { headers: cacheHeaders(120) });
}
