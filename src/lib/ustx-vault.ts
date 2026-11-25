// The USTX vault ("ustx-staking"), read live from its contract.
//
// Lock USTX for 30, 60 or 90 days, earn a dollar yield paid in TX. Wallets on
// the vault's allowlist get the boosted rate, everyone else the base rate.
// Rewards accrue daily: an oracle wallet posts the TX price once a day and
// the contract converts that day's dollar yield into TX at it, on a 365 day
// year (checked against position 3: 25 USTX at 7% earned 3.713849 TX on day
// 20770 at 0.001290984, which is 25 * 0.07 / 365 / price).
//
// Everything here is a smart query, so the page needs no collector and no
// database. Nothing is defaulted: a query that fails or answers in a shape we
// do not recognise makes the whole read fail, and the page says so.

import { lcdGet } from "@/lib/chain-config";
import { cached } from "@/lib/response-cache";

// A chain account, not network infrastructure. Code 697, created at block
// 93,673,597 on 2026-11-12, the only contract made from that code.
export const USTX_VAULT = "core10uxxqjawe0gs5knu5zxcr5ea99e9fzreaas2qcnuzpv623uukkjscx5nfr";

const MICRO = 1e6;
const DAY_NS = 86_400e9;
const PAGE = 100;
const MAX_PAGES = 50;
const LIVE_MS = 5 * 60_000;

export interface VaultTerm {
  days: number;
  boostedPct: number; // allowlisted wallets
  basePct: number;    // everyone else
  positions: number;
  ustx: number;
}

export interface VaultMonth { month: string; ustx: number; positions: number }

export interface VaultState {
  contract: string;
  paused: boolean;
  minStake: number;
  maxPerWallet: number;
  terms: VaultTerm[];
  lockedUstx: number;
  ustxSupply: number | null;
  positions: number;
  positionsEver: number;
  wallets: number;
  boostedUstx: number;
  autoRestake: number;
  /** When locks end, by calendar month (UTC), soonest first. */
  maturities: VaultMonth[];
  nextMaturity: string | null;
  /** TX the open positions have earned so far, and TX the vault holds to pay it. */
  earnedTx: number;
  rewardPoolTx: number;
  oraclePrice: number;
  oracleDay: string;
  checkedAt: string;
  /** True when the contract could not be read and this is the last good read. */
  stale?: boolean;
}

async function smart<T>(msg: object): Promise<T> {
  const b64 = Buffer.from(JSON.stringify(msg)).toString("base64");
  const res = await lcdGet(`/cosmwasm/wasm/v1/contract/${USTX_VAULT}/smart/${encodeURIComponent(b64)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${Object.keys(msg)[0]}`);
  const j = (await res.json()) as { data?: T };
  if (j.data === undefined || j.data === null) throw new Error(`${Object.keys(msg)[0]} returned no data`);
  return j.data;
}

interface RawPosition {
  id: number;
  position: { owner: string; amount: string; stake_time: string; end_time: string; auto_restake: boolean; is_boosted: boolean };
}

async function allPositions(): Promise<RawPosition[]> {
  const out: RawPosition[] = [];
  let after: number | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await smart<RawPosition[]>({ positions: after === undefined ? { limit: PAGE } : { start_after: after, limit: PAGE } });
    if (!Array.isArray(page)) throw new Error("positions answered in an unexpected shape");
    out.push(...page);
    if (page.length < PAGE) return out;
    after = page[page.length - 1].id;
  }
  throw new Error(`more than ${MAX_PAGES * PAGE} positions, raise MAX_PAGES`);
}

async function read(): Promise<VaultState> {
  const [config, pool, price, summary, positions] = await Promise.all([
    smart<{
      ustx_denom: string; paused: boolean; min_stake: string; max_stake_per_wallet: string;
      staking_terms: { duration_days: number; apy_bps: number; non_kyc_apy_bps: number }[];
    }>({ config: {} }),
    smart<{ balance: string; total_staked: string }>({ pool: {} }),
    smart<{ day: number; price: string }>({ price: {} }),
    smart<{ earned_tx: string }>({ positions_summary: {} }),
    allPositions(),
  ]);
  if (!Array.isArray(config.staking_terms) || typeof config.paused !== "boolean" || !config.ustx_denom) {
    throw new Error("config answered in an unexpected shape");
  }

  // Supply is context for one line ("x% of all USTX"), so its failure hides
  // that line instead of failing the page.
  const supply = await lcdGet(`/cosmos/bank/v1beta1/supply/by_denom?denom=${encodeURIComponent(config.ustx_denom)}`)
    .then(async (r) => (r.ok ? Number(((await r.json()) as { amount?: { amount?: string } }).amount?.amount) / MICRO : NaN))
    .catch(() => NaN);

  const terms: VaultTerm[] = config.staking_terms
    .map((t) => ({ days: t.duration_days, boostedPct: t.apy_bps / 100, basePct: t.non_kyc_apy_bps / 100, positions: 0, ustx: 0 }))
    .sort((a, b) => a.days - b.days);
  const months = new Map<string, VaultMonth>();
  const owners = new Set<string>();
  let boostedUstx = 0, autoRestake = 0, next: number | null = null, maxId = -1;
  for (const { id, position: p } of positions) {
    const ustx = Number(p.amount) / MICRO;
    const start = Number(p.stake_time), end = Number(p.end_time);
    const term = terms.find((t) => t.days === Math.round((end - start) / DAY_NS));
    if (term) { term.positions++; term.ustx += ustx; }
    owners.add(p.owner);
    if (p.is_boosted) boostedUstx += ustx;
    if (p.auto_restake) autoRestake++;
    if (next === null || end < next) next = end;
    if (id > maxId) maxId = id;
    const month = new Date(end / 1e6).toISOString().slice(0, 7);
    const m = months.get(month) ?? { month, ustx: 0, positions: 0 };
    m.ustx += ustx; m.positions++;
    months.set(month, m);
  }

  return {
    contract: USTX_VAULT,
    paused: config.paused,
    minStake: Number(config.min_stake) / MICRO,
    maxPerWallet: Number(config.max_stake_per_wallet) / MICRO,
    terms,
    lockedUstx: Number(pool.total_staked) / MICRO,
    ustxSupply: Number.isFinite(supply) && supply > 0 ? supply : null,
    positions: positions.length,
    // Ids are handed out in order from 0, so the highest open id plus one is
    // a floor on how many positions were ever opened.
    positionsEver: positions.length ? maxId + 1 : 0,
    wallets: owners.size,
    boostedUstx,
    autoRestake,
    maturities: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
    nextMaturity: next === null ? null : new Date(next / 1e6).toISOString(),
    earnedTx: Number(summary.earned_tx) / MICRO,
    rewardPoolTx: Number(pool.balance) / MICRO,
    oraclePrice: Number(price.price),
    oracleDay: new Date(price.day * 86_400_000).toISOString().slice(0, 10),
    checkedAt: new Date().toISOString(),
  };
}

// The last successful read, kept so a node outage does not blank the page.
// It is only ever served marked `stale`, with its own read time, and only
// for STALE_MAX_MS: after that an old vault is worse than no vault.
const STALE_MAX_MS = 6 * 60 * 60_000;
let lastGood: VaultState | null = null;

export async function liveVault(): Promise<VaultState> {
  try {
    lastGood = await cached("ustx-vault", LIVE_MS, read);
    return lastGood;
  } catch (e) {
    if (lastGood && Date.now() - Date.parse(lastGood.checkedAt) < STALE_MAX_MS) {
      console.warn(`[ustx-vault] read failed, serving the ${lastGood.checkedAt} read as stale: ${(e as Error).message}`);
      return { ...lastGood, stale: true };
    }
    throw e;
  }
}
