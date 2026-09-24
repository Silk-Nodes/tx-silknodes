#!/usr/bin/env node
/**
 * Stablecoin collector. Snapshots supply and holder concentration for every
 * tracked stablecoin on TX mainnet, and watches for new ones.
 *
 * Built ahead of USTX, Brale's native stablecoin for TX, announced for
 * October 2026 and absent from both mainnet and testnet on 2026-09-24. The
 * chain only reports current holders, so holder history cannot be rebuilt
 * after the fact: this has to be running before the first mint.
 *
 * Detection, each run:
 *   1. Every token under Brale's mainnet issuer. SBC, YSBC and USDX already
 *      live there, so USTX most likely will too.
 *   2. Every token under Brale's testnet issuer, which is where a dry run
 *      tends to appear first. Logged and recorded, never measured.
 *   3. A symbol scan of bank metadata, one call covering every Smart Token,
 *      in case USTX is issued from a TX-controlled address instead. The
 *      announcement says "in partnership with tx", so that is plausible.
 *
 * Endpoints: the chain REST API. Hosts come from STABLECOIN_LCD_POOL and
 * STABLECOIN_TESTNET_LCD, falling back to public third-party nodes only.
 *
 * Usage:
 *   node vm-service/collect-stablecoins.mjs
 *   node vm-service/collect-stablecoins.mjs --dry-run   # reads, writes nothing
 */

const DRY = process.argv.includes("--dry-run");
const { query, closePool } = DRY
  ? { query: async () => ({ rows: [] }), closePool: async () => {} }
  : await import("./db.mjs");

const MAINNET_POOL = (process.env.STABLECOIN_LCD_POOL || [
  "https://rest-coreum.ecostake.com",
  "https://coreum-api.polkachu.com",
].join(",")).split(",").map((s) => s.trim()).filter(Boolean);

const TESTNET_LCD = process.env.STABLECOIN_TESTNET_LCD || "https://rest.testnet-1.tx.org";

// Issuer addresses are chain accounts, not network infrastructure, so they
// belong in source. Found by reading which address issued SBC.
const BRALE_MAINNET = "core1rfxrg75fzuq5hgnnymjgsxj70d9w9cs8xuza7x";
const BRALE_TESTNET = "testcore1dy5l3teqsvnwr6reeg9jm6f7mpcr45jy7fqgsr";

// Symbols that mean "this is the launch". Kept narrow on purpose: a scan for
// anything containing USD would flag every test token on the chain.
const WATCH_SYMBOLS = new Set(["USTX"]);

// denom_owners pages. Canonical USDC had 2,964 holders on 2026-09-24, three
// pages at 1000. The ceiling stops a runaway, and hitting it means the holder
// figures are incomplete, which is recorded as null rather than a wrong count.
const OWNERS_PAGE = 1000;
const OWNERS_MAX_PAGES = 20;

const log = (lvl, ...m) =>
  console[lvl === "error" ? "error" : "log"](`[stablecoins] ${lvl}:`, ...m);

async function lcd(path, hosts = MAINNET_POOL) {
  let lastErr;
  for (const host of hosts) {
    try {
      const res = await fetch(`${host}${path}`, { signal: AbortSignal.timeout(30_000) });
      if (res.ok) return await res.json();
      lastErr = new Error(`HTTP ${res.status} from ${host}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error(`no host answered ${path}`);
}

async function tokensByIssuer(issuer, hosts) {
  const d = await lcd(`/coreum/asset/ft/v1/tokens?issuer=${issuer}&pagination.limit=200`, hosts);
  return d?.tokens ?? [];
}

// Mirrors the seed rows in migration 021, so a --dry-run has something to
// measure instead of reading an empty table and reporting success.
const DRY_SEED = [
  { denom: "ibc/E1E3674A0E4E1EF9C69646F9AF8D9497173821826074622D831BAB73CCB99A2D", symbol: "USDC", network: "mainnet", kind: "ibc" },
  { denom: `usbc-${BRALE_MAINNET}`, symbol: "SBC", network: "mainnet", kind: "native" },
  { denom: `uysbc-${BRALE_MAINNET}`, symbol: "YSBC", network: "mainnet", kind: "native" },
  { denom: `uusdx-${BRALE_MAINNET}`, symbol: "USDX", network: "mainnet", kind: "native" },
];

async function tracked() {
  if (DRY) return DRY_SEED;
  const r = await query(`SELECT denom, symbol, network, kind FROM tracked_stablecoins`);
  return r.rows ?? [];
}

async function track(denom, symbol, network, kind, issuer, source) {
  const r = await query(
    `INSERT INTO tracked_stablecoins (denom, symbol, network, kind, issuer, source)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (denom) DO NOTHING`,
    [denom, symbol, network, kind, issuer, source],
  );
  return (r.rowCount ?? 0) > 0;
}

// ── detection ───────────────────────────────────────────────────────────
async function detect(known) {
  const seen = new Set(known.map((t) => t.denom));
  const found = [];

  for (const [network, issuer, hosts] of [
    ["mainnet", BRALE_MAINNET, MAINNET_POOL],
    ["testnet", BRALE_TESTNET, [TESTNET_LCD]],
  ]) {
    try {
      for (const t of await tokensByIssuer(issuer, hosts)) {
        if (seen.has(t.denom)) continue;
        found.push({ denom: t.denom, symbol: t.symbol, network, kind: "native", issuer, source: "issuer" });
        seen.add(t.denom);
      }
    } catch (e) {
      // A failed watch is not "nothing new". Say which one failed.
      log("warn", `issuer watch failed for ${network} ${issuer}: ${e.message}`);
    }
  }

  try {
    const m = await lcd(`/cosmos/bank/v1beta1/denoms_metadata?pagination.limit=5000`);
    for (const x of m?.metadatas ?? []) {
      const sym = String(x.symbol || "").toUpperCase();
      if (!WATCH_SYMBOLS.has(sym) || seen.has(x.base)) continue;
      const issuer = x.base.includes("-") ? x.base.split("-").slice(1).join("-") : null;
      found.push({ denom: x.base, symbol: sym, network: "mainnet", kind: "native", issuer, source: "symbol" });
      seen.add(x.base);
    }
  } catch (e) {
    log("warn", `symbol scan failed: ${e.message}`);
  }

  for (const f of found) {
    const added = DRY ? true : await track(f.denom, f.symbol, f.network, f.kind, f.issuer, f.source);
    if (!added) continue;
    // Loud on purpose. This is the event the whole collector exists for, and
    // it should be findable with one grep of the journal.
    const level = WATCH_SYMBOLS.has(String(f.symbol).toUpperCase()) ? "error" : "warn";
    log(level, `NEW STABLECOIN ${f.symbol} on ${f.network} via ${f.source}: ${f.denom}`);
  }
  return found;
}

// ── measurement ─────────────────────────────────────────────────────────
function precisionOf(meta, fallback = 6) {
  // Bank metadata lists denom units; the largest exponent is the display one.
  const units = meta?.denom_units ?? [];
  const exp = Math.max(0, ...units.map((u) => Number(u.exponent) || 0));
  return exp || fallback;
}

async function measure(denom) {
  const enc = encodeURIComponent(denom);
  const [sup, meta] = await Promise.all([
    lcd(`/cosmos/bank/v1beta1/supply/by_denom?denom=${enc}`),
    lcd(`/cosmos/bank/v1beta1/denoms_metadata/${enc}`).catch(() => null),
  ]);
  const prec = precisionOf(meta?.metadata);
  const scale = 10 ** prec;
  const supply = Number(sup?.amount?.amount ?? 0) / scale;

  // by_query, not the path form: IBC denoms contain a slash, which breaks path
  // parameters and returns "Not Implemented".
  const balances = [];
  let key = null;
  let complete = false;
  for (let p = 0; p < OWNERS_MAX_PAGES; p++) {
    const q = new URLSearchParams({ denom, "pagination.limit": String(OWNERS_PAGE) });
    if (key) q.set("pagination.key", key);
    const d = await lcd(`/cosmos/bank/v1beta1/denom_owners_by_query?${q}`);
    for (const o of d?.denom_owners ?? []) {
      const amt = Number(o?.balance?.amount ?? 0) / scale;
      if (amt > 0) balances.push(amt);
    }
    key = d?.pagination?.next_key ?? null;
    if (!key) { complete = true; break; }
  }

  if (!complete || supply <= 0) {
    return { supply, holders: null, top1: null, top10: null, complete };
  }
  balances.sort((a, b) => b - a);
  const top10 = balances.slice(0, 10).reduce((s, v) => s + v, 0);
  return {
    supply,
    holders: balances.length,
    top1: (balances[0] ?? 0) / supply,
    top10: top10 / supply,
    complete,
  };
}

async function main() {
  const started = Date.now();
  const takenAt = new Date().toISOString();
  const known = await tracked();
  await detect(known);

  const all = DRY ? known : await tracked();
  const mainnet = all.filter((t) => t.network === "mainnet");
  if (mainnet.length === 0) {
    log("warn", "no mainnet stablecoins tracked. Has migration 021 run?");
  }

  let written = 0;
  for (const t of mainnet) {
    try {
      const m = await measure(t.denom);
      if (!m.complete) log("warn", `${t.symbol}: holder list incomplete, recorded as null`);
      log("info",
        `${t.symbol.padEnd(5)} supply ${m.supply.toLocaleString("en-US", { maximumFractionDigits: 2 })}` +
        ` holders ${m.holders ?? "?"} top1 ${m.top1 == null ? "?" : (m.top1 * 100).toFixed(1) + "%"}`);
      if (DRY) continue;
      await query(
        `INSERT INTO stablecoin_snapshots (taken_at, denom, supply, holders, top1_share, top10_share)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (denom, taken_at) DO NOTHING`,
        [takenAt, t.denom, m.supply, m.holders, m.top1, m.top10],
      );
      written++;
    } catch (e) {
      // One unreadable coin must not cost the others their snapshot.
      log("error", `${t.symbol} (${t.denom}) could not be measured: ${e.message}`);
    }
  }

  log("info", `done in ${((Date.now() - started) / 1000).toFixed(1)}s, ${written} snapshots written`);
}

main()
  .catch((e) => { log("error", e.stack || e.message); process.exitCode = 1; })
  .finally(() => closePool());
