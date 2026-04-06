import type { TokenData, StakingData, ValidatorInfo, NetworkStatus } from "./types";
import { SILK_LCD, SILK_RPC, COIN_DECIMALS, fetchWithTimeout } from "./chain-config";
import { getPSEDistributionInfo, PSE_EXCLUDED_ADDRESSES } from "./pse-calculator";

const COINGECKO_API = "https://api.coingecko.com/api/v3";
const COINGECKO_ID = "tx"; // Changed from "coreum" after SOLO+Coreum merge (March 6, 2026)

// Total PSE pre-minted at TGE (held in PSE module, distributed over 84 months)
const TOTAL_PSE_PREMINT = 100_000_000_000; // 100B TX
const TOTAL_MONTHLY_PSE_ALL = 1_190_476_190; // 100B / 84 (all allocations)

function toDisplay(amount: string | number): number {
  return parseInt(String(amount)) / Math.pow(10, COIN_DECIMALS);
}

/**
 * Calculate circulating supply from on-chain total supply.
 * Circulating = Total on-chain supply - undistributed PSE remaining in module.
 * PSE tokens are pre-minted but held by the PSE module until monthly distribution.
 */
function calculateCirculatingSupply(totalOnChainSupply: number): number {
  const pseInfo = getPSEDistributionInfo();
  const distributionsDone = Math.max(0, pseInfo.distributionNumber - 1); // distributions already completed
  const pseDistributed = distributionsDone * TOTAL_MONTHLY_PSE_ALL;
  const pseRemaining = Math.max(0, TOTAL_PSE_PREMINT - pseDistributed);
  return totalOnChainSupply - pseRemaining;
}

// Official TX chain data API for circulating supply
const TX_CHAIN_API = "https://api.mainnet-1.tx.org/api/chain-data/v1";

// === Token Price & Market Data (CoinGecko + official TX API + on-chain supply) ===
export async function fetchTokenData(): Promise<TokenData> {
  try {
    const [cgRes, supplyRes, txCircRes] = await Promise.allSettled([
      fetchWithTimeout(`${COINGECKO_API}/coins/${COINGECKO_ID}?localization=false&tickers=false&community_data=false&developer_data=false`),
      fetchWithTimeout(`${SILK_LCD}/cosmos/bank/v1beta1/supply/by_denom?denom=ucore`),
      fetchWithTimeout(`${TX_CHAIN_API}/circulating-supply`),
    ]);

    const cgData = cgRes.status === "fulfilled" ? await cgRes.value.json() : null;
    const supplyData = supplyRes.status === "fulfilled" ? await supplyRes.value.json() : null;

    const price = cgData?.market_data?.current_price?.usd ?? 0;
    const priceChange24h = cgData?.market_data?.price_change_percentage_24h ?? 0;
    const volume24h = cgData?.market_data?.total_volume?.usd ?? 0;

    // Total on-chain supply (includes 100B PSE module)
    const totalOnChain = supplyData?.amount?.amount
      ? toDisplay(supplyData.amount.amount)
      : (cgData?.market_data?.total_supply ?? 0);

    // Circulating supply priority: 1) Official TX API, 2) CoinGecko, 3) calculated
    const txCirculating = txCircRes.status === "fulfilled"
      ? parseFloat(await txCircRes.value.text())
      : 0;
    const cgCirculating = cgData?.market_data?.circulating_supply ?? 0;
    const circulatingSupply = txCirculating > 0
      ? txCirculating
      : cgCirculating > 0
        ? cgCirculating
        : calculateCirculatingSupply(totalOnChain);

    // Use CoinGecko market cap directly to match what users see
    const cgMarketCap = cgData?.market_data?.market_cap?.usd ?? 0;
    const marketCap = cgMarketCap > 0 ? cgMarketCap : price * circulatingSupply;

    return {
      price,
      priceChange24h,
      marketCap,
      totalSupply: totalOnChain,
      circulatingSupply,
      volume24h,
    };
  } catch (err) {
    console.error("Failed to fetch token data:", err);
    return { price: 0, priceChange24h: 0, marketCap: 0, totalSupply: 0, circulatingSupply: 0, volume24h: 0 };
  }
}

// === Fetch total stake of PSE-excluded addresses ===
async function fetchExcludedPSEStake(): Promise<number> {
  try {
    // Fetch delegations for all excluded addresses in parallel (batched)
    const batchSize = 5;
    let totalExcluded = 0;

    for (let i = 0; i < PSE_EXCLUDED_ADDRESSES.length; i += batchSize) {
      const batch = PSE_EXCLUDED_ADDRESSES.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (addr) => {
          try {
            const res = await fetchWithTimeout(
              `${SILK_LCD}/cosmos/staking/v1beta1/delegations/${addr}?pagination.limit=200`
            );
            const data = await res.json();
            const delegations = data.delegation_responses || [];
            return delegations.reduce(
              (sum: number, d: any) => sum + toDisplay(d.balance?.amount || "0"),
              0
            );
          } catch {
            return 0;
          }
        })
      );
      totalExcluded += results.reduce((s, v) => s + v, 0);
    }

    return Math.round(totalExcluded);
  } catch (err) {
    console.error("Failed to fetch excluded PSE stake:", err);
    return 0;
  }
}

// === Staking Data (TX LCD) ===
export async function fetchStakingData(): Promise<StakingData> {
  try {
    const [poolRes, inflationRes, provisionsRes, distRes, valCountRes, supplyRes] = await Promise.allSettled([
      fetchWithTimeout(`${SILK_LCD}/cosmos/staking/v1beta1/pool`),
      fetchWithTimeout(`${SILK_LCD}/cosmos/mint/v1beta1/inflation`),
      fetchWithTimeout(`${SILK_LCD}/cosmos/mint/v1beta1/annual_provisions`),
      fetchWithTimeout(`${SILK_LCD}/cosmos/distribution/v1beta1/params`),
      fetchWithTimeout(`${SILK_LCD}/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.count_total=true&pagination.limit=1`),
      fetchWithTimeout(`${SILK_LCD}/cosmos/bank/v1beta1/supply/by_denom?denom=ucore`),
    ]);

    const pool = poolRes.status === "fulfilled" ? await poolRes.value.json() : {};
    const inflation = inflationRes.status === "fulfilled" ? await inflationRes.value.json() : {};
    const provisions = provisionsRes.status === "fulfilled" ? await provisionsRes.value.json() : {};
    const dist = distRes.status === "fulfilled" ? await distRes.value.json() : {};
    const valCount = valCountRes.status === "fulfilled" ? await valCountRes.value.json() : {};
    const supplyData = supplyRes.status === "fulfilled" ? await supplyRes.value.json() : {};

    const bondedTokens = toDisplay(pool.pool?.bonded_tokens || "0");
    const notBondedTokens = toDisplay(pool.pool?.not_bonded_tokens || "0");
    const inflationRate = parseFloat(inflation.inflation || "0");
    const communityTax = parseFloat(dist.params?.community_tax || "0.05");
    const annualProvisions = toDisplay(provisions.annual_provisions || "0");

    // On-chain total supply includes 100B pre-minted PSE tokens in module account
    const totalOnChain = supplyData?.amount?.amount
      ? toDisplay(supplyData.amount.amount)
      : (bondedTokens + notBondedTokens);
    const circulatingSupply = calculateCirculatingSupply(totalOnChain);

    // Staking ratio for DISPLAY: bonded vs circulating supply (meaningful for users)
    const stakingRatio = circulatingSupply > 0 ? (bondedTokens / circulatingSupply) * 100 : 0;

    // APR: Cosmos SDK applies inflation to TOTAL supply, distributes to bonded stakers
    const apr = bondedTokens > 0
      ? (annualProvisions * (1 - communityTax) / bondedTokens) * 100
      : 0;

    // Fetch excluded PSE stake (non-blocking — falls back to 0)
    const excludedPSEStake = await fetchExcludedPSEStake();
    const pseEligibleBonded = Math.max(0, Math.round(bondedTokens) - excludedPSEStake);

    return {
      stakingRatio: parseFloat(stakingRatio.toFixed(2)),
      apr: parseFloat(apr.toFixed(2)),
      inflation: parseFloat((inflationRate * 100).toFixed(4)),
      inflationRaw: inflationRate,
      bondedTokens: Math.round(bondedTokens),
      notBondedTokens: Math.round(notBondedTokens),
      totalValidators: parseInt(valCount.pagination?.total || "0"),
      activeValidators: parseInt(valCount.pagination?.total || "0"),
      annualProvisions: Math.round(annualProvisions),
      communityTax,
      excludedPSEStake,
      pseEligibleBonded,
    };
  } catch (err) {
    console.error("Failed to fetch staking data:", err);
    return {
      stakingRatio: 0, apr: 0, inflation: 0, inflationRaw: 0,
      bondedTokens: 0, notBondedTokens: 0, totalValidators: 0,
      activeValidators: 0, annualProvisions: 0, communityTax: 0.05,
      excludedPSEStake: 0, pseEligibleBonded: 0,
    };
  }
}

// === All Validators ===
export async function fetchAllValidators(txPrice: number = 0): Promise<ValidatorInfo[]> {
  try {
    let allValidators: any[] = [];
    let nextKey: string | null = null;

    // Paginate through all bonded validators
    do {
      const fetchUrl: string = nextKey
        ? `${SILK_LCD}/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=100&pagination.key=${encodeURIComponent(nextKey)}`
        : `${SILK_LCD}/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=100`;
      const fetchRes: Response = await fetchWithTimeout(fetchUrl);
      const fetchData: any = await fetchRes.json();
      allValidators = allValidators.concat(fetchData.validators || []);
      nextKey = fetchData.pagination?.next_key || null;
    } while (nextKey);

    // Fetch annual provisions and community tax in parallel
    const [provisionsRes, distRes] = await Promise.all([
      fetchWithTimeout(`${SILK_LCD}/cosmos/mint/v1beta1/annual_provisions`),
      fetchWithTimeout(`${SILK_LCD}/cosmos/distribution/v1beta1/params`),
    ]);
    const provisionsData = await provisionsRes.json();
    const distData = await distRes.json();
    const annualProvisions = toDisplay(provisionsData.annual_provisions || "0");
    const communityTax = parseFloat(distData.params?.community_tax || "0.05");

    // Total bonded for percentage calculation
    const totalBonded = allValidators.reduce(
      (sum: number, v: any) => sum + parseInt(v.tokens || "0"),
      0
    );

    // Annual rewards to validators = annualProvisions × (1 - communityTax)
    const annualRewardsToValidators = annualProvisions * (1 - communityTax);

    return allValidators
      .map((val: any) => {
        const tokens = parseInt(val.tokens || "0") / 1e6;
        const commission = parseFloat(val.commission?.commission_rates?.rate || "0") * 100;
        const tokensPct = totalBonded > 0 ? (parseInt(val.tokens || "0") / totalBonded) * 100 : 0;

        const validatorShare = totalBonded > 0 ? parseInt(val.tokens || "0") / totalBonded : 0;
        const annualValidatorIncome = validatorShare * annualRewardsToValidators * (commission / 100);
        const monthlyIncomeTX = annualValidatorIncome / 12;
        const monthlyIncomeUSD = monthlyIncomeTX * txPrice;

        return {
          moniker: val.description?.moniker || "Unknown",
          operatorAddress: val.operator_address || "",
          commission: parseFloat(commission.toFixed(2)),
          tokens: Math.round(tokens),
          tokensPct: parseFloat(tokensPct.toFixed(2)),
          status: val.status || "",
          description: val.description?.details || "",
          website: val.description?.website || "",
          estimatedMonthlyIncomeUSD: Math.round(monthlyIncomeUSD * 100) / 100,
        };
      })
      .sort((a, b) => b.tokens - a.tokens); // Sort by voting power
  } catch (err) {
    console.error("Failed to fetch validators:", err);
    return [];
  }
}

// === Network Status ===
export async function fetchNetworkStatus(): Promise<NetworkStatus> {
  try {
    const res = await fetchWithTimeout(`${SILK_RPC}/status`);
    const data = await res.json();

    return {
      blockHeight: parseInt(data.result?.sync_info?.latest_block_height || "0"),
      blockTime: data.result?.sync_info?.latest_block_time || "",
      chainId: data.result?.node_info?.network || "coreum-mainnet-1",
    };
  } catch (err) {
    console.error("Failed to fetch network status:", err);
    return { blockHeight: 0, blockTime: "", chainId: "coreum-mainnet-1" };
  }
}
