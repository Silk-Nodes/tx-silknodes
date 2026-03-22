import type { PSEConfig, PSEProjection, CalculatorInputs } from "./types";

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
export const PSE_EXCLUDED_ADDRESSES: string[] = [
  // PSE module / non-distributed tokens
  "core17hp75352ankzff4wfctexqsld8ukzh03p6nm8t",
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

// Circulating supply at TGE (excludes 100B PSE pre-mint in module account)
// On-chain total supply is ~101.93B, but ~100B is PSE module balance
const TGE_SUPPLY = 1_927_475_509;

// Total PSE pre-minted in module account
const TOTAL_PSE_PREMINT = 100_000_000_000; // 100B TX

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
 * Estimate PSE reward for a single staker for next distribution.
 *
 * IMPORTANT: This is an ESTIMATE because we cannot know the exact
 * total score (Σ(S × T)) of all stakers. We approximate by assuming
 * the user's share is proportional to their stake vs total bonded tokens,
 * weighted by their staking duration vs average duration.
 *
 * For exact PSE rewards, the on-chain PSE module must be queried.
 *
 * @param stakedAmount - User's staked amount in TX
 * @param totalBondedTokens - Total bonded tokens on chain in TX
 * @param stakingDurationDays - How many days the user has been staking this period
 * @param avgDurationDays - Average staking duration across all stakers (default: full month)
 */
export function estimateNextPSEReward(
  stakedAmount: number,
  totalBondedTokens: number,
  stakingDurationDays: number = 30,
  avgDurationDays: number = 30
): number {
  if (totalBondedTokens <= 0 || stakedAmount <= 0) return 0;

  // User's score = stake × duration (in seconds)
  const userScore = stakedAmount * (stakingDurationDays * 24 * 3600);

  // Estimate total score = totalBonded × avgDuration (in seconds)
  const estimatedTotalScore = totalBondedTokens * (avgDurationDays * 24 * 3600);

  if (estimatedTotalScore <= 0) return 0;

  // PSE reward = (userScore / totalScore) × communityDistribution
  const communityDistribution = PSE_CONFIG.monthlyEmission; // ~476.19M TX
  return (userScore / estimatedTotalScore) * communityDistribution;
}

/**
 * Estimate PSE reward assuming user stakes for full distribution period.
 *
 * Improved accuracy: subtracts excluded addresses' stake from denominator.
 * PSE-excluded addresses (foundation, modules, etc.) do NOT receive community PSE,
 * so the effective pool of competing stakers is smaller → rewards per staker are higher.
 *
 * Result = (stakedAmount / pseEligibleBonded) × 476,190,476 TX
 *
 * NOTE: This is still an estimate. Real PSE uses duration-weighted scores.
 * For exact calculation, use tx-pse.today which iterates all ~10K delegators.
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

/**
 * Calculate the on-chain staking APR from current inflation and staking ratio.
 * APR = (inflationRate × (1 - communityTax)) / stakingRatio
 *
 * Note: This is SEPARATE from PSE rewards. This is standard Cosmos SDK
 * inflation-based staking reward.
 */
export function calculateStakingAPR(
  inflationRate: number,
  stakingRatio: number, // as decimal, e.g., 0.40
  communityTax: number = 0.05
): number {
  if (stakingRatio <= 0) return 0;
  return (inflationRate * (1 - communityTax)) / stakingRatio;
}

/**
 * Generate 84-month PSE projection.
 *
 * DISCLAIMER: This projection uses simplified assumptions:
 * - Assumes user stakes for full period each month (duration = 30 days)
 * - Assumes total bonded tokens grow linearly with PSE distributions
 * - PSE rewards auto-compound (delivered as new delegations per whitepaper)
 * - Native staking inflation rewards also compound
 * - Price and staking ratio interpolated linearly to target
 *
 * Real results will vary based on actual network conditions.
 */
export function calculatePSEProjection(inputs: CalculatorInputs): PSEProjection[] {
  const projections: PSEProjection[] = [];

  let userBag = inputs.stakedAmount;
  // inputs.currentSupply is CIRCULATING supply (excl PSE module)
  let circulatingSupply = inputs.currentSupply || TGE_SUPPLY;

  // Total on-chain supply = circulating + undistributed PSE in module
  // PSE distributions already done before projection starts
  const pseInfo = getPSEDistributionInfo();
  const distributionsDone = Math.max(0, pseInfo.distributionNumber - 1);
  const pseRemainingAtStart = TOTAL_PSE_PREMINT - (distributionsDone * TOTAL_MONTHLY_PSE);
  let totalOnChain = circulatingSupply + Math.max(0, pseRemainingAtStart);

  const currentInflation = inputs.currentInflation || PSE_CONFIG.inflationRate;

  // PSE remaining months from now (some distributions already happened)
  const pseMonthsRemaining = Math.max(0, 84 - distributionsDone);
  // Project for the remaining PSE months (not a fixed 84 from now)
  const projectionMonths = Math.max(pseMonthsRemaining, 12); // at least 12 months

  for (let month = 1; month <= projectionMonths; month++) {
    // Interpolate staking ratio and price linearly over projection period
    const progress = month / projectionMonths;
    const stakingRatioPct =
      inputs.currentStakingRatio +
      (inputs.targetStakingRatio - inputs.currentStakingRatio) * progress;
    const stakingRatio = stakingRatioPct / 100;
    const txPrice =
      inputs.currentPrice +
      (inputs.targetPrice - inputs.currentPrice) * progress;

    // Inflation adjusts toward goal_bonded=67% (Cosmos SDK mechanism)
    // Note: bonded/totalOnChain ratio drives SDK inflation adjustment
    const bondedRatioOnChain = (circulatingSupply * stakingRatio) / totalOnChain;
    const goalBonded = 0.67;
    let effectiveInflation = currentInflation;
    if (bondedRatioOnChain < goalBonded) {
      // Below goal → inflation increases (up to max 2%)
      effectiveInflation = Math.min(0.02, currentInflation + 0.005 * (month / 12));
    } else {
      effectiveInflation = Math.max(0, currentInflation - 0.001 * (month / 12));
    }

    // APR: Cosmos SDK applies inflation to TOTAL on-chain supply, distributes to bonded
    // annualProvisions = effectiveInflation × totalOnChain
    // APR = annualProvisions × (1-tax) / bondedTokens
    const totalBonded = circulatingSupply * stakingRatio;
    const annualProvisions = effectiveInflation * totalOnChain;
    const stakingAPR = totalBonded > 0
      ? (annualProvisions * (1 - 0.05)) / totalBonded
      : 0;
    const monthlyStakingReward = userBag * (stakingAPR / 12);

    // PSE reward only if distributions still active
    const hasPSE = month <= pseMonthsRemaining;
    const pseReward = hasPSE
      ? estimatePSERewardFullPeriod(userBag, totalBonded)
      : 0;

    // End of month: PSE distributed (moves from module to stakers)
    if (hasPSE) {
      circulatingSupply += TOTAL_MONTHLY_PSE;
    }
    // Inflation minting adds to totalOnChain
    totalOnChain += (effectiveInflation * totalOnChain) / 12;

    // Compound: PSE rewards are auto-staked per whitepaper
    userBag += monthlyStakingReward + pseReward;

    projections.push({
      month,
      emission: PSE_CONFIG.monthlyEmission,
      approxSupply: Math.round(circulatingSupply),
      bagSize: Math.round(userBag),
      stakingRatio: Math.round(stakingRatioPct),
      apr: parseFloat((stakingAPR * 100).toFixed(2)),
      stakingRewards: parseFloat(monthlyStakingReward.toFixed(2)),
      pseReward: Math.round(pseReward),
      txPrice: parseFloat(txPrice.toFixed(4)),
      bagValueUsd: Math.round(userBag * txPrice),
      monthlyPseRewardUsd: Math.round(pseReward * txPrice),
    });
  }

  return projections;
}

/**
 * Calculate summary projections for display
 */
export function getProjectionSummary(inputs: CalculatorInputs) {
  const projections = calculatePSEProjection(inputs);

  const month1 = projections[0];
  const month12 = projections[11];
  const lastMonth = projections[projections.length - 1];

  // How many months remaining in PSE cycle
  const pseInfo = getPSEDistributionInfo();
  const distributionsDone = Math.max(0, pseInfo.distributionNumber - 1);
  const pseMonthsRemaining = Math.max(0, 84 - distributionsDone);

  return {
    oneMonth: {
      baseYield: Math.round(month1?.stakingRewards || 0),
      pseBonus: Math.round(month1?.pseReward || 0),
      totalBag: Math.round(month1?.bagSize || inputs.stakedAmount),
    },
    oneYear: {
      baseYield: Math.round(
        projections.slice(0, 12).reduce((s, p) => s + p.stakingRewards, 0)
      ),
      pseBonus: Math.round(
        projections.slice(0, 12).reduce((s, p) => s + p.pseReward, 0)
      ),
      totalBag: Math.round(month12?.bagSize || inputs.stakedAmount),
    },
    fullCycle: {
      baseYield: Math.round(
        projections.reduce((s, p) => s + p.stakingRewards, 0)
      ),
      pseBonus: Math.round(
        projections.reduce((s, p) => s + p.pseReward, 0)
      ),
      totalBag: Math.round(lastMonth?.bagSize || inputs.stakedAmount),
    },
    projections,
    pseMonthsRemaining,
    totalProjectionMonths: projections.length,
  };
}

/**
 * Get PSE distribution info
 */
export function getPSEDistributionInfo() {
  // TGE date: March 6, 2026 (SOLO + Coreum merge → TX)
  // PSE started at TGE — first distribution is month 1
  const TGE_DATE = new Date("2026-03-06T00:00:00Z");
  const DISTRIBUTION_DAY = TGE_DATE.getDate(); // 6th of each month

  const now = new Date();
  let nextDistribution = new Date(
    now.getFullYear(),
    now.getMonth(),
    DISTRIBUTION_DAY
  );

  // If we've passed this month's distribution, go to next month
  if (now >= nextDistribution) {
    nextDistribution = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      DISTRIBUTION_DAY
    );
  }

  // Calculate which distribution number this is
  const monthsSinceTGE =
    (nextDistribution.getFullYear() - TGE_DATE.getFullYear()) * 12 +
    (nextDistribution.getMonth() - TGE_DATE.getMonth());
  const distributionNumber = Math.min(monthsSinceTGE, 84);
  const progressPercent = Math.round((distributionNumber / 84) * 100);

  // End date: 84 months from TGE
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
