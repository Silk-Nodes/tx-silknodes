// Wallet Passport data layer.
//
// One address in, a normalized snapshot out. The holdings/staking numbers
// come straight from the Coreum LCD (via the same api.silknodes.io proxy
// the rest of the app uses, which sends CORS headers). PSE, exchange-flow
// and governance data are fetched by the component from their own
// endpoints; this file owns the on-chain read plus the behavior-badge
// logic that turns all of it into a few human labels.

import { fetchWithTimeout } from "@/lib/chain-config";

const LCD_PROXY = "https://api.silknodes.io/coreum";
const UCORE_PER_TX = 1_000_000;

export interface PassportDelegation {
  validatorAddress: string;
  amountTX: number;
}
export interface PassportUnbonding {
  validatorAddress: string;
  amountTX: number;
  completionTime: string; // ISO
}
export interface TokenHolding {
  denom: string;
  subunit: string;   // display name (e.g. "ubob", "IBC")
  amount: string;    // raw base-unit amount (decimals unknown per token)
}
export interface AddressChainData {
  balanceTX: number;        // liquid, in wallet
  stakedTX: number;         // total bonded
  rewardsTX: number;        // pending staking rewards
  delegations: PassportDelegation[];
  unbonding: PassportUnbonding[];
  unbondingTX: number;      // total currently unbonding
  validatorCount: number;
  otherTokens: TokenHolding[]; // non-TX smart tokens / IBC assets held
  txsSent: number;          // account sequence (txs this wallet signed)
  accountNumber: number;    // lower = older account
}

// Smart-token denom looks like "subunit-issueraddress"; IBC like "ibc/HASH".
function tokenSubunit(denom: string): string {
  if (denom.startsWith("ibc/")) return "IBC";
  const dash = denom.indexOf("-core1");
  return dash > 0 ? denom.slice(0, dash) : denom;
}

function ucoreToTX(amount: string | number | undefined | null): number {
  if (amount === null || amount === undefined) return 0;
  if (typeof amount === "number") return amount / UCORE_PER_TX;
  const n = parseFloat(amount);
  return Number.isFinite(n) ? n / UCORE_PER_TX : 0;
}

async function getJson(path: string): Promise<any | null> {
  try {
    const res = await fetchWithTimeout(`${LCD_PROXY}${path}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Validator operator_address -> moniker, straight from the chain, so the
// passport can label delegations without depending on a prop that may not
// be loaded yet on this route. Paginates the full bonded+unbonded set.
export async function fetchValidatorMonikers(): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  try {
    let nextKey: string | null = null;
    do {
      const q: string = nextKey
        ? `?pagination.limit=200&pagination.key=${encodeURIComponent(nextKey)}`
        : `?pagination.limit=200`;
      const data = await getJson(`/cosmos/staking/v1beta1/validators${q}`);
      for (const v of data?.validators ?? []) {
        if (v.operator_address && v.description?.moniker) {
          map[v.operator_address] = v.description.moniker;
        }
      }
      nextKey = data?.pagination?.next_key || null;
    } while (nextKey);
  } catch {
    // fall back to short addresses
  }
  return map;
}

// Total bonded TX across the network (the staking pool). Used as the
// denominator for a stake-proportion PSE estimate when the enumerated
// network score isn't available.
export async function fetchBondedTokens(): Promise<number> {
  const data = await getJson(`/cosmos/staking/v1beta1/pool`);
  return ucoreToTX(data?.pool?.bonded_tokens);
}

// Fetch balance, delegations, unbonding and rewards in parallel. Each
// piece degrades independently: a failed sub-request just zeroes that
// slice rather than failing the whole passport.
export async function fetchAddressChainData(address: string): Promise<AddressChainData> {
  const [bal, deleg, unbond, rew, acct] = await Promise.all([
    getJson(`/cosmos/bank/v1beta1/balances/${address}`),
    getJson(`/cosmos/staking/v1beta1/delegations/${address}`),
    getJson(`/cosmos/staking/v1beta1/delegators/${address}/unbonding_delegations`),
    getJson(`/cosmos/distribution/v1beta1/delegators/${address}/rewards`),
    getJson(`/cosmos/auth/v1beta1/accounts/${address}`),
  ]);

  const balances: any[] = bal?.balances ?? [];
  const balanceTX = ucoreToTX(balances.find((b: any) => b.denom === "ucore")?.amount);
  const otherTokens: TokenHolding[] = balances
    .filter((b: any) => b.denom !== "ucore" && Number(b.amount) > 0)
    .map((b: any) => ({ denom: b.denom, subunit: tokenSubunit(b.denom), amount: b.amount }))
    .sort((a, b) => Number(b.amount) - Number(a.amount));

  const base = acct?.account?.base_account ?? acct?.account ?? {};
  const txsSent = Number(base.sequence ?? 0);
  const accountNumber = Number(base.account_number ?? 0);

  const delegations: PassportDelegation[] = (deleg?.delegation_responses ?? []).map(
    (d: any) => ({
      validatorAddress: d.delegation?.validator_address ?? "",
      amountTX: ucoreToTX(d.balance?.amount),
    }),
  );
  const stakedTX = delegations.reduce((s, d) => s + d.amountTX, 0);

  const unbonding: PassportUnbonding[] = [];
  for (const u of unbond?.unbonding_responses ?? []) {
    for (const e of u.entries ?? []) {
      unbonding.push({
        validatorAddress: u.validator_address ?? "",
        amountTX: ucoreToTX(e.balance),
        completionTime: e.completion_time ?? "",
      });
    }
  }
  const unbondingTX = unbonding.reduce((s, u) => s + u.amountTX, 0);

  const rewardsTX = ucoreToTX(
    (rew?.total ?? []).find((t: any) => t.denom === "ucore")?.amount,
  );

  return {
    balanceTX,
    stakedTX,
    rewardsTX,
    delegations: delegations.sort((a, b) => b.amountTX - a.amountTX),
    unbonding,
    unbondingTX,
    validatorCount: delegations.filter((d) => d.amountTX > 0).length,
    otherTokens,
    txsSent,
    accountNumber,
  };
}

// ─── Behavior badges ────────────────────────────────────────────────
// A handful of at-a-glance labels derived from the full passport. Kept
// deliberately conservative: only assert a label when the signal is
// clear, so the badges stay trustworthy.

export type BadgeTone = "good" | "warn" | "neutral" | "accent";
export interface Badge {
  label: string;
  tone: BadgeTone;
  title: string; // tooltip / explanation
}

export interface BadgeInputs {
  isExchange: boolean;
  rank: number | null;        // top-delegator rank, if any
  stakedTX: number;
  balanceTX: number;
  netToExchanges: number;     // >0 means net sent TO exchanges (distributing)
  exchangeTxCount: number;
  turnoutPct: number;
  votedCount: number;
}

export function computeBadges(i: BadgeInputs): Badge[] {
  const badges: Badge[] = [];

  if (i.isExchange) {
    badges.push({ label: "Exchange wallet", tone: "neutral", title: "A known exchange hot wallet, not an individual holder." });
    return badges; // exchange wallets don't get the holder labels
  }

  if (i.rank !== null && i.rank <= 50) {
    badges.push({ label: "Whale", tone: "accent", title: `Among the top ${i.rank <= 10 ? 10 : 50} stakers by bonded TX (rank #${i.rank}).` });
  }

  // Accumulation vs distribution from exchange flow, only when there's
  // enough activity to mean something.
  if (i.exchangeTxCount >= 2) {
    if (i.netToExchanges <= -1) {
      badges.push({ label: "Accumulating", tone: "good", title: "Net withdrawing from exchanges into self-custody." });
    } else if (i.netToExchanges >= 1) {
      badges.push({ label: "Distributing", tone: "warn", title: "Net depositing to exchanges, often a sell signal." });
    }
  }

  // Staker vs liquid holder.
  const total = i.stakedTX + i.balanceTX;
  if (total > 0) {
    const stakedShare = i.stakedTX / total;
    if (stakedShare >= 0.9 && i.stakedTX > 0) {
      badges.push({ label: "Diamond hands", tone: "good", title: "Keeps almost everything staked." });
    } else if (stakedShare <= 0.1 && i.balanceTX > 0) {
      badges.push({ label: "Liquid holder", tone: "neutral", title: "Holds mostly unstaked, liquid TX." });
    }
  }

  // Governance engagement.
  if (i.votedCount > 0 && i.turnoutPct >= 60) {
    badges.push({ label: "Active voter", tone: "accent", title: `Voted on ${i.turnoutPct}% of decided proposals.` });
  } else if (i.votedCount === 0 && i.stakedTX > 0) {
    badges.push({ label: "Silent staker", tone: "neutral", title: "Stakes but has not voted on governance." });
  }

  return badges;
}
