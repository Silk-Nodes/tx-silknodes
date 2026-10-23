// The chain reads every page shares: staking data, the shell's validator
// list and the validator table's rows. Read once a minute on the server for
// every visitor. Served by /api/chain-snapshot and reused by /api/hints.
//
// A read that comes back empty is an error, not data: fetchStakingData
// returns zeros when the chain is unreachable, and caching that for a minute
// would show every visitor 0 TX bonded.

import { cached } from "@/lib/response-cache";
import { fetchStakingData, fetchAllValidators, fetchValidatorSet } from "@/lib/api";
import type { ChainSnapshot } from "@/lib/types";

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

export function chainSnapshot(): Promise<ChainSnapshot> {
  return cached("chain-snapshot", TTL_MS, snapshot);
}
