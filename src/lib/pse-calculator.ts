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
