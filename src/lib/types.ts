// === Chain & Token Data ===
export interface TokenData {
  price: number;
  priceChange24h: number;
  marketCap: number;
  totalSupply: number;
  circulatingSupply: number;
  volume24h: number;
}

export interface StakingData {
  stakingRatio: number; // percentage, e.g. 39.7
  apr: number; // percentage, e.g. 0.22
  inflation: number; // percentage, e.g. 0.093
  inflationRaw: number; // raw decimal, e.g. 0.00093
  bondedTokens: number; // in TX (not ucore)
  notBondedTokens: number;
  totalValidators: number;
  activeValidators: number;
  annualProvisions: number; // in TX
  communityTax: number; // decimal, e.g. 0.05
  excludedPSEStake: number; // TX staked by excluded addresses (not eligible for PSE)
  pseEligibleBonded: number; // bondedTokens - excludedPSEStake
}

export interface ValidatorInfo {
  moniker: string;
  operatorAddress: string;
  commission: number; // percentage
  tokens: number; // in TX
  tokensPct: number; // percentage of total bonded
  status: string;
  description?: string;
  website?: string;
  estimatedMonthlyIncomeUSD?: number;
}

// === PSE (Proof of Support Emission) ===
export interface PSEConfig {
  totalEmission: number; // 100 billion TX over 84 months
  durationMonths: number; // 84
  monthlyEmission: number; // community portion: ~476,190,476 TX
  communityRatio: number; // 0.40 (40%)
  inflationRate: number; // current on-chain inflation (~0.093%)
}

export interface PSEProjection {
  month: number;
  emission: number;
  approxSupply: number;
  bagSize: number;
  stakingRatio: number;
  apr: number;
  stakingRewards: number;
  pseReward: number;
  txPrice: number;
  bagValueUsd: number;
  monthlyPseRewardUsd: number;
}

// === Calculator Inputs ===
export interface CalculatorInputs {
  stakedAmount: number;
  targetStakingRatio: number; // target at month 84 (%)
  targetPrice: number; // target at month 84 (USD)
  currentSupply: number;
  currentStakingRatio: number;
  currentPrice: number;
  currentInflation?: number; // raw decimal
}

// === Wallet ===
export interface WalletState {
  connected: boolean;
  address: string;
  balance: number;
  stakedAmount: number;
  rewards: number;
  delegations: Delegation[];
  unbondingDelegations: UnbondingDelegation[];
  walletType: "keplr" | "leap" | "cosmostation" | "";
}

export interface Delegation {
  validatorAddress: string;
  validatorMoniker: string;
  amount: number;
  rewards: number;
}

export interface UnbondingDelegation {
  validatorAddress: string;
  validatorMoniker: string;
  amount: number;
  completionTime: string; // ISO date
}

// === Network Status ===
export interface NetworkStatus {
  blockHeight: number;
  blockTime: string;
  chainId: string;
}
