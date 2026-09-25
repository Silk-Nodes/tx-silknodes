// Stablecoins on TX, read live from the chain.
//
// Mirrors vm-service/collect-stablecoins.mjs, which records the same figures
// hourly into stablecoin_snapshots. This module answers "what is true now" so
// the page works without the collector (and locally, with no database), while
// the collector supplies the history the chain itself does not keep.

import { QueryTypes } from "sequelize";
import { lcdGet } from "@/lib/chain-config";
import { sequelize } from "@/lib/db";
import { cached } from "@/lib/response-cache";

// Chain accounts, not network infrastructure. Found by reading which address
// issued SBC; SBC, YSBC and USDX all live under it.
export const BRALE_MAINNET = "core1rfxrg75fzuq5hgnnymjgsxj70d9w9cs8xuza7x";
export const BRALE_TESTNET = "testcore1dy5l3teqsvnwr6reeg9jm6f7mpcr45jy7fqgsr";

// Canonical USDC: the route from noble-1 over channel-19. On 2026-09-24 it
// held 56,502.80 of the 58,894.71 USDC on chain, spread across 39 denoms.
export const USDC_CANONICAL = "ibc/E1E3674A0E4E1EF9C69646F9AF8D9497173821826074622D831BAB73CCB99A2D";

// Server-side only. A public third-party node by default.
const TESTNET_LCD = process.env.STABLECOIN_TESTNET_LCD || "https://rest.testnet-1.tx.org";

export type CoinRole = "incumbent" | "issued" | "test";

export interface TrackedCoin {
  denom: string;
  symbol: string;
  name: string;
  issuer: string | null;
  role: CoinRole;
}

// Mirrors the seed rows in migration 021. Role drives presentation: SBC is the
// base rate, YSBC and USDX are test-sized mints and shown as such.
export const TRACKED: TrackedCoin[] = [
  { denom: USDC_CANONICAL, symbol: "USDC", name: "USD Coin, via Noble", issuer: null, role: "incumbent" },
  { denom: `usbc-${BRALE_MAINNET}`, symbol: "SBC", name: "Stable Coin, by Brale", issuer: BRALE_MAINNET, role: "issued" },
  { denom: `uysbc-${BRALE_MAINNET}`, symbol: "YSBC", name: "Brale test token", issuer: BRALE_MAINNET, role: "test" },
  { denom: `uusdx-${BRALE_MAINNET}`, symbol: "USDX", name: "Brale test token", issuer: BRALE_MAINNET, role: "test" },
];

export type HolderKind = "dex" | "contract" | "known" | "wallet";

export interface Holder {
  address: string;
  amount: number;
  share: number;        // 0..1 of supply
  label: string | null; // null for an unlabelled wallet
  kind: HolderKind;
}

// The stacked "who holds the dollar" bar. Four bands, always summing to 1, so
// concentration reads without reading a number.
export interface Breakdown { top1: number; second: number; next8: number; rest: number }

// Wallets by balance, in dollars. Counts and the dollars each band holds,
// because a coin can have thousands of holders and still sit in five wallets.
export interface SizeBand { label: string; wallets: number; amount: number }
const BANDS: [string, number][] = [
  ["under $1", 1], ["$1 to 10", 10], ["$10 to 100", 100],
  ["$100 to 1k", 1_000], ["$1k to 10k", 10_000], ["$10k and up", Infinity],
];
function sizeBands(balances: { amount: number }[]): SizeBand[] {
  const out = BANDS.map(([label]) => ({ label, wallets: 0, amount: 0 }));
  for (const b of balances) {
    const i = BANDS.findIndex(([, max]) => b.amount < max);
    out[i].wallets++;
    out[i].amount += b.amount;
  }
  return out;
}

// Smart Token controls the issuer switched on at issuance (x/assetft). Fixed
// for the life of the token, which is why they are worth showing: they are
// what the issuer can do to a holder's balance. USDC arrives over IBC and
// its controls live on Noble, so it has none here.
export interface Controls { features: string[]; admin: string | null; globallyFrozen: boolean }

async function controlsOf(coin: TrackedCoin): Promise<Controls | null> {
  if (coin.denom.startsWith("ibc/")) return null;
  try {
    const t = await json<{ token: { features?: string[]; admin?: string; globally_frozen?: boolean } }>(
      `/coreum/asset/ft/v1/tokens/${encodeURIComponent(coin.denom)}`,
    );
    return { features: t.token.features ?? [], admin: t.token.admin || null, globallyFrozen: Boolean(t.token.globally_frozen) };
  } catch {
    return null;
  }
}

export interface CoinState extends TrackedCoin {
  supply: number;
  holders: number | null;   // null when the owner list could not be read in full
  top1Share: number | null; // 0..1
  top10Share: number | null;
  breakdown: Breakdown | null;
  topHolders: Holder[];
  sizes: SizeBand[] | null;
  controls: Controls | null;
}

async function json<T>(path: string): Promise<T> {
  const res = await lcdGet(path);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return res.json() as Promise<T>;
}

const OWNERS_PAGE = 1000;
const OWNERS_MAX_PAGES = 20;

/** Supply plus holder concentration for one denom. */
export async function measureCoin(coin: TrackedCoin): Promise<CoinState> {
  const enc = encodeURIComponent(coin.denom);
  const [sup, controls] = await Promise.all([
    json<{ amount: { amount: string } }>(`/cosmos/bank/v1beta1/supply/by_denom?denom=${enc}`),
    controlsOf(coin),
  ]);
  // Every tracked coin uses 6 decimals. Stated rather than looked up, because a
  // metadata miss would otherwise silently scale supply by a million.
  const scale = 1e6;
  const supply = Number(sup?.amount?.amount ?? 0) / scale;

  // by_query, not the path form: IBC denoms contain a slash, which breaks path
  // parameters and returns "Not Implemented".
  const balances: { address: string; amount: number }[] = [];
  let key: string | null = null;
  let complete = false;
  for (let p = 0; p < OWNERS_MAX_PAGES; p++) {
    const q = new URLSearchParams({ denom: coin.denom, "pagination.limit": String(OWNERS_PAGE) });
    if (key) q.set("pagination.key", key);
    const d = await json<{ denom_owners?: { address: string; balance: { amount: string } }[]; pagination?: { next_key?: string | null } }>(
      `/cosmos/bank/v1beta1/denom_owners_by_query?${q}`,
    );
    for (const o of d.denom_owners ?? []) {
      const amt = Number(o?.balance?.amount ?? 0) / scale;
      if (amt > 0) balances.push({ address: o.address, amount: amt });
    }
    key = d.pagination?.next_key ?? null;
    if (!key) { complete = true; break; }
  }

  if (!complete || supply <= 0) {
    return { ...coin, supply, holders: null, top1Share: null, top10Share: null, breakdown: null, topHolders: [], sizes: null, controls };
  }
  balances.sort((a, b) => b.amount - a.amount);
  const at = (i: number) => balances[i]?.amount ?? 0;
  const top10 = balances.slice(0, 10).reduce((s, v) => s + v.amount, 0);
  const next8 = balances.slice(2, 10).reduce((s, v) => s + v.amount, 0);
  const breakdown: Breakdown = {
    top1: at(0) / supply,
    second: at(1) / supply,
    next8: next8 / supply,
    rest: Math.max(0, 1 - top10 / supply),
  };
  const labels = await labelHolders(balances.slice(0, 10).map((b) => b.address));
  return {
    ...coin,
    supply,
    holders: balances.length,
    top1Share: at(0) / supply,
    top10Share: top10 / supply,
    breakdown,
    sizes: sizeBands(balances),
    controls,
    topHolders: balances.slice(0, 10).map((b) => {
      const l = labels.get(b.address);
      return { address: b.address, amount: b.amount, share: b.amount / supply, label: l?.label ?? null, kind: l?.kind ?? "wallet" };
    }),
  };
}

/**
 * Names for the largest holders, from two places.
 *
 * Contracts label themselves on chain. The fourth-largest USDC holder on
 * 2026-09-24 was a CosmWasm contract labelled "pair": a DEX pool, which is
 * the on-chain USDC liquidity and needs nobody to tag it. Wallets can only be
 * named from our own known_entities table (validators, exchanges), which is
 * empty locally, so an unmatched wallet stays unlabelled rather than guessed.
 */
async function labelHolders(addresses: string[]): Promise<Map<string, { label: string; kind: HolderKind }>> {
  const out = new Map<string, { label: string; kind: HolderKind }>();
  if (addresses.length === 0) return out;

  try {
    const rows = await sequelize.query<{ address: string; label: string }>(
      `SELECT address, label FROM known_entities WHERE address IN (:a)`,
      { replacements: { a: addresses }, type: QueryTypes.SELECT },
    );
    for (const r of rows) out.set(r.address, { label: r.label, kind: "known" });
  } catch { /* no database, e.g. local development. Contracts still label below. */ }

  await Promise.all(addresses.filter((a) => !out.has(a)).map(async (a) => {
    try {
      const res = await lcdGet(`/cosmwasm/wasm/v1/contract/${a}`);
      if (!res.ok) return; // not a contract, which is the common case
      const c = (await res.json()) as { contract_info?: { label?: string } };
      const raw = c.contract_info?.label?.trim();
      if (!raw) return;
      out.set(a, /pair|pool|\blp\b|swap/i.test(raw)
        ? { label: "DEX pool", kind: "dex" }
        : { label: `Contract: ${raw}`, kind: "contract" });
    } catch { /* leave it unlabelled */ }
  }));
  return out;
}

export interface UstxStatus {
  issued: boolean;
  denom: string | null;
  // Where it was found, or where we are looking.
  foundBy: "symbol" | "issuer" | null;
  testnetDenom: string | null;
  checkedAt: string;
}

/**
 * Is USTX on chain yet? Three independent checks, because the announcement
 * says Brale issues it "in partnership with tx", so it may come from Brale's
 * address or from a TX-controlled one.
 */
export async function ustxStatus(): Promise<UstxStatus> {
  const checkedAt = new Date().toISOString();
  let denom: string | null = null;
  let foundBy: UstxStatus["foundBy"] = null;

  try {
    const m = await json<{ metadatas?: { base: string; symbol?: string }[] }>(
      `/cosmos/bank/v1beta1/denoms_metadata?pagination.limit=5000`,
    );
    const hit = (m.metadatas ?? []).find((x) => String(x.symbol ?? "").toUpperCase() === "USTX");
    if (hit) { denom = hit.base; foundBy = "symbol"; }
  } catch { /* the issuer check below still runs */ }

  if (!denom) {
    try {
      const t = await json<{ tokens?: { denom: string; symbol: string }[] }>(
        `/coreum/asset/ft/v1/tokens?issuer=${BRALE_MAINNET}&pagination.limit=200`,
      );
      const hit = (t.tokens ?? []).find((x) => x.symbol.toUpperCase() === "USTX");
      if (hit) { denom = hit.denom; foundBy = "issuer"; }
    } catch { /* reported as not issued, which is the truth as far as we can see */ }
  }

  let testnetDenom: string | null = null;
  try {
    const res = await fetch(
      `${TESTNET_LCD}/coreum/asset/ft/v1/tokens?issuer=${BRALE_TESTNET}&pagination.limit=200`,
      { signal: AbortSignal.timeout(15_000) },
    );
    if (res.ok) {
      const t = (await res.json()) as { tokens?: { denom: string; symbol: string }[] };
      testnetDenom = (t.tokens ?? []).find((x) => x.symbol.toUpperCase() === "USTX")?.denom ?? null;
    }
  } catch { /* testnet is an early warning, not a dependency */ }

  return { issued: Boolean(denom), denom, foundBy, testnetDenom, checkedAt };
}

export interface UsdcFragment {
  denom: string;
  hops: number;
  firstChannel: string;
  // The chain on the far side of firstChannel. Several routes share a channel
  // and differ only in hop count, so "via channel-19" twice in a table reads
  // like a duplicate row. "via noble-1, 4 hops" does not.
  viaChain: string | null;
  amount: number;
}

/**
 * Every USDC denom on the chain. Each IBC route mints its own voucher and none
 * of them are interchangeable, so the same dollar can exist as dozens of
 * incompatible tokens. Slow-moving and expensive (one trace lookup per IBC
 * denom), so callers cache it for hours.
 */
export async function usdcFragments(): Promise<UsdcFragment[]> {
  const s = await json<{ supply?: { denom: string; amount: string }[] }>(
    `/cosmos/bank/v1beta1/supply?pagination.limit=2000`,
  );
  const ibc = (s.supply ?? []).filter((r) => r.denom.startsWith("ibc/"));
  const out: UsdcFragment[] = [];
  // Eight at a time. Measured at 118ms per trace against ~90 IBC denoms, that
  // is 10.4s one after another and about 1.3s here, which is what the first
  // visitor after a restart was waiting on. Still bounded, so it stays well
  // clear of the upstream fan-out the cache exists to prevent, and it runs
  // at most once every six hours.
  const CONCURRENCY = 8;
  let next = 0;
  const worker = async () => {
    while (next < ibc.length) {
      const r = ibc[next++];
      try {
        const d = await json<{ denom?: { base: string; trace?: { channel_id: string }[] } }>(
          `/ibc/apps/transfer/v1/denoms/${r.denom.slice(4)}`,
        );
        if (d.denom?.base !== "uusdc") continue;
        out.push({
          denom: r.denom,
          hops: d.denom.trace?.length ?? 0,
          firstChannel: d.denom.trace?.[0]?.channel_id ?? "",
          viaChain: null,
          amount: Number(r.amount) / 1e6,
        });
      } catch { /* one unresolvable trace does not invalidate the rest */ }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // One lookup per distinct channel, about six, not one per route.
  const channels = [...new Set(out.map((f) => f.firstChannel).filter(Boolean))];
  const chainOf = new Map<string, string>();
  await Promise.all(channels.map(async (ch) => {
    try {
      const cs = await json<{ identified_client_state?: { client_state?: { chain_id?: string } } }>(
        `/ibc/core/channel/v1/channels/${ch}/ports/transfer/client_state`,
      );
      const id = cs.identified_client_state?.client_state?.chain_id;
      if (id) chainOf.set(ch, id);
    } catch { /* falls back to showing the channel id */ }
  }));
  for (const f of out) f.viaChain = chainOf.get(f.firstChannel) ?? null;
  return out.sort((a, b) => b.amount - a.amount);
}

// ── cached reads, shared by /api/stablecoins and the OG card ─────────────
//
// One cache for both, so a shared link's preview can never show a different
// number from the page it opens.


// Five minutes for coins and USTX status: holder lists move slowly, and the
// page flips to "live" within five minutes of the first mint.
const LIVE_MS = 5 * 60_000;
// The USDC route list is ~90 trace lookups and changes over weeks.
const FRAGMENTS_MS = 6 * 60 * 60_000;

export function liveCoins(): Promise<CoinState[]> {
  return cached("stablecoins:coins", LIVE_MS, async () => {
    const settled = await Promise.allSettled(TRACKED.map((c) => measureCoin(c)));
    const ok = settled
      .filter((r): r is PromiseFulfilledResult<CoinState> => r.status === "fulfilled")
      .map((r) => r.value);
    // A coin that could not be read is left out rather than shown as zero.
    // Throwing when none succeed keeps a total outage out of the cache.
    if (ok.length === 0) throw new Error("no stablecoin could be measured");
    return ok;
  }).catch(() => []);
}

export function liveUstx(): Promise<UstxStatus | null> {
  return cached("stablecoins:ustx", LIVE_MS, () => ustxStatus()).catch(() => null);
}

export function liveFragments(): Promise<UsdcFragment[]> {
  return cached("stablecoins:fragments", FRAGMENTS_MS, async () => {
    const f = await usdcFragments();
    if (f.length === 0) throw new Error("no USDC routes resolved");
    return f;
  }).catch(() => []);
}

export interface Recording { since: string | null; snapshots: number }

/** When the hourly collector started, and how many runs it has recorded. */
export async function recording(): Promise<Recording | null> {
  try {
    const [r] = await sequelize.query<{ since: string | null; runs: string }>(
      `SELECT MIN(taken_at) AS since, COUNT(DISTINCT taken_at) AS runs FROM stablecoin_snapshots`,
      { type: QueryTypes.SELECT },
    );
    return { since: r?.since ? new Date(r.since).toISOString() : null, snapshots: Number(r?.runs ?? 0) };
  } catch {
    return null; // no database locally, or migration 021 not run
  }
}

// ── transfer activity, from stablecoin_transfers (migration 022) ─────────

export interface ActivityDay {
  day: string;          // YYYY-MM-DD, UTC
  txs: number;
  volume: number;       // largest leg per transaction, summed
  ibcIn: number;        // volume by kind
  ibcOut: number;
  chain: number;
  senders: number;
}
export interface Activity {
  denom: string;
  since: string | null; // oldest transfer recorded, so the page can say how far back
  days: ActivityDay[];
  txs: number;
  volume: number;
  wallets: number;      // distinct senders and recipients over the window
}

const ACTIVITY_DAYS = 30;

/**
 * Daily activity per coin. Volume counts the largest leg of each
 * transaction, not the sum: a swap moves the same dollars wallet to pool and
 * pool to wallet, and summing both legs would double it.
 */
export async function activity(): Promise<Activity[] | null> {
  try {
    const days = await sequelize.query<{
      denom: string; day: string; txs: string; volume: string; ibc_in: string; ibc_out: string; chain: string; senders: string;
    }>(
      `WITH per_tx AS (
         SELECT denom, txhash, MIN(ts) AS ts, MAX(amount) AS amount, MIN(kind) AS kind, MIN(sender) AS sender
           FROM stablecoin_transfers
          WHERE ts >= NOW() - (:days || ' days')::interval
          GROUP BY denom, txhash
       )
       SELECT denom, to_char(date_trunc('day', ts AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
              COUNT(*) AS txs, SUM(amount) AS volume,
              SUM(amount) FILTER (WHERE kind = 'ibc_in') AS ibc_in,
              SUM(amount) FILTER (WHERE kind = 'ibc_out') AS ibc_out,
              SUM(amount) FILTER (WHERE kind = 'chain') AS chain,
              COUNT(DISTINCT sender) AS senders
         FROM per_tx GROUP BY 1, 2 ORDER BY 1, 2`,
      { replacements: { days: ACTIVITY_DAYS }, type: QueryTypes.SELECT },
    );
    const totals = await sequelize.query<{ denom: string; since: string | null; wallets: string }>(
      `SELECT denom, MIN(ts) AS since,
              (SELECT COUNT(*) FROM (
                 SELECT sender AS a FROM stablecoin_transfers x WHERE x.denom = t.denom AND x.ts >= NOW() - (:days || ' days')::interval
                 UNION
                 SELECT recipient FROM stablecoin_transfers x WHERE x.denom = t.denom AND x.ts >= NOW() - (:days || ' days')::interval
               ) w) AS wallets
         FROM stablecoin_transfers t GROUP BY denom`,
      { replacements: { days: ACTIVITY_DAYS }, type: QueryTypes.SELECT },
    );
    const n = (v: string | null) => Number(v ?? 0);
    return totals.map((t) => {
      const ds: ActivityDay[] = days.filter((d) => d.denom === t.denom).map((d) => ({
        day: d.day, txs: n(d.txs), volume: n(d.volume), ibcIn: n(d.ibc_in), ibcOut: n(d.ibc_out), chain: n(d.chain), senders: n(d.senders),
      }));
      return {
        denom: t.denom,
        since: t.since ? new Date(t.since).toISOString() : null,
        days: ds,
        txs: ds.reduce((s, d) => s + d.txs, 0),
        volume: ds.reduce((s, d) => s + d.volume, 0),
        wallets: n(t.wallets),
      };
    });
  } catch {
    return null; // no database, or migration 022 not run
  }
}
