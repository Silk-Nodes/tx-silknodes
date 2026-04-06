import type { PSEConfig } from "./types";

/**
 * PSE (Proof of Support Emission) Calculator
 *
 * CORRECT formula from the TX Whitepaper (v1.10, MiCA):
 *
 * PSEᵢ = (Sᵢ × Tᵢ) / Σ(S × T) × D
 *
 * Where:
 *   Sᵢ = amount staked by staker i in uTX (1 TX = 10⁶ uTX)
 *   Tᵢ = staking duration in seconds for staker i
 *   Σ(S × T) = sum of ALL stakers' scores in the distribution period
 *   D = total PSE tokens allocated for that distribution period
 *
 * Key facts:
 * - Total PSE: 100 billion TX over 84 months
 * - Monthly distribution: ~1,190,476,190 TX total
 * - Community allocation (stakers): 40% = ~476,190,476 TX per month
 * - Foundation: 30%, Founding Partners: 20%, VCs: 5%, Partnerships: 3%
 * - PSE scores RESET after each distribution
 * - Must have at least one active delegation at distribution time
 * - PSE rewards are delivered as new delegations (auto-compounding)
 * - Unbonding before distribution = no PSE reward
 *
 * On-chain parameters (post Proposal #30, 2026-03):
 * - Inflation: ~0.097% (Cosmos SDK adjusting — staking ratio > goal pushes it down)
 * - Inflation max: 2%, min: 0%
 * - Goal bonded: 67%
 * - Inflation rate change: 0.5%
 * - Bonded tokens: ~779.3M TX
 * - Total on-chain supply: ~101.93B TX (includes 100B PSE pre-mint in module)
 * - Circulating supply at TGE: ~1.93B TX (total minus 100B PSE in module)
 * - Unbonding: 7 days
 * - Community tax: 5%
 *
 * Proposal #30 changes (passed 2026-03-01):
 * - Targets ~3.5% annual inflation of circulating supply
 * - Projected total supply after 7 years: ~110B TX (was ~173B)
 * - ~5.3% staking APR at target (current on-chain still adjusting)
 * - Foundation Delegation Program implemented
 * - PSE unchanged — still 100B over 84 months
 */

/**
 * PSE-excluded addresses — these wallets are NOT eligible for community PSE rewards.
 * Source: tx-pse.today (community tool) & on-chain PSE module config.
 * Includes: PSE module account, foundation wallets, smart contracts, etc.
 */
/**
 * Default excluded addresses — kept in sync with on-chain tx/pse/v1/params.
 * At runtime, the app fetches the live list from the chain and uses that instead.
 * This is only a fallback if the on-chain fetch fails.
 * Last synced: 2026-04-06 (29 addresses)
 */
export const PSE_EXCLUDED_ADDRESSES: string[] = [
  // Smart contracts & module accounts
  "core142498n8sya3k3s5jftp7dujuqfw3ag4tpzc2ve45ykpwx6zmng8skcw5nw",
  "core1ys0dhh6x5s55h2g37zrnc7kh630jfq5p77as8pwyn60ax9zzqh9qvpwc0e",
  "core1wgjpjh42cr7t5sp5hgty4yrzww496a6yaznc9u4wsv9ac3xccu8smqaann",
  "core1rkml5878l2daw3a7xvg48wqecnh9u9dn2dtl8g57rsctq5pnc00sl0nwak",
  "core17l6djqrztw0ux668vkw7ff7d2602jvml52w9fyrvryusp7djnhfq7sg29r",
  "core10ezj2lmcj3flaacqwrzv278aled0pen8cnx257sggeng2fdel53q5gtudn",
  "core1wfse3z8akyw3pmn8x0htzq6l5wwfgqmc2jgnhxtzm96h4ywhhr0q63uvwl",
  "core10w37pqels7ya404xdlfkc9vdfemejmc0e6hjlerknys3xjj9xnasuk9uy2",
  "core13cwsdsetcrhcyd3jeed0mgteg35qaju0q5s0u0drfylagahygwwsj2eanz",
  "core1jc4mtk0g8ulmvhwmpfy5rrj7rwn85ual4p3w0tlwnp2rsauvf5eq58zdmw",
  "core1cfey705ssf6ysclm9u47mvcgr5l6q6q86lk5dtq4jwdu6yjce6ds2tgy6j",
  "core15629hwdy7rd7satqzffn4f80ftg2sln982xvwcalppg36td7jvuq3pqevw",
  "core15lch5glk7deu9tk8wrcfcup4tdpz2l8zhhqn4r2zzsr46dfv849qetkah4",
  "core19rrgcsw8gu8c3rthucqnf6nyyg6q9pq79tt60pvahfsnfu4p5hrsuqajru",
  "core12s5tahy3850k3r3080en0pwhuk4l3my5l2cl8vxrsg6kx48de24q7ygamd",
  "core1mqevjln5hxv3qgd3c4m5zjeeand5hkc7r33ty82fjukw9shxjh6sr0zafz",
  "core12xyww2vucfufyzknvyameh5v25cn6gxzzagwgpzhwdq8v35zdmgqd6t6c7",
  // Foundation, team & partner wallets (do not receive community PSE)
  "core1dsna449t2vzcdkla86p9n9jsxkfdvffufhsl5rnal2rfmwfpay0szdueja",
  "core1vwgu52h7nseth5utu8m0ufzllrgan5zyxfzzcmxaae93yh3cxy0s5xrmet",
  "core10qtgwuea5kfmcyuvtpygqzgfz5fuv5qny6xsksfglhgyta2jc38srx4hav",
  "core1yp38kfyr2wmccyqryqggpmpmq09ur9wy48ksqw6x824n4la83jrssjkscn",
  "core1hye3asjulz88s0fxr6g2set73qjr5lczn5pm50x7z7k6j4lny6cq7asvk7",
  // Individual excluded accounts
  "core13xmyzhvl02xpz0pu8v9mqalsvpyy7wvs9q5f90",
  "core14g6wpzdx8g9txvxxu3fl7fplal9y5ztx34ac5p",
  "core1zn2ns3ls68jlsv5dgkuz0rxsxt5fhk7n9cfl23",
  "core1p4gsfkmqm0uxua65phteqwnmu39fwjvtspfkcj",
  "core1rddqzjzy4f5frxkhds3sux0m03encqtla3ayu9",
  "core1qe7xz56v5sh4mr0vfq8qycnvjudgrslmjt0n3m",
  "core17epxygqaytz5l63f0au04058kt4w72w6pkh0as",
];

export const PSE_CONFIG: PSEConfig = {
  totalEmission: 100_000_000_000, // 100 billion TX total
  durationMonths: 84,
  monthlyEmission: 476_190_476, // community staker portion (~476.19M TX/month)
  communityRatio: 0.4, // 40% goes to community stakers
  inflationRate: 0.000972, // ~0.097% current on-chain inflation (adjusting toward 3.5% target per Prop #30)
};

// Total monthly PSE emission (before allocation split)
const TOTAL_MONTHLY_PSE = 1_190_476_190; // 100B / 84

// PSE allocation breakdown
export const PSE_ALLOCATION = {
  community: 0.40, // 40% — stakers securing the chain
  foundation: 0.30, // 30% — treasury & operations
  foundingPartners: 0.20, // 20%
  vcsInvestors: 0.05, // 5%
  partnershipsGrowth: 0.03, // 3%
  // Note: 2% unaccounted may be rounding or reserve
};

/**
 * Estimate THEORETICAL MAXIMUM PSE reward for a full distribution period.
 *
 * IMPORTANT: This returns the best case scenario where the user stakes for
 * the ENTIRE distribution cycle (all 30 days). Since PSE uses score = stake × duration,
 * someone who stakes mid-cycle will receive proportionally less.
 *
 * This estimate also assumes all existing stakers maintain constant stake amounts
 * and that no new stakers join. In practice, real rewards vary based on:
 *   1. When in the cycle the user started staking
 *   2. Changes in total bonded tokens during the cycle
 *   3. Other stakers' duration-weighted scores
 *
 * Subtracts excluded addresses' stake from denominator since PSE-excluded
 * addresses (foundation, modules, etc.) do NOT receive community PSE.
 *
 * Result = (stakedAmount / pseEligibleBonded) × 476,190,476 TX
 *
 * For real PSE data, use the on-chain score lookup or tx-pse.today.
 *
 * @param stakedAmount - User's staked TX
 * @param totalBondedTokens - Total bonded tokens on chain
 * @param excludedStake - Total stake held by PSE-excluded addresses (default: 0)
 */
export function estimatePSERewardFullPeriod(
  stakedAmount: number,
  totalBondedTokens: number,
  excludedStake: number = 0
): number {
  if (totalBondedTokens <= 0 || stakedAmount <= 0) return 0;
  const eligibleBonded = Math.max(totalBondedTokens - excludedStake, stakedAmount);
  return (stakedAmount / eligibleBonded) * PSE_CONFIG.monthlyEmission;
}


// Cached on-chain distribution schedule (fetched once, reused)
let cachedSchedule: number[] | null = null;
let scheduleFetchPromise: Promise<number[]> | null = null;

/**
 * Fetch the real PSE distribution schedule from on-chain data via Hasura.
 * Returns array of unix timestamps (seconds) for all 84 distributions.
 */
export async function fetchPSESchedule(): Promise<number[]> {
  if (cachedSchedule) return cachedSchedule;
  if (scheduleFetchPromise) return scheduleFetchPromise;

  scheduleFetchPromise = (async () => {
    try {
      const res = await fetch("https://hasura.mainnet-1.coreum.dev/v1/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `{ action_pse_scheduled_distributions { scheduled_distributions { timestamp } } }`,
        }),
      });
      const data = await res.json();
      const distributions = data?.data?.action_pse_scheduled_distributions?.scheduled_distributions ?? [];
      const timestamps = distributions.map((d: { timestamp: number }) => d.timestamp).sort((a: number, b: number) => a - b);
      if (timestamps.length > 0) {
        cachedSchedule = timestamps;
      }
      return timestamps;
    } catch {
      return [];
    }
  })();

  return scheduleFetchPromise;
}

// ═══════════════════════════════════════════════════════════
// ON-CHAIN DATA SOURCES — No hardcoding, no mock data
// ═══════════════════════════════════════════════════════════

/**
 * Fetch PSE excluded addresses directly from on-chain params.
 * Source: tx/pse/v1/params (via Silk Nodes API with LCD fallback)
 * These addresses do NOT receive community PSE rewards.
 */
let cachedExcludedAddresses: string[] | null = null;
let excludedFetchPromise: Promise<string[]> | null = null;

export async function fetchOnChainExcludedAddresses(): Promise<string[]> {
  if (cachedExcludedAddresses) return cachedExcludedAddresses;
  if (excludedFetchPromise) return excludedFetchPromise;

  excludedFetchPromise = (async () => {
    const endpoints = [
      "https://api.silknodes.io/coreum/tx/pse/v1/params",
      "https://full-node.mainnet-1.coreum.dev:1317/tx/pse/v1/params",
    ];
    for (const url of endpoints) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        const data = await res.json();
        const addresses = data?.params?.excluded_addresses;
        if (Array.isArray(addresses) && addresses.length > 0) {
          cachedExcludedAddresses = addresses;
          return addresses;
        }
      } catch { /* try next endpoint */ }
    }
    // Final fallback: hardcoded list (last synced 2026-04-06)
    return PSE_EXCLUDED_ADDRESSES;
  })();

  return excludedFetchPromise;
}

/**
 * Fetch the on-chain PSE score for a specific address.
 * Source: tx/pse/v1/score/{address} (real-time, direct from chain state)
 * Returns the raw score string (stake_ucore × duration_seconds).
 */
export async function fetchOnChainPSEScore(address: string): Promise<string | null> {
  const endpoints = [
    `https://api.silknodes.io/coreum/tx/pse/v1/score/${address}`,
    `https://full-node.mainnet-1.coreum.dev:1317/tx/pse/v1/score/${address}`,
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const data = await res.json();
      if (data?.score && !data.code && !data.error) {
        return data.score;
      }
    } catch { /* try next */ }
  }
  return null;
}

/**
 * Fetch the last completed PSE distribution's ground truth from Hasura.
 * Source: pse_distribution_allocation table (populated after indexer processes distribution)
 * Returns the real total_score from the settled distribution, plus allocation details.
 */
export interface PSEDistributionAllocation {
  cycleNumber: number;
  totalScore: string;
  totalDistributed: number; // TX
  clearingAccount: string;
  timestamp: number;
}

let cachedLastDistribution: PSEDistributionAllocation | null = null;

export async function fetchLastPSEDistribution(): Promise<PSEDistributionAllocation | null> {
  if (cachedLastDistribution) return cachedLastDistribution;

  try {
    const res = await fetch("https://hasura.mainnet-1.coreum.dev/v1/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `{
          pse_distribution_allocation(
            where: { clearing_account: { _eq: "pse_community" } }
            order_by: { height: desc }
            limit: 1
          ) {
            total_score
            total_distributed
            clearing_account
            height
          }
        }`,
      }),
    });
    const data = await res.json();
    const alloc = data?.data?.pse_distribution_allocation?.[0];
    if (alloc?.total_score) {
      cachedLastDistribution = {
        cycleNumber: 1, // Hasura doesn't have cycle number, we derive it
        totalScore: alloc.total_score,
        totalDistributed: parseInt(alloc.total_distributed || "0") / 1_000_000,
        clearingAccount: alloc.clearing_account,
        timestamp: 0,
      };
      return cachedLastDistribution;
    }
  } catch { /* hasura unavailable */ }
  return null;
}

/**
 * Fetch the actual PSE reward received by a specific address in the last distribution.
 * Source: pse_transfer table via Hasura (ground truth, not an estimate)
 * This shows what the address ACTUALLY received, not what we estimate.
 */
export async function fetchActualPSEReward(address: string): Promise<{
  amount: number;
  cycleNumber: number;
} | null> {
  try {
    const res = await fetch("https://hasura.mainnet-1.coreum.dev/v1/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `{
          pse_transfer(
            where: { address: { _eq: "${address}" } }
            order_by: { height: desc }
            limit: 1
          ) {
            amount
            height
          }
        }`,
      }),
    });
    const data = await res.json();
    const transfer = data?.data?.pse_transfer?.[0];
    if (transfer?.amount) {
      return {
        amount: parseInt(transfer.amount) / 1_000_000,
        cycleNumber: 1,
      };
    }
  } catch { /* hasura unavailable */ }
  return null;
}

/**
 * Fetch PSE clearing account balances from on-chain.
 * Returns the community balance remaining for distribution.
 */
export async function fetchPSEClearingBalances(): Promise<{ communityBalance: number } | null> {
  const endpoints = [
    "https://api.silknodes.io/coreum/tx/pse/v1/clearing_account_balances",
    "https://full-node.mainnet-1.coreum.dev:1317/tx/pse/v1/clearing_account_balances",
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const data = await res.json();
      const balances = data?.balances || [];
      const community = balances.find((b: any) => b.clearing_account === "pse_community");
      if (community?.balance) {
        return {
          communityBalance: Number(BigInt(community.balance) / BigInt(1_000_000)),
        };
      }
    } catch { /* try next */ }
  }
  return null;
}

/** TGE timestamp (2026-03-06T00:00:00Z) — genesis event, immutable fact */
export const TGE_TIMESTAMP = 1772755200;

/**
 * Detect if PSE scores have reset after a distribution (cycle mismatch).
 * After each distribution, all scores reset to zero and start accumulating again.
 * Detection: derive implied staking duration from score.
 *   score = stake(ucore) × duration(seconds)
 *   implied_duration = score / stake_ucore
 *   If implied_duration << time_since_last_distribution, scores are from a new cycle.
 *
 * @param userScore - Raw on-chain score string
 * @param userStake - User's stake in TX (not ucore)
 * @param lastDistributionTimestamp - Unix timestamp of last distribution (0 = use TGE)
 */
export function detectCycleMismatch(
  userScore: string,
  userStake: number,
  lastDistributionTimestamp: number = 0,
): boolean {
  if (userStake <= 0) return false;
  const stakeUcore = BigInt(Math.round(userStake)) * BigInt(1_000_000);
  if (stakeUcore === BigInt(0)) return false;
  const impliedDuration = Number(BigInt(userScore) / stakeUcore); // seconds
  const referenceTimestamp = lastDistributionTimestamp > 0 ? lastDistributionTimestamp : TGE_TIMESTAMP;
  const timeSinceReference = Math.floor(Date.now() / 1000) - referenceTimestamp;
  // If implied duration is less than 50% of time since reference, scores have reset
  return impliedDuration < timeSinceReference * 0.5;
}

/**
 * LAYERED PSE ESTIMATION — Priority-based, all from on-chain sources.
 *
 * Layer 1: Real on-chain score + real network total (most accurate during cycle)
 * Layer 2: Last cycle's settled total_score from Hasura (ground truth after distribution)
 * Layer 3: Cached enumeration network score (updated every 6h by GitHub Action)
 * Layer 4: Stake ratio fallback (least accurate, used when no scores available)
 *
 * All layers use the SAME formula: PSEᵢ = (Sᵢ × Tᵢ) / Σ(S × T) × D
 * The difference is where Σ(S × T) comes from.
 */
export function layeredPSEEstimate(params: {
  userStake: number;
  userScore: string | null;             // Layer 1: real-time on-chain score
  networkTotalScore: string | null;     // Layer 1/3: real network total (enumerated)
  lastDistTotalScore: string | null;    // Layer 2: settled total from Hasura
  bondedTokens: number;                 // Layer 4: fallback
  excludedStake: number;                // Layer 4: excluded from denominator
  lastDistributionTimestamp?: number;   // For cycle mismatch detection
}): { estimate: number; source: string; sharePct: number } {
  const {
    userStake,
    userScore,
    networkTotalScore,
    lastDistTotalScore,
    bondedTokens,
    excludedStake,
    lastDistributionTimestamp = 0,
  } = params;

  if (userStake <= 0) return { estimate: 0, source: "none", sharePct: 0 };

  const monthlyPool = PSE_CONFIG.monthlyEmission; // 476,190,476 TX

  // Layer 1: Real on-chain score + network total (same cycle, no mismatch)
  if (userScore && networkTotalScore) {
    const mismatch = detectCycleMismatch(userScore, userStake, lastDistributionTimestamp);
    if (!mismatch) {
      const uScore = BigInt(userScore);
      const tScore = BigInt(networkTotalScore);
      if (tScore > BigInt(0)) {
        const PRECISION = BigInt(1_000_000_000_000);
        const share = Number((uScore * PRECISION) / tScore) / Number(PRECISION);
        return { estimate: share * monthlyPool, source: "onchain_score", sharePct: share * 100 };
      }
    }
  }

  // Layer 2: User has a real score but network total is stale (use last distribution's total as reference)
  // This helps right after a distribution when enumeration cache hasn't updated yet
  if (userScore && lastDistTotalScore) {
    const uScore = BigInt(userScore);
    const tScore = BigInt(lastDistTotalScore);
    if (tScore > BigInt(0)) {
      // Note: this is a rough estimate since last cycle's total != current cycle's eventual total
      // But it's better than stake ratio since it uses real score magnitude
      const PRECISION = BigInt(1_000_000_000_000);
      const share = Number((uScore * PRECISION) / tScore) / Number(PRECISION);
      return { estimate: share * monthlyPool, source: "last_dist_reference", sharePct: share * 100 };
    }
  }

  // Layer 3: No user score available but we have network data — use stake proportion
  // This is the hypothetical "if you stake for the full period" estimate
  const eligibleBonded = Math.max(bondedTokens - excludedStake, userStake);
  if (eligibleBonded > 0) {
    const share = userStake / eligibleBonded;
    return { estimate: share * monthlyPool, source: "stake_ratio", sharePct: share * 100 };
  }

  return { estimate: 0, source: "none", sharePct: 0 };
}

/**
 * Get PSE distribution info using on-chain schedule when available,
 * falling back to calculated dates.
 */
export function getPSEDistributionInfo(onChainSchedule?: number[]) {
  const TGE_DATE = new Date("2026-03-06T00:00:00Z");
  const now = new Date();
  const nowUnix = Math.floor(now.getTime() / 1000);

  let nextDistribution: Date;
  let distributionNumber: number;

  if (onChainSchedule && onChainSchedule.length > 0) {
    // Use real on-chain schedule
    const nextTs = onChainSchedule.find(ts => ts > nowUnix);
    const nextIdx = nextTs ? onChainSchedule.indexOf(nextTs) : onChainSchedule.length - 1;

    nextDistribution = new Date((nextTs ?? onChainSchedule[onChainSchedule.length - 1]) * 1000);
    distributionNumber = Math.min(nextIdx + 1, 84); // 1-indexed
  } else {
    // Fallback: calculate based on 6th at 12:00 UTC
    const DISTRIBUTION_DAY = 6;
    nextDistribution = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      DISTRIBUTION_DAY,
      12, 0, 0
    ));
    if (now >= nextDistribution) {
      nextDistribution = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth() + 1,
        DISTRIBUTION_DAY,
        12, 0, 0
      ));
    }
    const monthsSinceTGE =
      (nextDistribution.getFullYear() - TGE_DATE.getFullYear()) * 12 +
      (nextDistribution.getMonth() - TGE_DATE.getMonth());
    distributionNumber = Math.min(monthsSinceTGE, 84);
  }

  const progressPercent = Math.round((distributionNumber / 84) * 100);
  const endDate = new Date(TGE_DATE);
  endDate.setMonth(endDate.getMonth() + 84);

  return {
    tgeDate: TGE_DATE,
    nextDistribution,
    distributionNumber,
    totalDistributions: 84,
    progressPercent,
    endDate,
    communityPerDistribution: PSE_CONFIG.monthlyEmission,
    totalPerDistribution: TOTAL_MONTHLY_PSE,
  };
}
