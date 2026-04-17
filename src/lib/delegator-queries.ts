// Per-delegator LCD queries used by the DelegatorPanel side view.
//
// Fetched on demand when the user opens the panel (not pre-computed into
// top-delegators.json) because most panel opens are one-offs and stuffing
// the distribution for every top-200 address into the committed JSON would
// blow up the file for no real benefit.

const LCD_PRIMARY = "https://rest-coreum.ecostake.com";
const LCD_FALLBACK = "https://full-node.mainnet-1.coreum.dev:1317";
const TIMEOUT_MS = 10_000;
const DECIMALS = 6;

export interface DelegationItem {
  valoper: string;
  stakeTX: number;
}

export interface UnbondingItem {
  valoper: string;
  completionTime: string;
  balanceTX: number;
}

function ucoreToTX(amount: string | number): number {
  const n = typeof amount === "string" ? parseInt(amount, 10) : amount;
  if (!Number.isFinite(n)) return 0;
  return n / Math.pow(10, DECIMALS);
}

async function fetchWithFallback(path: string): Promise<any> {
  let lastErr: unknown;
  for (const base of [LCD_PRIMARY, LCD_FALLBACK]) {
    try {
      const res = await fetch(`${base}${path}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) return await res.json();
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("all LCD endpoints failed");
}

/**
 * Returns this delegator's stake broken down by validator, sorted by size desc.
 * Typical cost: ~200-400ms for well-diversified addresses.
 */
export async function fetchDelegatorDelegations(address: string): Promise<DelegationItem[]> {
  // Addresses with >200 delegations are extremely rare but we paginate for safety.
  const out: DelegationItem[] = [];
  let nextKey = "";
  for (let i = 0; i < 5; i++) {
    const qs = nextKey
      ? `?pagination.limit=200&pagination.key=${encodeURIComponent(nextKey)}`
      : `?pagination.limit=200`;
    const data = await fetchWithFallback(
      `/cosmos/staking/v1beta1/delegations/${address}${qs}`,
    );
    for (const resp of data?.delegation_responses || []) {
      out.push({
        valoper: resp?.delegation?.validator_address || "",
        stakeTX: ucoreToTX(resp?.balance?.amount || "0"),
      });
    }
    nextKey = data?.pagination?.next_key || "";
    if (!nextKey) break;
  }
  return out.sort((a, b) => b.stakeTX - a.stakeTX);
}

/**
 * Returns pending unbonding entries whose completion_time is still in the
 * future. Entries already past their completion time are silently filtered out
 * (they're released on-chain and no longer pending).
 */
export async function fetchDelegatorUnbondings(address: string): Promise<UnbondingItem[]> {
  const data = await fetchWithFallback(
    `/cosmos/staking/v1beta1/delegators/${address}/unbonding_delegations?pagination.limit=200`,
  );
  const nowMs = Date.now();
  const out: UnbondingItem[] = [];
  for (const resp of data?.unbonding_responses || []) {
    const valoper: string = resp?.validator_address || "";
    for (const entry of resp?.entries || []) {
      const completionTime: string = entry?.completion_time || "";
      if (!completionTime) continue;
      const completionMs = new Date(completionTime).getTime();
      if (!Number.isFinite(completionMs) || completionMs <= nowMs) continue;
      out.push({
        valoper,
        completionTime,
        balanceTX: ucoreToTX(entry?.balance || "0"),
      });
    }
  }
  return out.sort(
    (a, b) => new Date(a.completionTime).getTime() - new Date(b.completionTime).getTime(),
  );
}
