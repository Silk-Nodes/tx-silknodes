#!/usr/bin/env node
/**
 * One-shot backfill for the price_usd daily series.
 *
 * Why this exists: the daily collector fetched price from CoinGecko's heaviest
 * endpoint and threw on the first failure, so once this VM's IP started getting
 * rate-limited the price series simply stopped. Every other metric kept
 * collecting normally, which is why it went unnoticed: price_usd froze at
 * 2026-04-24 while staked_pct, total_supply and the rest stayed current.
 *
 * collect-daily-analytics.mjs is now resilient (three endpoints, longer 429
 * backoff, optional demo key), but it only ever writes TODAY. This script fills
 * the hole it left behind, from CoinGecko's daily market_chart history.
 *
 * Usage:
 *   node vm-service/backfill-price-history.mjs           # fill gaps only
 *   node vm-service/backfill-price-history.mjs --days 365
 *   node vm-service/backfill-price-history.mjs --force   # overwrite existing
 *   node vm-service/backfill-price-history.mjs --dry-run
 *
 * Safe to re-run: it upserts one column, so days already present are left
 * alone unless --force is passed.
 */

import { writeDailyMetric } from "./db-writes.mjs";
import { query } from "./db.mjs";

const COINGECKO_API = "https://api.coingecko.com/api/v3";
const COINGECKO_ID = "tx";
const COINGECKO_KEY = process.env.COINGECKO_API_KEY || "";
// The chain rebranded on 2026-03-06; nothing before that belongs in this series.
const TX_ERA = "2026-03-06";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const FORCE = args.includes("--force");
const DAYS = Number(args[args.indexOf("--days") + 1]) || 365;

const log = (msg) => console.log(`[backfill-price] ${msg}`);

async function fetchDailyPrices(days) {
  const url = `${COINGECKO_API}/coins/${COINGECKO_ID}/market_chart?vs_currency=usd&days=${days}&interval=daily`;
  const headers = COINGECKO_KEY ? { "x-cg-demo-api-key": COINGECKO_KEY } : {};
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
  if (!res.ok) {
    throw new Error(
      res.status === 429
        ? "HTTP 429 (rate limited). Wait a minute, or set COINGECKO_API_KEY to a free demo key."
        : `HTTP ${res.status}`,
    );
  }
  const data = await res.json();
  const prices = data?.prices;
  if (!Array.isArray(prices) || prices.length === 0) {
    throw new Error("CoinGecko returned no price history");
  }
  // [[msTimestamp, price], ...] -> { 'YYYY-MM-DD': price }, last write wins so
  // a day appearing twice keeps its latest sample.
  const byDate = new Map();
  for (const [ms, price] of prices) {
    if (!(price > 0)) continue;
    byDate.set(new Date(ms).toISOString().slice(0, 10), price);
  }
  return byDate;
}

async function main() {
  log(`fetching ${DAYS} days of daily prices from CoinGecko...`);
  const byDate = await fetchDailyPrices(DAYS);
  log(`got ${byDate.size} daily points`);

  const existing = new Set(
    (await query(`SELECT date FROM daily_metrics WHERE price_usd IS NOT NULL`)).rows.map((r) =>
      r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10),
    ),
  );
  log(`${existing.size} days already have a price`);

  const today = new Date().toISOString().slice(0, 10);
  const todo = [...byDate.entries()]
    .filter(([date]) => date >= TX_ERA && date <= today)
    .filter(([date]) => FORCE || !existing.has(date))
    .sort(([a], [b]) => a.localeCompare(b));

  if (todo.length === 0) {
    log("nothing to backfill, series is already complete");
    return;
  }

  log(`${todo.length} days to write (${todo[0][0]} -> ${todo[todo.length - 1][0]})`);
  if (DRY_RUN) {
    for (const [date, price] of todo) log(`  DRY ${date} = ${price.toFixed(6)}`);
    log("dry run, nothing written");
    return;
  }

  let written = 0;
  for (const [date, price] of todo) {
    await writeDailyMetric(date, "price_usd", parseFloat(price.toFixed(6)));
    written++;
  }
  log(`done, wrote ${written} days`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`[backfill-price] FAILED: ${e.message}`);
    process.exit(1);
  });
