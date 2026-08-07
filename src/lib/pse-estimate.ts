// One PSE estimate, used by every page.
//
// Why this exists
// ---------------
// layeredPSEEstimate takes six inputs and there were four call sites, each
// assembling them independently. They did not agree:
//
//   input                     PSE page      passport      portfolio
//   lastDistTotalScore        real          null          null
//   excludedStake             real          0             0
//   lastDistributionTimestamp missing       missing       missing
//
// Those are not cosmetic. lastDistTotalScore selects layer 2, excludedStake
// changes the denominator by 9.6%, and the missing timestamp disables the
// cycle-mismatch check entirely. So the same wallet produced different PSE
// figures depending on which page you opened it on, which is the one thing a
// number like this cannot do.
//
// Everything now resolves through here. The network-level inputs are fetched
// once and shared, so consistency is structural rather than something four
// call sites have to remember.

import {
  fetchLastPSEDistribution,
  fetchOnChainPSEScore,
  layeredPSEEstimate,
} from "@/lib/pse-calculator";
import { getExcludedPSEStake } from "@/lib/api";

export interface PSEEstimate {
  /** Estimated TX for the current monthly distribution. */
  monthly: number;
  /** Share of the community pool, as a percentage. */
  sharePct: number;
  /** Which layer produced it. Callers use this to label the number honestly. */
  source: string;
}

interface NetworkInputs {
  networkTotalScore: string | null;
  lastDistTotalScore: string | null;
  lastDistributionTimestamp: number;
  bondedTokens: number;
  excludedStake: number;
}

let cache: { value: NetworkInputs; at: number } | null = null;
let inflight: Promise<NetworkInputs> | null = null;
const TTL_MS = 5 * 60 * 1000;

/**
 * The network-level half of a PSE estimate: everything that is the same for
 * every wallet. Fetched once per five minutes and shared, with concurrent
 * callers joining one in-flight request rather than each starting their own.
 */
export async function getPSENetworkInputs(): Promise<NetworkInputs> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  if (inflight) return inflight;

  inflight = (async () => {
    const [net, lastDist, pool, excludedStake] = await Promise.all([
      fetch("/api/pse-score")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetchLastPSEDistribution().catch(() => null),
      fetch("https://rest-coreum.ecostake.com/cosmos/staking/v1beta1/pool")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      getExcludedPSEStake().catch(() => 0),
    ]);

    const value: NetworkInputs = {
      networkTotalScore: net?.networkTotalScore ?? null,
      lastDistTotalScore: lastDist?.totalScore ?? null,
      lastDistributionTimestamp: lastDist?.timestamp ?? 0,
      bondedTokens: Number(pool?.pool?.bonded_tokens ?? 0) / 1_000_000,
      excludedStake,
    };
    cache = { value, at: Date.now() };
    inflight = null;
    return value;
  })();

  return inflight;
}

/**
 * Estimate PSE for a stake and an already-known score.
 *
 * Use this when the caller has the score in hand. `estimatePSEForAddresses`
 * below is the version that fetches scores itself.
 */
export async function estimatePSE(params: {
  stakeTX: number;
  score: string | null;
}): Promise<PSEEstimate> {
  const inputs = await getPSENetworkInputs();
  const r = layeredPSEEstimate({
    userStake: params.stakeTX,
    userScore: params.score,
    networkTotalScore: inputs.networkTotalScore,
    lastDistTotalScore: inputs.lastDistTotalScore,
    bondedTokens: inputs.bondedTokens,
    excludedStake: inputs.excludedStake,
    lastDistributionTimestamp: inputs.lastDistributionTimestamp,
  });
  return { monthly: r.estimate, sharePct: r.sharePct, source: r.source };
}

/**
 * Estimate PSE across one or more addresses.
 *
 * Scores are summed as BigInt: they are raw ucore-seconds and a single large
 * staker already exceeds 2^53, so floating point would round someone's
 * standing. Summing is exact rather than approximate because score is stake
 * multiplied by duration, which is linear, so several wallets score precisely
 * what one wallet holding the same total would.
 */
export async function estimatePSEForAddresses(params: {
  addresses: string[];
  stakeTX: number;
}): Promise<PSEEstimate> {
  const scores = await Promise.all(
    params.addresses.map((a) => fetchOnChainPSEScore(a).catch(() => null)),
  );
  let sum = BigInt(0);
  let any = false;
  for (const s of scores) {
    if (!s) continue;
    try {
      sum += BigInt(s);
      any = true;
    } catch {
      // Unparseable score: skip it rather than poisoning the total.
    }
  }
  return estimatePSE({ stakeTX: params.stakeTX, score: any ? sum.toString() : null });
}
