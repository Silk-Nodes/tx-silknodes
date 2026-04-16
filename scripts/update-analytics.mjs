#!/usr/bin/env node

/**
 * Daily Analytics Data Updater
 *
 * Fetches on-chain metrics from Coreum LCD/RPC endpoints and appends
 * today's data point to each JSON file in src/data/analytics/.
 *
 * Run manually:   node scripts/update-analytics.mjs
 * Run via CI:     GitHub Actions cron (see .github/workflows/update-analytics.yml)
 *
 * Metrics fetched:
 *   - Total Stake (LCD: staking pool)
 *   - Staking APR (LCD: provisions + tax + bonded)
 *   - Staked Ratio (calculated)
 *   - Total Supply (LCD: bank supply)
 *   - Circulating Supply (TX API)
 *   - Pending Undelegations (LCD: staking pool)
 *
 * Metrics NOT fetched (require block indexer):
 *   - Active Addresses (needs tx scanning)
 *   - Transactions (needs block iteration)
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "src", "data", "analytics");

// ═══ CONFIG ═══
const LCD_PRIMARY = "https://rest-coreum.ecostake.com";
const LCD_FALLBACK = "https://full-node.mainnet-1.coreum.dev:1317";
const RPC = "https://rpc-coreum.ecostake.com";
const HASURA = "https://hasura.mainnet-1.tx.org/v1/graphql";
const TX_API = "https://api.mainnet-1.tx.org/api/chain-data/v1";
const DENOM = "ucore";
const DECIMALS = 6;

function toDisplay(amount) {
  return Number(amount) / Math.pow(10, DECIMALS);
}

function today() {
  return new Date().toISOString().split("T")[0];
}

// ═══ FETCH HELPERS ═══
async function fetchLCD(path) {
  for (const base of [LCD_PRIMARY, LCD_FALLBACK]) {
    try {
      const res = await fetch(`${base}${path}`, {
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn(`  LCD fetch failed (${base}): ${e.message}`);
    }
  }
  throw new Error(`All LCD endpoints failed for ${path}`);
}

async function fetchText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

// ═══ METRIC FETCHERS ═══

async function fetchStakingPool() {
  const data = await fetchLCD("/cosmos/staking/v1beta1/pool");
  const bonded = toDisplay(data.pool.bonded_tokens);
  const notBonded = toDisplay(data.pool.not_bonded_tokens);
  return { bonded, notBonded, pendingUndelegations: notBonded };
}

async function fetchAnnualProvisions() {
  const data = await fetchLCD("/cosmos/mint/v1beta1/annual_provisions");
  return toDisplay(data.annual_provisions);
}

async function fetchCommunityTax() {
  const data = await fetchLCD("/cosmos/distribution/v1beta1/params");
  return parseFloat(data.params.community_tax);
}

async function fetchTotalSupply() {
  const data = await fetchLCD(`/cosmos/bank/v1beta1/supply/by_denom?denom=${DENOM}`);
  return toDisplay(data.amount.amount);
}

async function fetchCirculatingSupply() {
  const text = await fetchText(`${TX_API}/circulating-supply`);
  return parseFloat(text.trim());
}

// ═══ DATA FILE HELPERS ═══

function readData(filename) {
  try {
    const raw = readFileSync(join(DATA_DIR, filename), "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeData(filename, data) {
  writeFileSync(join(DATA_DIR, filename), JSON.stringify(data, null, null));
}

function appendDataPoint(filename, date, value) {
  const data = readData(filename);

  // Check if today already exists
  const existing = data.findIndex((d) => d.date === date);
  if (existing >= 0) {
    data[existing].value = value;
    console.log(`  Updated ${filename}: ${date} = ${value}`);
  } else {
    data.push({ date, value });
    console.log(`  Appended ${filename}: ${date} = ${value}`);
  }

  writeData(filename, data);
}

// ═══ TX / ACTIVE ADDRESSES (via RPC + Hasura) ═══

// Compute the list of days (YYYY-MM-DD strings) that are missing from the
// given daily-totals JSON file, from the day after its last entry up through
// YESTERDAY (exclusive of today — today's day isn't complete yet).
function findMissingDays(filename) {
  const data = readData(filename);
  const last = data.length > 0 ? data[data.length - 1].date : null;

  // Yesterday in UTC (the file stores per-day totals, and the workflow runs
  // at 00:15 UTC so "yesterday UTC" is the most recent complete day).
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().split("T")[0];

  // If there's no history, seed with just yesterday to avoid a giant backfill.
  // In practice this file already has months of data, so `last` will exist.
  const startDate = last ? addDay(last, 1) : yesterday;

  const days = [];
  let d = startDate;
  while (d <= yesterday) {
    days.push(d);
    d = addDay(d, 1);
  }
  return days;
}

function addDay(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split("T")[0];
}

// Find min and max block heights for a given UTC date via Hasura. Two small
// queries, well under the rate limit that trips Cloudflare.
//
// Both queries retry on transient failures (timeout, 5xx, Cloudflare HTML
// challenge response). Running-hot workflows can hit brief blips and we'd
// rather burn 30s of retries than lose a day of backfill work.
async function fetchBlockHeightRangeForDate(date) {
  const start = `${date}T00:00:00`;
  const end = addDay(date, 1) + "T00:00:00";

  const minR = await gqlWithRetry(
    `{ block(where: { timestamp: { _gte: "${start}" } }, order_by: { timestamp: asc }, limit: 1) { height } }`,
  );
  const maxR = await gqlWithRetry(
    `{ block(where: { timestamp: { _lt: "${end}" } }, order_by: { timestamp: desc }, limit: 1) { height } }`,
  );
  const lo = minR.data?.block?.[0]?.height;
  const hi = maxR.data?.block?.[0]?.height;
  if (!lo || !hi) return null;
  return { lo: Number(lo), hi: Number(hi) };
}

async function gqlWithRetry(query, attempts = 4) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(HASURA, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(30_000),
      });
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("json")) {
        // Cloudflare challenge page, rate-limit page, etc.
        throw new Error(`non-JSON response (HTTP ${res.status})`);
      }
      const json = await res.json();
      if (json.errors) {
        throw new Error(`GraphQL error: ${JSON.stringify(json.errors).slice(0, 200)}`);
      }
      return json;
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) {
        const backoff = 2000 * Math.pow(2, i); // 2s, 4s, 8s
        console.warn(`    hasura attempt ${i + 1}/${attempts} failed: ${e.message} — retrying in ${backoff / 1000}s`);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }
  throw new Error(`Hasura failed after ${attempts} attempts: ${lastErr.message}`);
}

// Daily tx count via RPC tx_search's total_count — one cheap HTTP call.
async function fetchDailyTxCount(lo, hi) {
  const url = `${RPC}/tx_search?query=%22tx.height%3E%3D${lo}%20AND%20tx.height%3C%3D${hi}%22&per_page=1&page=1`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`RPC tx_search HTTP ${res.status}`);
  const data = await res.json();
  const total = data.result?.total_count;
  if (!total) throw new Error(`RPC tx_search returned no total_count`);
  return Number(total);
}

// Daily active (unique signing) addresses. We paginate RPC tx_search at
// per_page=100 and collect distinct `message.sender` event attributes from
// each tx's event log. Cosmos SDK emits exactly one `message.sender` per tx
// per message, which reliably maps to the signing account — much more robust
// than decoding tx bodies or walking signer_infos.
//
// Cost: ~ceil(txCount/100) RPC calls. For a busy day (~13K txs) that's ~135
// calls / ~2 minutes — well under the workflow's 6h budget. For a full 7-day
// backfill we're under 15 min total.
async function fetchDailyActiveAddresses(lo, hi, knownTxCount) {
  const senders = new Set();
  const perPage = 100;
  const totalPages = Math.ceil(knownTxCount / perPage);
  if (totalPages === 0) return 0;

  for (let page = 1; page <= totalPages; page++) {
    const url =
      `${RPC}/tx_search?query=%22tx.height%3E%3D${lo}%20AND%20tx.height%3C%3D${hi}%22` +
      `&per_page=${perPage}&page=${page}&order_by=%22asc%22`;
    let data;
    // Small retry with backoff — RPC can blip under load.
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();
        break;
      } catch (e) {
        if (attempt === 3) throw e;
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }

    for (const tx of data.result?.txs || []) {
      for (const ev of tx.tx_result?.events || []) {
        if (ev.type !== "message") continue;
        for (const a of ev.attributes || []) {
          if (a.key === "sender" && a.value?.startsWith("core1")) {
            senders.add(a.value);
          }
        }
      }
    }

    if (page % 25 === 0) {
      console.log(`      page ${page}/${totalPages}, unique so far: ${senders.size}`);
    }
  }
  return senders.size;
}

// ═══ MAIN ═══

async function main() {
  const date = today();
  console.log(`\nUpdating analytics data for ${date}\n`);

  let errors = 0;

  // 1. Total Stake
  try {
    console.log("Fetching staking pool...");
    const pool = await fetchStakingPool();
    appendDataPoint("total-stake.json", date, Math.round(pool.bonded));
  } catch (e) {
    console.error(`  ERROR (staking pool): ${e.message}`);
    errors++;
  }

  // 1b. Pending Undelegations (query all validators for unbonding entries)
  try {
    console.log("Fetching pending undelegations (all validators)...");

    // Get all validators
    let validators = [];
    let nextKey = "";
    while (true) {
      const url = nextKey
        ? `${LCD_PRIMARY}/cosmos/staking/v1beta1/validators?pagination.limit=100&pagination.key=${encodeURIComponent(nextKey)}`
        : `${LCD_PRIMARY}/cosmos/staking/v1beta1/validators?pagination.limit=100`;
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const d = await res.json();
      validators.push(...d.validators.map((v) => v.operator_address));
      nextKey = d.pagination?.next_key || "";
      if (!nextKey) break;
    }

    // For each validator, get unbonding entries and group by completion date
    // Only include entries whose completion_time is in the FUTURE (not yet completed)
    const nowMs = Date.now();
    const dailyAmounts = {};

    for (const valAddr of validators) {
      try {
        const res = await fetch(
          `${LCD_PRIMARY}/cosmos/staking/v1beta1/validators/${valAddr}/unbonding_delegations?pagination.limit=1000`,
          { signal: AbortSignal.timeout(10000) }
        );
        const d = await res.json();
        for (const resp of (d.unbonding_responses || [])) {
          for (const entry of (resp.entries || [])) {
            const completionMs = new Date(entry.completion_time).getTime();
            // Skip entries already completed (completion_time is in the past)
            if (completionMs <= nowMs) continue;
            const dateKey = entry.completion_time.slice(0, 10);
            const amount = parseInt(entry.balance) / Math.pow(10, DECIMALS);
            dailyAmounts[dateKey] = (dailyAmounts[dateKey] || 0) + amount;
          }
        }
      } catch (e) {
        // Skip individual validator errors
      }
    }

    // Replace entire file with only active (pending) undelegations
    // Completed undelegations are no longer on-chain, so they won't appear
    const pendingData = Object.entries(dailyAmounts)
      .map(([d, amount]) => ({ date: d, value: Math.round(amount) }))
      .sort((a, b) => a.date.localeCompare(b.date));

    writeData("pending-undelegations.json", pendingData);
    console.log(`  Updated pending-undelegations.json: ${Object.keys(dailyAmounts).length} days from ${validators.length} validators`);
  } catch (e) {
    console.error(`  ERROR (pending undelegations): ${e.message}`);
    errors++;
  }

  // 2. Staking APR
  try {
    console.log("Calculating staking APR...");
    const [pool, provisions, tax] = await Promise.all([
      fetchStakingPool(),
      fetchAnnualProvisions(),
      fetchCommunityTax(),
    ]);
    const apr = (provisions * (1 - tax) / pool.bonded) * 100;
    appendDataPoint("staking-apr.json", date, parseFloat(apr.toFixed(4)));
  } catch (e) {
    console.error(`  ERROR (staking APR): ${e.message}`);
    errors++;
  }

  // 3. Total Supply
  try {
    console.log("Fetching total supply...");
    const totalSupply = await fetchTotalSupply();
    appendDataPoint("total-supply.json", date, Math.round(totalSupply));
  } catch (e) {
    console.error(`  ERROR (total supply): ${e.message}`);
    errors++;
  }

  // 4. Circulating Supply
  try {
    console.log("Fetching circulating supply...");
    const circulating = await fetchCirculatingSupply();
    appendDataPoint("circulating-supply.json", date, parseFloat(circulating.toFixed(2)));
  } catch (e) {
    console.error(`  ERROR (circulating supply): ${e.message}`);
    errors++;
  }

  // 5. Staked Ratio (depends on bonded + circulating)
  try {
    console.log("Calculating staked ratio...");
    const pool = await fetchStakingPool();
    const circulating = await fetchCirculatingSupply();
    const ratio = (pool.bonded / circulating) * 100;
    appendDataPoint("staked-pct.json", date, parseFloat(ratio.toFixed(1)));
  } catch (e) {
    console.error(`  ERROR (staked ratio): ${e.message}`);
    errors++;
  }

  // 6. TX Price (CoinGecko)
  try {
    console.log("Fetching TX price...");
    const res = await fetch("https://api.coingecko.com/api/v3/coins/tx?localization=false&tickers=false&community_data=false&developer_data=false", {
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const data = await res.json();
      const price = data?.market_data?.current_price?.usd ?? 0;
      if (price > 0) {
        appendDataPoint("price-usd.json", date, parseFloat(price.toFixed(6)));
      }
    }
  } catch (e) {
    console.error(`  ERROR (price): ${e.message}`);
    errors++;
  }

  // 7. Transactions + Active Addresses (per-day via RPC + Hasura block range)
  //
  // Both metrics are daily aggregates, so we backfill every missing day from
  // the last committed entry up through yesterday. We never write today because
  // the day isn't complete yet — partial-day numbers would mislead users.
  //
  // Each day is wrapped in its own try/catch so a transient Cloudflare/RPC blip
  // on day N doesn't throw away the completed work for days 1..N-1. Each day
  // writes to disk as it finishes, so even a total workflow failure doesn't
  // waste progress — the next run will pick up from the last written day.
  console.log("Fetching daily transactions + active addresses...");
  const missingDays = findMissingDays("transactions.json");
  if (missingDays.length === 0) {
    console.log("  No missing days — tx/active-addresses already current");
  } else {
    console.log(`  Backfilling ${missingDays.length} day(s): ${missingDays.join(", ")}`);
  }
  let daysDone = 0;
  let daysFailed = 0;
  for (const day of missingDays) {
    try {
      console.log(`  [${day}] resolving block range...`);
      const range = await fetchBlockHeightRangeForDate(day);
      if (!range) {
        console.warn(`  [${day}] no blocks found, skipping`);
        continue;
      }
      const { lo, hi } = range;

      const txCount = await fetchDailyTxCount(lo, hi);
      appendDataPoint("transactions.json", day, txCount);

      const activeAddrs = await fetchDailyActiveAddresses(lo, hi, txCount);
      appendDataPoint("active-addresses.json", day, activeAddrs);
      daysDone++;
    } catch (e) {
      // Don't bail — the next day might succeed, and the next workflow run
      // will retry this specific day. Each appendDataPoint above has already
      // persisted any prior day's work to disk.
      console.error(`  [${day}] FAILED: ${e.message}`);
      daysFailed++;
    }
  }
  if (daysFailed > 0) {
    console.warn(`  Completed ${daysDone}/${missingDays.length} days, ${daysFailed} failed (will retry next run).`);
  }

  console.log(`\nDone. ${errors > 0 ? `${errors} error(s) occurred.` : "All metrics updated successfully."}\n`);

  if (errors > 0) process.exit(1);
}

main().catch((e) => {
  console.error(`Fatal error: ${e.message}`);
  process.exit(1);
});
