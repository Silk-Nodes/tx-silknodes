// The arithmetic behind /earn, kept free of React and of imports so it can be
// tested with plain `node --test` (tests/earn-math.test.mjs).
//
// Both products use a 365 day year. The staking APR is built on one
// (lib/chain-economics counts blocks in 31,536,000 seconds) and the vault
// contract divides by 365 itself.

export const DAYS_PER_YEAR = 365;

/** Staking rewards over `days` at `apr` (a fraction). Daily restaking compounds. */
export function stakingReward(amount: number, apr: number, days: number, compound: boolean): number {
  if (amount <= 0 || apr <= 0 || days <= 0) return 0;
  return compound
    ? amount * (Math.pow(1 + apr / DAYS_PER_YEAR, days) - 1)
    : (amount * apr * days) / DAYS_PER_YEAR;
}

/** Stake-weighted average commission, as a fraction. Null for an empty set. */
export function averageCommission(set: { tokens: number; commission: number }[]): number | null {
  const total = set.reduce((s, v) => s + v.tokens, 0);
  if (!total) return null;
  return set.reduce((s, v) => s + v.commission * v.tokens, 0) / total;
}

/**
 * Dollar value the USTX vault credits over a lock: amount * rate * days / 365.
 * `pct` is a percentage (7 for 7%). Checked on 2026-11-18 against all 23 open
 * positions, where it matched the contract to 1 part in a million.
 */
export function vaultReward(amount: number, pct: number, days: number): number {
  if (amount <= 0 || pct <= 0 || days <= 0) return 0;
  return (amount * (pct / 100) * days) / DAYS_PER_YEAR;
}

/** The largest round step that still puts at least two gridlines under `max`. */
export function gridStep(max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 0;
  let pow = Math.pow(10, Math.ceil(Math.log10(max)));
  for (let i = 0; i < 30; i++, pow /= 10) {
    for (const m of [5, 2.5, 2, 1]) if (Math.floor(max / (m * pow)) >= 2) return m * pow;
  }
  return 0;
}

/** Digits and one dot at most, `decimals` places at most, no leading zeros. */
export function cleanAmount(text: string, decimals = 6): string {
  const s = text.replace(/[^0-9.]/g, "");
  const dot = s.indexOf(".");
  const int = (dot === -1 ? s : s.slice(0, dot)).replace(/^0+(?=\d)/, "");
  if (dot === -1) return int;
  return `${int}.${s.slice(dot + 1).replace(/\./g, "").slice(0, decimals)}`;
}

/** 1234567.5 as 1,234,567.5. Leaves a trailing dot alone so typing "12." works. */
export function groupAmount(plain: string): string {
  const dot = plain.indexOf(".");
  const int = (dot === -1 ? plain : plain.slice(0, dot)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return dot === -1 ? int : `${int}${plain.slice(dot)}`;
}

export const amountOf = (plain: string): number => Math.max(0, Number(plain) || 0);
