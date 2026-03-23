import { SigningStargateClient, StargateClient } from "@cosmjs/stargate";
import type { WalletState, Delegation, UnbondingDelegation } from "./types";
import {
  COREUM_CHAIN_INFO,
  CHAIN_ID,
  DENOM,
  COIN_DECIMALS,
  SILK_LCD,
  suggestChainToKeplr,
} from "./chain-config";

function toDisplay(amount: string | number): number {
  return parseInt(String(amount)) / Math.pow(10, COIN_DECIMALS);
}

const INITIAL_STATE: WalletState = {
  connected: false,
  address: "",
  balance: 0,
  stakedAmount: 0,
  rewards: 0,
  delegations: [],
  unbondingDelegations: [],
  walletType: "",
};

// ── Validator moniker cache ──
let validatorMonikerCache: Record<string, string> = {};
let monikerCacheLoaded = false;

async function loadValidatorMonikers(): Promise<void> {
  if (monikerCacheLoaded) return;
  try {
    let allValidators: any[] = [];
    let nextKey: string | null = null;
    do {
      const url: string = nextKey
        ? `${SILK_LCD}/cosmos/staking/v1beta1/validators?pagination.limit=200&pagination.key=${encodeURIComponent(nextKey)}`
        : `${SILK_LCD}/cosmos/staking/v1beta1/validators?pagination.limit=200`;
      const res = await fetch(url);
      const data = await res.json();
      allValidators = allValidators.concat(data.validators || []);
      nextKey = data.pagination?.next_key || null;
    } while (nextKey);

    for (const v of allValidators) {
      if (v.operator_address && v.description?.moniker) {
        validatorMonikerCache[v.operator_address] = v.description.moniker;
      }
    }
    monikerCacheLoaded = true;
  } catch (err) {
    console.error("Failed to load validator monikers:", err);
  }
}

function resolveMoniker(valAddr: string): string {
  return validatorMonikerCache[valAddr] || valAddr.slice(0, 12) + "...";
}

// ── Detect available wallets ──
export function getAvailableWallets(): { keplr: boolean; leap: boolean } {
  if (typeof window === "undefined") return { keplr: false, leap: false };
  return {
    keplr: !!(window as any).keplr,
    leap: !!(window as any).leap,
  };
}

// ── Get wallet provider (Keplr or Leap) ──
function getWalletProvider(type: "keplr" | "leap") {
  if (typeof window === "undefined") return null;
  if (type === "leap") return (window as any).leap;
  return (window as any).keplr;
}

/**
 * Connect wallet (Keplr or Leap) and return wallet state
 */
export async function connectWallet(walletType: "keplr" | "leap" = "keplr"): Promise<WalletState> {
  if (typeof window === "undefined") {
    throw new Error("Window not available");
  }

  const provider = getWalletProvider(walletType);
  if (!provider) {
    const name = walletType === "leap" ? "Leap" : "Keplr";
    throw new Error(
      `${name} wallet not found. Please install the ${name} browser extension.`
    );
  }

  // Suggest chain (both Keplr and Leap support experimentalSuggestChain)
  try {
    await provider.experimentalSuggestChain(COREUM_CHAIN_INFO as any);
  } catch (err) {
    console.warn("Chain suggest failed (may already be added):", err);
  }

  // Enable chain
  await provider.enable(CHAIN_ID);

  // Get offline signer
  const offlineSigner = provider.getOfflineSigner(CHAIN_ID);
  const accounts = await offlineSigner.getAccounts();

  if (!accounts.length) {
    throw new Error(`No accounts found in ${walletType === "leap" ? "Leap" : "Keplr"}`);
  }

  const address = accounts[0].address;

  // Load validator monikers for name resolution
  await loadValidatorMonikers();

  // Parallel fetch: balance, delegations, rewards, unbonding
  const [balance, delegations, unbondingDelegations] = await Promise.all([
    fetchBalance(address),
    fetchDelegations(address),
    fetchUnbondingDelegations(address),
  ]);

  const stakedAmount = delegations.reduce((sum, d) => sum + d.amount, 0);
  const rewards = delegations.reduce((sum, d) => sum + d.rewards, 0);

  // Persist wallet type for auto-reconnect
  try {
    localStorage.setItem("tx-wallet-type", walletType);
    localStorage.setItem("tx-wallet-connected", "true");
  } catch {}

  return {
    connected: true,
    address,
    balance,
    stakedAmount,
    rewards,
    delegations,
    unbondingDelegations,
    walletType,
  };
}

// Legacy alias
export async function connectKeplr(): Promise<WalletState> {
  return connectWallet("keplr");
}

/**
 * Fetch available balance
 */
async function fetchBalance(address: string): Promise<number> {
  try {
    const client = await StargateClient.connect(COREUM_CHAIN_INFO.rpc);
    const balanceResult = await client.getBalance(address, DENOM);
    client.disconnect();
    return toDisplay(balanceResult.amount);
  } catch (err) {
    console.error("Failed to fetch balance:", err);
    return 0;
  }
}

/**
 * Fetch delegations and rewards via LCD with moniker resolution
 */
async function fetchDelegations(address: string): Promise<Delegation[]> {
  try {
    const [delRes, rewRes] = await Promise.all([
      fetch(`${SILK_LCD}/cosmos/staking/v1beta1/delegations/${address}`),
      fetch(`${SILK_LCD}/cosmos/distribution/v1beta1/delegators/${address}/rewards`),
    ]);

    const delData = await delRes.json();
    const rewData = await rewRes.json();

    const delegations: Delegation[] = [];
    const responses = delData.delegation_responses || [];

    for (const del of responses) {
      const valAddr = del.delegation?.validator_address || "";
      const amount = toDisplay(del.balance?.amount || "0");

      // Find matching reward
      const rewardEntry = (rewData.rewards || []).find(
        (r: any) => r.validator_address === valAddr
      );
      const rewardAmount = rewardEntry?.reward?.[0]?.amount
        ? parseFloat(rewardEntry.reward[0].amount) / Math.pow(10, COIN_DECIMALS)
        : 0;

      delegations.push({
        validatorAddress: valAddr,
        validatorMoniker: resolveMoniker(valAddr),
        amount,
        rewards: rewardAmount,
      });
    }

    return delegations.sort((a, b) => b.amount - a.amount);
  } catch (err) {
    console.error("Failed to fetch delegations:", err);
    return [];
  }
}

/**
 * Fetch unbonding delegations
 */
async function fetchUnbondingDelegations(address: string): Promise<UnbondingDelegation[]> {
  try {
    const res = await fetch(
      `${SILK_LCD}/cosmos/staking/v1beta1/delegators/${address}/unbonding_delegations`
    );
    const data = await res.json();
    const unbonding: UnbondingDelegation[] = [];

    for (const entry of data.unbonding_responses || []) {
      const valAddr = entry.validator_address || "";
      for (const e of entry.entries || []) {
        unbonding.push({
          validatorAddress: valAddr,
          validatorMoniker: resolveMoniker(valAddr),
          amount: toDisplay(e.balance || "0"),
          completionTime: e.completion_time || "",
        });
      }
    }

    return unbonding.sort((a, b) => new Date(a.completionTime).getTime() - new Date(b.completionTime).getTime());
  } catch (err) {
    console.error("Failed to fetch unbonding delegations:", err);
    return [];
  }
}

/**
 * Delegate tokens to a validator
 */
export async function delegateTokens(
  validatorAddress: string,
  amount: number,
  walletType: "keplr" | "leap" = "keplr"
): Promise<string> {
  const provider = getWalletProvider(walletType);
  if (!provider) throw new Error(`${walletType} not available`);

  await provider.enable(CHAIN_ID);
  const offlineSigner = provider.getOfflineSigner(CHAIN_ID);
  const accounts = await offlineSigner.getAccounts();
  const address = accounts[0].address;

  const client = await SigningStargateClient.connectWithSigner(
    COREUM_CHAIN_INFO.rpc,
    offlineSigner
  );

  const amountInMicro = Math.floor(amount * Math.pow(10, COIN_DECIMALS));

  const result = await client.delegateTokens(
    address,
    validatorAddress,
    { denom: DENOM, amount: String(amountInMicro) },
    {
      amount: [{ denom: DENOM, amount: "25000" }],
      gas: "250000",
    },
    "Delegated via tx.silknodes.io"
  );

  client.disconnect();
  return result.transactionHash;
}

/**
 * Undelegate tokens from a validator
 */
export async function undelegateTokens(
  validatorAddress: string,
  amount: number,
  walletType: "keplr" | "leap" = "keplr"
): Promise<string> {
  const provider = getWalletProvider(walletType);
  if (!provider) throw new Error(`${walletType} not available`);

  await provider.enable(CHAIN_ID);
  const offlineSigner = provider.getOfflineSigner(CHAIN_ID);
  const accounts = await offlineSigner.getAccounts();
  const address = accounts[0].address;

  const client = await SigningStargateClient.connectWithSigner(
    COREUM_CHAIN_INFO.rpc,
    offlineSigner
  );

  const amountInMicro = Math.floor(amount * Math.pow(10, COIN_DECIMALS));

  const result = await client.undelegateTokens(
    address,
    validatorAddress,
    { denom: DENOM, amount: String(amountInMicro) },
    {
      amount: [{ denom: DENOM, amount: "25000" }],
      gas: "300000",
    },
    "Undelegated via tx.silknodes.io"
  );

  client.disconnect();

  if (result.code !== 0) {
    throw new Error(`Undelegation failed: ${result.rawLog}`);
  }

  return result.transactionHash;
}

/**
 * Claim all staking rewards
 */
export async function claimAllRewards(
  delegations: Delegation[],
  walletType: "keplr" | "leap" = "keplr"
): Promise<string> {
  const provider = getWalletProvider(walletType);
  if (!provider) throw new Error(`${walletType} not available`);

  await provider.enable(CHAIN_ID);
  const offlineSigner = provider.getOfflineSigner(CHAIN_ID);
  const accounts = await offlineSigner.getAccounts();
  const address = accounts[0].address;

  const client = await SigningStargateClient.connectWithSigner(
    COREUM_CHAIN_INFO.rpc,
    offlineSigner
  );

  // Build withdraw rewards messages for all validators with rewards
  const msgs = delegations
    .filter((d) => d.rewards > 0)
    .map((d) => ({
      typeUrl: "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward",
      value: {
        delegatorAddress: address,
        validatorAddress: d.validatorAddress,
      },
    }));

  if (msgs.length === 0) throw new Error("No rewards to claim");

  // More gas for multiple messages
  const gasLimit = String(200000 + msgs.length * 100000);

  const result = await client.signAndBroadcast(
    address,
    msgs,
    {
      amount: [{ denom: DENOM, amount: "25000" }],
      gas: gasLimit,
    },
    "Claimed rewards via tx.silknodes.io"
  );

  client.disconnect();

  if (result.code !== 0) {
    throw new Error(`Transaction failed: ${result.rawLog}`);
  }

  return result.transactionHash;
}

/**
 * Redelegate tokens from one validator to another
 */
export async function redelegateTokens(
  srcValidatorAddress: string,
  dstValidatorAddress: string,
  amount: number,
  walletType: "keplr" | "leap" = "keplr"
): Promise<string> {
  const provider = getWalletProvider(walletType);
  if (!provider) throw new Error(`${walletType} not available`);

  await provider.enable(CHAIN_ID);
  const offlineSigner = provider.getOfflineSigner(CHAIN_ID);
  const accounts = await offlineSigner.getAccounts();
  const address = accounts[0].address;

  const client = await SigningStargateClient.connectWithSigner(
    COREUM_CHAIN_INFO.rpc,
    offlineSigner
  );

  const amountInMicro = Math.floor(amount * Math.pow(10, COIN_DECIMALS));

  const msg = {
    typeUrl: "/cosmos.staking.v1beta1.MsgBeginRedelegate",
    value: {
      delegatorAddress: address,
      validatorSrcAddress: srcValidatorAddress,
      validatorDstAddress: dstValidatorAddress,
      amount: { denom: DENOM, amount: String(amountInMicro) },
    },
  };

  const result = await client.signAndBroadcast(
    address,
    [msg],
    {
      amount: [{ denom: DENOM, amount: "25000" }],
      gas: "350000",
    },
    "Redelegated via tx.silknodes.io"
  );

  client.disconnect();

  if (result.code !== 0) {
    throw new Error(`Redelegation failed: ${result.rawLog}`);
  }

  return result.transactionHash;
}

/**
 * Refresh wallet data (re-fetch balances, delegations, etc.)
 */
export async function refreshWalletData(address: string): Promise<Omit<WalletState, "connected" | "walletType">> {
  await loadValidatorMonikers();

  const [balance, delegations, unbondingDelegations] = await Promise.all([
    fetchBalance(address),
    fetchDelegations(address),
    fetchUnbondingDelegations(address),
  ]);

  const stakedAmount = delegations.reduce((sum, d) => sum + d.amount, 0);
  const rewards = delegations.reduce((sum, d) => sum + d.rewards, 0);

  return {
    address,
    balance,
    stakedAmount,
    rewards,
    delegations,
    unbondingDelegations,
  };
}

/**
 * Disconnect wallet (clear state + localStorage)
 */
export function disconnectWallet(): WalletState {
  try {
    localStorage.removeItem("tx-wallet-type");
    localStorage.removeItem("tx-wallet-connected");
  } catch {}

  return { ...INITIAL_STATE };
}
