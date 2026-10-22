// GET /api/chain-snapshot: the chain reads every page shares, made once a
// minute on the server instead of in each visitor's browser.
//
// Before this, opening /validators made ~50 LCD calls from the browser: the
// staking pool, inflation, provisions and distribution params, the validator
// set three times over (the shell, then the table again each time its props
// arrived), and 29 delegation lookups in sequential batches of five to sum
// the stake excluded from PSE. Here they run once per minute for everyone,
// and the excluded stake keeps its own 10 minute cache in lib/api.
//
// A read that comes back empty is an error, not data: fetchStakingData
// returns zeros when the chain is unreachable, and caching that for a minute
// would show every visitor 0 TX bonded. The route answers 503 instead and
// the browser falls back to reading the chain itself.

import { NextResponse } from "next/server";
import { cached, cacheHeaders } from "@/lib/response-cache";
import { fetchStakingData, fetchAllValidators, fetchValidatorSet } from "@/lib/api";
import type { ChainSnapshot } from "@/lib/types";

export const dynamic = "force-dynamic";

const TTL_MS = 60_000;

async function snapshot(): Promise<ChainSnapshot> {
  const [stakingData, validators, validatorSet] = await Promise.all([
    fetchStakingData(),
    fetchAllValidators(),
    fetchValidatorSet(),
  ]);
  if (!(stakingData.bondedTokens > 0)) throw new Error("staking pool read returned 0 bonded");
  if (!validatorSet.length) throw new Error("validator set read returned no validators");
  return { stakingData, validators, validatorSet, at: new Date().toISOString() };
}

export async function GET() {
  try {
    const body = await cached("chain-snapshot", TTL_MS, snapshot);
    return NextResponse.json(body, { headers: cacheHeaders(30) });
  } catch (e) {
    console.warn(`[api/chain-snapshot] ${(e as Error).message}`);
    return NextResponse.json({ error: "chain unreachable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
