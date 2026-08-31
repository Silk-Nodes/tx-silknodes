// GET /api/issuance-factor
//
// The single authoritative block-time correction factor, so every surface
// shows the same APY.
//
// Why this exists: the factor is measured from live block times, and each
// context that measured its own got a slightly different answer. Two
// measurements over different 20,000-block windows disagree by up to ~1%,
// which put 12.24% on the validator list and 12.35% on the wallet panel at
// the same moment. Both were "right"; they were different samples. One
// server-side measurement, cached in-process, removes the disagreement.
import { NextResponse } from "next/server";
import { issuanceFactor } from "@/lib/chain-economics";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const { factor, blockSeconds } = await issuanceFactor();
  return NextResponse.json(
    { factor, blockSeconds },
    // Clients may cache briefly; the factor moves glacially. The 10 minute
    // in-process cache upstream is the real rate limiter.
    { headers: { "cache-control": "public, max-age=120" } },
  );
}
