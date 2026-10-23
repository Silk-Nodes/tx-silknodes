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
import { sequelize } from "@/lib/db";
import {
  BRALE_MAINNET,
  BRALE_TESTNET,
  USDC_CANONICAL,
  liveCoins,
  liveUstx,
  liveFragments,
  recording,
  activity,
  supplyFlows,
  issuerControls,
  issuerLog,
} from "@/lib/stablecoins";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Cache lifetimes live with the reads in lib/stablecoins, shared with the OG
// card so a shared link and the page it opens always agree.
const HISTORY_DAYS = 90;

type HistoryPoint = { denom: string; takenAt: string; supply: number; holders: number | null; top1Share: number | null };

async function history(): Promise<{ points: HistoryPoint[]; available: boolean }> {
  try {
    const rows = await sequelize.query<{
      denom: string; taken_at: string; supply: string; holders: number | null; top1_share: string | null;
    }>(
      // Hourly for the last 48 hours, the day's last reading before that,
      // and each coin's first snapshot so "since <first day>" stays exact.
      // Every hourly point since September was 3,141 rows and 516 KB of the
      // 529 KB response, which the browser parsed and charted on every visit
      // for cards that are 130px tall.
      `SELECT denom, taken_at, supply, holders, top1_share FROM (
         (SELECT * FROM stablecoin_snapshots
           WHERE taken_at >= NOW() - INTERVAL '48 hours')
         UNION
         (SELECT DISTINCT ON (denom, date_trunc('day', taken_at)) *
            FROM stablecoin_snapshots
           WHERE taken_at >= NOW() - (:days || ' days')::interval
             AND taken_at < NOW() - INTERVAL '48 hours'
           ORDER BY denom, date_trunc('day', taken_at), taken_at DESC)
         UNION
         (SELECT DISTINCT ON (denom) *
            FROM stablecoin_snapshots
           WHERE taken_at >= NOW() - (:days || ' days')::interval
           ORDER BY denom, taken_at ASC)
       ) h
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

export async function GET(req: Request) {
  const [coins, ustx, fragments, hist, rec, act] = await Promise.all([
    liveCoins(),
    liveUstx(),
    liveFragments(),
    history(),
    recording(),
    activity(),
  ]);

  // USTX conversions, once it exists. Outside production a denom can be
  // passed as ?previewFlows= to see the tracker filled with another coin's
  // data (SBC shares Brale's issuer); the page labels that as a preview.
  const preview = process.env.NODE_ENV !== "production" ? new URL(req.url).searchParams.get("previewFlows") : null;
  const flowsDenom = preview ?? (ustx?.issued ? ustx.denom : null);
  const [flows, controls, log] = flowsDenom
    ? await Promise.all([supplyFlows(flowsDenom), issuerControls(flowsDenom), issuerLog(flowsDenom)])
    : [null, null, null];

  const usdcTotal = fragments.reduce((s, f) => s + f.amount, 0);
  const canonical = fragments.find((f) => f.denom === USDC_CANONICAL);

  return NextResponse.json(
    {
      updatedAt: new Date().toISOString(),
      coins,
      ustx,
      watching: { mainnetIssuer: BRALE_MAINNET, testnetIssuer: BRALE_TESTNET },
      recording: rec,
      usdc: {
        routes: fragments.length,
        total: usdcTotal,
        canonical: canonical?.amount ?? null,
        canonicalShare: canonical && usdcTotal > 0 ? canonical.amount / usdcTotal : null,
        fragments,
      },
      history: hist,
      activity: act,
      ustxFlows: flows ? { ...flows, preview: Boolean(preview) } : null,
      // Null means the read failed, not that nothing happened.
      ustxControls: controls,
      ustxLog: log,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
