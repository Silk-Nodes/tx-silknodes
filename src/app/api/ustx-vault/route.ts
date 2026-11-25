// GET /api/ustx-vault
//
// The USTX vault as the contract reports it right now: terms, what is locked
// and for how long, rewards accrued and the TX held to pay them. Read through
// lib/ustx-vault, which caches for five minutes and shares one in-flight read.
//
// A failed read is a 503 with the reason, never an empty vault: "0 USTX
// locked" is a real answer and must not be what an outage looks like.

import { NextResponse } from "next/server";
import { liveVault } from "@/lib/ustx-vault";
import { cacheHeaders } from "@/lib/response-cache";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const vault = await liveVault();
    return NextResponse.json(vault, { headers: vault.stale ? { "cache-control": "no-store" } : cacheHeaders(300) });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.warn(`[ustx-vault] read failed: ${reason}`);
    return NextResponse.json({ error: "The vault contract could not be read." }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
