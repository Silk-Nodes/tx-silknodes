#!/usr/bin/env node
/**
 * TX price, read from the exchanges that list it. Runs every minute.
 *
 * Why: CoinGecko's free plan was the only price source and reached 80% of
 * its monthly cap on 2026-10-01. The venues publish their own tickers on
 * public endpoints with no key and limits far above one call a minute, and
 * reading them directly gives the site a price that does not trace back to
 * a single aggregator.
 *
 * Method, each run:
 *   1. Read every venue's 24h ticker in parallel.
 *   2. Drop a venue with no price, or more than OUTLIER off the median of the
 *      others. A frozen or broken book must not move the price.
 *   3. Price and 24h open are weighted by each venue's 24h volume in TX.
 *      The change is computed from the opens, not from the venues' own change
 *      fields: they disagree on units (Gate sends a percent, MEXC and Ourbit
 *      a fraction).
 *   4. Every CG_EVERY_MIN minutes, read CoinGecko and log when the two
 *      disagree by more than CG_WARN.
 *
 * USDT is taken as one dollar. Kraken quotes in USD.
 *
 * Usage:
 *   node vm-service/collect-price.mjs
 *   node vm-service/collect-price.mjs --dry-run   # prints, writes nothing
 */

const DRY = process.argv.includes("--dry-run");
const { query, closePool } = DRY
  ? { query: async () => ({ rows: [] }), closePool: async () => {} }
  : await import("./db.mjs");

const OUTLIER = 0.03;
const CG_WARN = 0.02;
const CG_EVERY_MIN = 30;
const CG_KEY = process.env.COINGECKO_API_KEY || "";

const log = (lvl, ...m) => console[lvl === "error" ? "error" : "log"](`[price] ${lvl}:`, ...m);

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Public third-party endpoints. Each returns { price, open, volume } with
// volume in TX over 24h.
const VENUES = {
  Gate: async () => {
    const [t] = await getJson("https://api.gateio.ws/api/v4/spot/tickers?currency_pair=TX_USDT");
    const price = Number(t.last);
    // Gate has no open field; its change_percentage is a percent.
    const open = price / (1 + Number(t.change_percentage) / 100);
    return { price, open, volume: Number(t.base_volume) };
  },
  Ourbit: async () => {
    const t = await getJson("https://api.ourbit.com/api/v3/ticker/24hr?symbol=TXUSDT");
    return { price: Number(t.lastPrice), open: Number(t.openPrice), volume: Number(t.volume) };
  },
  Kraken: async () => {
    const d = await getJson("https://api.kraken.com/0/public/Ticker?pair=TXUSD");
    if (d.error?.length) throw new Error(d.error.join(", "));
    const t = Object.values(d.result)[0];
    return { price: Number(t.c[0]), open: Number(t.o), volume: Number(t.v[1]) };
  },
  MEXC: async () => {
    const t = await getJson("https://api.mexc.com/api/v3/ticker/24hr?symbol=TXUSDT");
    return { price: Number(t.lastPrice), open: Number(t.openPrice), volume: Number(t.volume) };
  },
  Bitrue: async () => {
    const [t] = await getJson("https://openapi.bitrue.com/api/v1/ticker/24hr?symbol=TXUSDT");
    return { price: Number(t.lastPrice), open: Number(t.openPrice), volume: Number(t.volume) };
  },
};

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

async function main() {
  const takenAt = new Date();
  takenAt.setUTCSeconds(0, 0);

  const names = Object.keys(VENUES);
  const results = await Promise.allSettled(names.map((n) => VENUES[n]()));
  const sources = {};
  const ok = [];
  results.forEach((r, i) => {
    const n = names[i];
    if (r.status === "rejected") { sources[n] = { used: false, reason: r.reason?.message ?? "failed" }; return; }
    const v = r.value;
    if (!(v.price > 0) || !(v.volume >= 0)) { sources[n] = { used: false, reason: "no price" }; return; }
    ok.push({ n, ...v });
  });

  for (const v of ok) {
    const others = ok.filter((o) => o.n !== v.n).map((o) => o.price);
    const ref = others.length ? median(others) : v.price;
    const off = Math.abs(v.price / ref - 1);
    v.used = off <= OUTLIER;
    sources[v.n] = { price: v.price, volume: v.volume, used: v.used, ...(v.used ? {} : { reason: `${(off * 100).toFixed(1)}% off the others` }) };
  }

  const used = ok.filter((v) => v.used);
  if (used.length === 0) {
    // No row rather than a guess. /api/coin keeps serving the last good row
    // and says how old it is.
    log("error", "no venue usable this run", JSON.stringify(sources));
    process.exitCode = 1;
    return;
  }
  const w = used.reduce((s, v) => s + Math.max(v.volume, 1), 0);
  const price = used.reduce((s, v) => s + v.price * Math.max(v.volume, 1), 0) / w;
  const opens = used.filter((v) => v.open > 0);
  const wo = opens.reduce((s, v) => s + Math.max(v.volume, 1), 0);
  const open = wo ? opens.reduce((s, v) => s + v.open * Math.max(v.volume, 1), 0) / wo : null;
  const volumeUsd = used.reduce((s, v) => s + v.volume * v.price, 0);

  let cg = null;
  if (takenAt.getUTCMinutes() % CG_EVERY_MIN === 0) {
    try {
      const d = await getJson("https://api.coingecko.com/api/v3/simple/price?ids=tx&vs_currencies=usd",
        CG_KEY ? { "x-cg-demo-api-key": CG_KEY } : {});
      cg = Number(d?.tx?.usd) || null;
      if (cg && Math.abs(price / cg - 1) > CG_WARN) {
        log("warn", `exchanges ${price.toFixed(6)} vs CoinGecko ${cg.toFixed(6)}, ${((price / cg - 1) * 100).toFixed(1)}% apart`);
      }
    } catch (e) {
      log("warn", `CoinGecko cross-check failed: ${e.message}`);
    }
  }

  log("info", `price ${price.toFixed(6)} from ${used.length}/${names.length} venues` +
    (open ? `, 24h ${(((price / open) - 1) * 100).toFixed(2)}%` : "") +
    (cg ? `, CoinGecko ${cg.toFixed(6)}` : ""));
  const dropped = Object.entries(sources).filter(([, s]) => !s.used);
  if (dropped.length) log("warn", "dropped: " + dropped.map(([n, s]) => `${n} (${s.reason})`).join(", "));

  if (DRY) return;
  await query(
    `INSERT INTO price_ticks (taken_at, price_usd, open_24h, volume_usd, venues_used, sources, cg_price)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (taken_at) DO NOTHING`,
    [takenAt.toISOString(), price, open, volumeUsd, used.length, JSON.stringify(sources), cg],
  );
}

main()
  .catch((e) => { log("error", e.stack || e.message); process.exitCode = 1; })
  .finally(() => closePool());
