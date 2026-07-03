// GET /api/address/referrals?address=core1...
//
// On-chain tx.market referral earnings for a wallet. Referral rewards are
// paid by a CosmWasm payout contract call from tx.market's referral payer
// (REFERRAL_PAYER). Each call carries a self-describing message:
//
//   msg.payout.key      = "ref-<referrer>-<referee>"   (bech32 has no "-")
//   msg.payout.payouts  = [{ recipient, amount }, ...]  (500 TX each; 1000 = Elite)
//
// So for any address we can read, straight from the public indexer:
//   - referrals made (times it is the referrer in the key)
//   - total TX earned (payouts where it is the recipient)
//   - whether it was itself referred (times it is the referee)
//   - Elite (a referrer payout of 1000 TX)
//
// No tx.market login/API needed. Cache 5 min (only changes on new payouts).

import { NextResponse } from "next/server";
import { hasuraQuery } from "@/lib/hasura";

const REFERRAL_PAYER = "core15sh9smq7ay5r430yetzn57v2rg666ma0ulzp84";
const UCORE_PER_TX = 1_000_000;
const PAGE = 100;
const MAX_PAGES = 20; // safety cap (2000 payouts) so a query can't run away

const QUERY = `query Q($addr: [String!]!, $off: Int!) {
  message(
    where: {
      type: {_eq: "/cosmwasm.wasm.v1.MsgExecuteContract"},
      involved_accounts_addresses: {_contains: $addr},
      value: {_contains: {sender: "${REFERRAL_PAYER}"}}
    },
    order_by: {height: desc},
    limit: ${PAGE},
    offset: $off
  ) { height value }
}`;

interface Entry { height: number; amountTX: number; role: "referrer" | "referee"; counterparty: string; }

let cache: { ts: number; key: string; body: unknown } | null = null;
const TTL_MS = 5 * 60 * 1000;

export async function GET(req: Request) {
  const address = (new URL(req.url).searchParams.get("address") || "").trim();
  if (!address.startsWith("core1") || address.length < 39) {
    return NextResponse.json({ error: "Enter a valid core1... address" }, { status: 400 });
  }
  if (cache && cache.key === address && Date.now() - cache.ts < TTL_MS) {
    return NextResponse.json(cache.body);
  }

  try {
    const entries: Entry[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await hasuraQuery<{ message: { height: number; value: any }[] }>(
        QUERY, { addr: [address], off: page * PAGE },
      );
      const rows = data.message ?? [];

      for (const r of rows) {
        const p = r.value?.msg?.payout;
        if (!p || typeof p.key !== "string" || !p.key.startsWith("ref-")) continue;
        const [referrer, referee] = p.key.slice(4).split("-");
        const mine = (p.payouts ?? []).find((x: any) => x?.recipient === address);
        if (!mine) continue;
        const amountTX = Number(mine.amount?.amount ?? 0) / UCORE_PER_TX;
        const role = address === referrer ? "referrer" : address === referee ? "referee" : null;
        if (!role) continue;
        entries.push({ height: r.height, amountTX, role, counterparty: role === "referrer" ? referee : referrer });
      }
      if (rows.length < PAGE) break;
    }

    const asReferrer = entries.filter((e) => e.role === "referrer");
    const asReferee = entries.find((e) => e.role === "referee") ?? null;
    const body = {
      address,
      referralsMade: asReferrer.length,
      totalEarnedTX: entries.reduce((s, e) => s + e.amountTX, 0),
      elite: asReferrer.some((e) => e.amountTX >= 1000),
      referredBy: asReferee?.counterparty ?? null,
      payoutCount: entries.length,
      recent: entries.slice(0, 12),
      updatedAt: new Date().toISOString(),
    };
    cache = { ts: Date.now(), key: address, body };
    return NextResponse.json(body);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load referral data" },
      { status: 502 },
    );
  }
}
