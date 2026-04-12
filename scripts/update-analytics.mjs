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
            const completionDate = new Date(entry.completion_time);
            const dateKey = completionDate.toISOString().split("T")[0];
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

  // NOTE: Active Addresses and Transactions require a block indexer
  // and cannot be fetched from LCD endpoints.
  // These will need a separate data source (Mintscan API, custom indexer, etc.)

  console.log(`\nDone. ${errors > 0 ? `${errors} error(s) occurred.` : "All metrics updated successfully."}\n`);

  if (errors > 0) process.exit(1);
}

main().catch((e) => {
  console.error(`Fatal error: ${e.message}`);
  process.exit(1);
});
