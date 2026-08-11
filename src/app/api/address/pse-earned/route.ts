// GET /api/address/pse-earned?address=core1...
//
// A wallet's REAL PSE distribution history, straight from the indexer's
// pse_transfer table (recipient_address, amount, score per distribution).
// The Passport already estimates next-cycle PSE from the live score; this
// is the actual TX a wallet has been paid to date. Cache 10 min (PSE only
// changes once per monthly distribution).

import { NextResponse } from "next/server";
import { hasuraQuery } from "@/lib/hasura";

const UCORE_PER_TX = 1_000_000;

const QUERY = `query Q($addr: String!) {
  pse_transfer(where: {recipient_address: {_eq: $addr}}, order_by: {height: desc}, limit: 200) {
    height amount score allocation_type
  }
}`;

export async function GET(req: Request) {
  const address = (new URL(req.url).searchParams.get("address") || "").trim();
  if (!address.startsWith("core1") || address.length < 39) {
    return NextResponse.json({ error: "Enter a valid core1... address" }, { status: 400 });
  }
  try {
    const data = await hasuraQuery<{ pse_transfer: { height: number; amount: string; score: string; allocation_type: string }[] }>(
      QUERY, { addr: address },
    );
    const rows = data.pse_transfer ?? [];

    const distributions = rows.map((r) => ({
      height: r.height,
      amountTX: Number(r.amount) / UCORE_PER_TX,
      // Raw ucore, as a string. A payout of 22,192.040720 TX loses its last
      // digits through Number, and these are the figures a reader recomputes
      // the share from, so they have to survive intact.
      amountUcore: r.amount,
      // The chain's own score for this address in that cycle. With the
      // cycle's total_score it makes each payout checkable:
      // amount = score / total_score * pool. Verified against cycle 5, where
      // the recipients' scores sum to total_score exactly.
      score: r.score,
      type: r.allocation_type,
    }));
    const totalTX = distributions.reduce((s, d) => s + d.amountTX, 0);

    return NextResponse.json({
      address,
      count: distributions.length,
      totalTX,
      lastTX: distributions[0]?.amountTX ?? 0,
      distributions: distributions.slice(0, 12),
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load PSE history" },
      { status: 502 },
    );
  }
}
