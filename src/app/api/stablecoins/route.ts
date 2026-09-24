// GET /api/stablecoins
//
// Everything the /stablecoins page shows. Two sources, deliberately split:
//
//   live chain state   supply, holders, concentration, USTX status, USDC
//                      fragmentation. Read now, so the page is correct even
//                      with no collector and no database (which is also how
//                      it runs in local development).
//   stablecoin_snapshots   the history the chain does not keep. Written
//                          hourly by vm-service/collect-stablecoins.mjs. An
//                          empty history is reported as empty, never faked.

import { NextResponse } from "next/server";
import { QueryTypes } from "sequelize";
import { cached } from "@/lib/response-cache";
import { sequelize } from "@/lib/db";
import {
  TRACKED,
  BRALE_MAINNET,
  BRALE_TESTNET,
  USDC_CANONICAL,
  measureCoin,
  ustxStatus,
  usdcFragments,
  type CoinState,
} from "@/lib/stablecoins";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Five minutes for the coins: holder lists move slowly and USDC's 2,964
// holders are three upstream pages. USTX status on the same clock, so launch
// shows within five minutes of the first mint.
const LIVE_MS = 5 * 60_000;
// Fragmentation is one trace lookup per IBC denom, about ninety calls, and
// the set of USDC routes changes over weeks. Six hours.
const FRAGMENTS_MS = 6 * 60 * 60_000;
const HISTORY_DAYS = 90;

type HistoryPoint = { denom: string; takenAt: string; supply: number; holders: number | null; top1Share: number | null };

async function history(): Promise<{ points: HistoryPoint[]; available: boolean }> {
  try {
    const rows = await sequelize.query<{
      denom: string; taken_at: string; supply: string; holders: number | null; top1_share: string | null;
    }>(
      `SELECT denom, taken_at, supply, holders, top1_share
         FROM stablecoin_snapshots
        WHERE taken_at >= NOW() - (:days || ' days')::interval
        ORDER BY taken_at ASC`,
      { replacements: { days: HISTORY_DAYS }, type: QueryTypes.SELECT },
    );
    return {
      available: true,
      points: rows.map((r) => ({
        denom: r.denom,
        takenAt: new Date(r.taken_at).toISOString(),
        supply: Number(r.supply),
        holders: r.holders,
        top1Share: r.top1_share == null ? null : Number(r.top1_share),
      })),
    };
  } catch {
    // No database, or migration 021 not run yet. The live half still stands.
    return { available: false, points: [] };
  }
}

export async function GET() {
  const [coins, ustx, fragments, hist] = await Promise.all([
    cached("stablecoins:coins", LIVE_MS, async () => {
      const settled = await Promise.allSettled(TRACKED.map((c) => measureCoin(c)));
      const ok = settled
        .filter((s): s is PromiseFulfilledResult<CoinState> => s.status === "fulfilled")
        .map((s) => s.value);
      // A coin that could not be read is left out rather than shown as zero.
      // Throwing when none succeed keeps a total outage out of the cache.
      if (ok.length === 0) throw new Error("no stablecoin could be measured");
      return ok;
    }).catch(() => [] as CoinState[]),
    cached("stablecoins:ustx", LIVE_MS, () => ustxStatus()).catch(() => null),
    cached("stablecoins:fragments", FRAGMENTS_MS, async () => {
      const f = await usdcFragments();
      if (f.length === 0) throw new Error("no USDC routes resolved");
      return f;
    }).catch(() => []),
    history(),
  ]);

  const usdcTotal = fragments.reduce((s, f) => s + f.amount, 0);
  const canonical = fragments.find((f) => f.denom === USDC_CANONICAL);

  return NextResponse.json(
    {
      updatedAt: new Date().toISOString(),
      coins,
      ustx,
      watching: { mainnetIssuer: BRALE_MAINNET, testnetIssuer: BRALE_TESTNET },
      usdc: {
        routes: fragments.length,
        total: usdcTotal,
        canonical: canonical?.amount ?? null,
        canonicalShare: canonical && usdcTotal > 0 ? canonical.amount / usdcTotal : null,
        fragments,
      },
      history: hist,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
