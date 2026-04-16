#!/usr/bin/env node

/**
 * Silk Nodes Daily Analytics Collector
 *
 * One-shot job that runs once per day (plus once on boot as a gap-fill).
 * Owns every file in src/data/analytics/ that the Analytics dashboard reads
 * as historical series. RPC-only where possible so there is no Cloudflare
 * rate-limiter and no Hasura dependency in the critical path.
 *
 * Metrics written:
 *   - transactions.json         daily tx count via RPC tx_search total_count
 *   - active-addresses.json     daily unique signers via RPC tx_search pages
 *   - total-stake.json          LCD staking pool bonded
 *   - staking-apr.json          annual_provisions * (1-tax) / bonded
 *   - staked-pct.json           bonded / circulating
 *   - total-supply.json         LCD bank supply
 *   - circulating-supply.json   TX API
 *   - pending-undelegations.json  LCD, one row per completion day
 *   - price-usd.json            CoinGecko daily snapshot
 *
 * Design principles:
 *   1. RPC only for the expensive per-day metrics. No Hasura, no CF.
 *   2. Per-metric try/catch. One flaky endpoint does not kill the run.
 *   3. Write-then-push. Partial progress always persists via git.
 *   4. Idempotent. Missing days are detected by reading the files; re-running
 *      is safe and only does work for what is actually missing.
 *   5. Push uses pull-rebase-retry so it cannot race with collect-staking-events
 *      pushing from the same VM.
 *
 * Environment variables:
 *   REPO_PATH    Path to the tx-silknodes repo (default: parent of this file's dir)
 *   GIT_PUSH     Set to "false" to skip git push (local testing)
 *   LOG_LEVEL    debug | info | warn | error  (default: info)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_PATH = process.env.REPO_PATH || resolve(__dirname, "..");
// Files live in public/analytics so the Next.js export ships them as static
// assets the browser can fetch at runtime. Static imports (src/data/analytics)
// bake into the JS bundle and require a Pages rebuild + browser hard-refresh
// to propagate, which is exactly the staleness problem we're solving.
const DATA_DIR = join(REPO_PATH, "public", "analytics");
const DATA_DIR_REL = "public/analytics";
const GIT_PUSH_ENABLED = process.env.GIT_PUSH !== "false";
const LOG_LEVEL = process.env.LOG_LEVEL || "info";

// ═══ CONFIG ═══
const RPC = "https://rpc-coreum.ecostake.com";
const LCD_PRIMARY = "https://rest-coreum.ecostake.com";
const LCD_FALLBACK = "https://full-node.mainnet-1.coreum.dev:1317";
const TX_API = "https://api.mainnet-1.tx.org/api/chain-data/v1";
const COINGECKO_API = "https://api.coingecko.com/api/v3";
const COINGECKO_ID = "tx";
const DENOM = "ucore";
const DECIMALS = 6;

const RPC_TIMEOUT_MS = 20_000;
const PUSH_ATTEMPTS = 4; // pull-rebase-retry budget when racing the staking-events collector

// ═══ LOGGING ═══
const levels = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = levels[LOG_LEVEL] ?? 1;
function log(level, ...args) {
  if (levels[level] < currentLevel) return;
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${level.toUpperCase()}]`, ...args);
}

// ═══ HELPERS ═══
function toDisplay(amount) {
  return Number(amount) / Math.pow(10, DECIMALS);
}

function todayUTC() {
  return new Date().toISOString().split("T")[0];
}

function yesterdayUTC() {
  return new Date(Date.now() - 86_400_000).toISOString().split("T")[0];
}

function addDay(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split("T")[0];
}

async function fetchJson(url, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(RPC_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, i)));
      }
    }
  }
  throw lastErr;
}

async function fetchLCD(path) {
  for (const base of [LCD_PRIMARY, LCD_FALLBACK]) {
    try {
      return await fetchJson(`${base}${path}`, 2);
    } catch (e) {
      log("warn", `  LCD fetch failed (${base}): ${e.message}`);
    }
  }
  throw new Error(`All LCD endpoints failed for ${path}`);
}

function formatExecError(e) {
  const parts = [e.message];
  const stderr = e.stderr?.toString().trim();
  const stdout = e.stdout?.toString().trim();
  if (stderr) parts.push(`stderr: ${stderr}`);
  if (stdout) parts.push(`stdout: ${stdout}`);
  return parts.join("\n");
}

// ═══ BLOCK RANGE (RPC-only binary search) ═══
// Public RPC nodes prune old blocks. We have to stay within the window the
// node actually serves or /block?height=X returns HTTP 500 and crashes our
// binary search. The earliest served height comes from /status.
async function getChainHeightRange() {
  const data = await fetchJson(`${RPC}/status`);
  const info = data?.result?.sync_info || {};
  return {
    earliest: Number(info.earliest_block_height) || 1,
    latest: Number(info.latest_block_height),
  };
}

async function getBlockTimestamp(height) {
  const data = await fetchJson(`${RPC}/block?height=${height}`);
  const time = data?.result?.block?.header?.time;
  if (!time) throw new Error(`block ${height} has no timestamp`);
  return new Date(time).getTime();
}

// Find the lowest block with timestamp >= target within [loBound, hiBound].
// Classic lower_bound binary search. Takes log2(range) RPC calls — for a
// ~2.3M block window (~4.5 months at 6s) that's ~22 calls.
async function findFirstBlockAtOrAfterTime(targetMs, loBound, hiBound) {
  let lo = loBound;
  let hi = hiBound;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const t = await getBlockTimestamp(mid);
    if (t < targetMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Returns { lo, hi } — the first and last block heights of the given UTC date.
// If the date falls outside the RPC's pruning window (below `earliest`) we
// return null so the caller can skip gracefully; requesting blocks below
// `earliest` would 500 the RPC.
async function fetchBlockHeightRangeForDate(date) {
  const startMs = new Date(`${date}T00:00:00Z`).getTime();
  const endMs = new Date(`${addDay(date, 1)}T00:00:00Z`).getTime();
  const { earliest, latest } = await getChainHeightRange();

  // Guard: if the RPC's earliest served block is already past the end of the
  // target day, we can't reconstruct this day — skip.
  const earliestTs = await getBlockTimestamp(earliest);
  if (earliestTs >= endMs) return null;

  const lo = await findFirstBlockAtOrAfterTime(startMs, earliest, latest);
  const firstOfNextDay = await findFirstBlockAtOrAfterTime(endMs, earliest, latest);
  const hi = firstOfNextDay - 1;

  if (hi < lo) return null; // date is in the future or has no blocks yet
  return { lo, hi };
}

// ═══ TX COUNT + ACTIVE ADDRESSES (RPC tx_search) ═══
async function fetchDailyTxCount(lo, hi) {
  const url = `${RPC}/tx_search?query=%22tx.height%3E%3D${lo}%20AND%20tx.height%3C%3D${hi}%22&per_page=1&page=1`;
  const data = await fetchJson(url);
  const total = data?.result?.total_count;
  if (total === undefined || total === null) throw new Error("RPC returned no total_count");
  return Number(total);
}

async function fetchDailyActiveAddresses(lo, hi, knownTxCount) {
  const senders = new Set();
  const perPage = 100;
  const totalPages = Math.ceil(knownTxCount / perPage);
  if (totalPages === 0) return 0;

  for (let page = 1; page <= totalPages; page++) {
    const url =
      `${RPC}/tx_search?query=%22tx.height%3E%3D${lo}%20AND%20tx.height%3C%3D${hi}%22` +
      `&per_page=${perPage}&page=${page}`;
    const data = await fetchJson(url);

    for (const tx of data.result?.txs || []) {
      for (const ev of tx.tx_result?.events || []) {
        if (ev.type !== "message") continue;
        for (const a of ev.attributes || []) {
          if (a.key === "sender" && typeof a.value === "string" && a.value.startsWith("core1")) {
            senders.add(a.value);
          }
        }
      }
    }

    if (page % 25 === 0) {
      log("info", `    page ${page}/${totalPages}, unique so far: ${senders.size}`);
    }
  }
  return senders.size;
}

// ═══ SNAPSHOT METRICS (today's values) ═══
async function fetchStakingPool() {
  const data = await fetchLCD("/cosmos/staking/v1beta1/pool");
  const bonded = toDisplay(data.pool.bonded_tokens);
  const notBonded = toDisplay(data.pool.not_bonded_tokens);
  return { bonded, notBonded };
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
  const res = await fetch(`${TX_API}/circulating-supply`, { signal: AbortSignal.timeout(RPC_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  return parseFloat(text.trim());
}

// Aggregate all validators' pending unbonding_delegations into a per-day map.
// Completed (past) undelegations are skipped because they've already been
// released and are no longer on-chain.
async function fetchPendingUndelegations() {
  const validators = [];
  let nextKey = "";
  while (true) {
    const url = nextKey
      ? `${LCD_PRIMARY}/cosmos/staking/v1beta1/validators?pagination.limit=200&pagination.key=${encodeURIComponent(nextKey)}`
      : `${LCD_PRIMARY}/cosmos/staking/v1beta1/validators?pagination.limit=200`;
    const d = await fetchJson(url, 3);
    validators.push(...d.validators.map((v) => v.operator_address));
    nextKey = d.pagination?.next_key || "";
    if (!nextKey) break;
  }

  const nowMs = Date.now();
  const dailyAmounts = {};
  for (const valAddr of validators) {
    try {
      const d = await fetchJson(
        `${LCD_PRIMARY}/cosmos/staking/v1beta1/validators/${valAddr}/unbonding_delegations?pagination.limit=1000`,
        2,
      );
      for (const resp of d.unbonding_responses || []) {
        for (const entry of resp.entries || []) {
          const completionMs = new Date(entry.completion_time).getTime();
          if (completionMs <= nowMs) continue;
          const dateKey = entry.completion_time.slice(0, 10);
          const amount = parseInt(entry.balance) / Math.pow(10, DECIMALS);
          dailyAmounts[dateKey] = (dailyAmounts[dateKey] || 0) + amount;
        }
      }
    } catch (e) {
      // Skip individual validator errors — the aggregate is still useful.
    }
  }
  return { dailyAmounts, validatorCount: validators.length };
}

async function fetchPrice() {
  const url = `${COINGECKO_API}/coins/${COINGECKO_ID}?localization=false&tickers=false&community_data=false&developer_data=false`;
  const data = await fetchJson(url);
  const price = data?.market_data?.current_price?.usd;
  if (!price || price <= 0) throw new Error("CoinGecko returned no price");
  return price;
}

// ═══ FILE HELPERS ═══
function readData(filename) {
  try {
    return JSON.parse(readFileSync(join(DATA_DIR, filename), "utf-8"));
  } catch {
    return [];
  }
}

function writeData(filename, data) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(join(DATA_DIR, filename), JSON.stringify(data, null, null));
}

function appendDataPoint(filename, date, value) {
  const data = readData(filename);
  const existing = data.findIndex((d) => d.date === date);
  if (existing >= 0) {
    data[existing].value = value;
    log("info", `  [${filename}] ${date} = ${value} (updated)`);
  } else {
    data.push({ date, value });
    data.sort((a, b) => a.date.localeCompare(b.date));
    log("info", `  [${filename}] ${date} = ${value} (appended)`);
  }
  writeData(filename, data);
}

// Compute missing dates for a file: from the day after its last entry up
// through YESTERDAY. Never fills today — day isn't complete yet.
function findMissingDays(filename) {
  const data = readData(filename);
  const last = data.length > 0 ? data[data.length - 1].date : null;
  const yesterday = yesterdayUTC();
  const startDate = last ? addDay(last, 1) : yesterday;

  const days = [];
  let d = startDate;
  while (d <= yesterday) {
    days.push(d);
    d = addDay(d, 1);
  }
  return days;
}

// ═══ GIT PUSH (pull-rebase-retry to survive races with the 24/7 collector) ═══
function gitCommitAndPush() {
  if (!GIT_PUSH_ENABLED) {
    log("debug", "Git push disabled via env");
    return;
  }

  let lastErr;
  for (let attempt = 1; attempt <= PUSH_ATTEMPTS; attempt++) {
    try {
      execSync(`cd ${REPO_PATH} && git pull --rebase --autostash origin main`, { stdio: "pipe" });

      const hasChanges = execSync(`cd ${REPO_PATH} && git diff --name-only ${DATA_DIR_REL}`, {
        stdio: "pipe",
        encoding: "utf-8",
      }).trim();
      if (!hasChanges) {
        log("info", "No analytics changes to commit");
        return;
      }

      const ts = new Date().toISOString().slice(0, 16);
      execSync(`cd ${REPO_PATH} && git add ${DATA_DIR_REL}`, { stdio: "pipe" });
      execSync(`cd ${REPO_PATH} && git commit -m "chore: update analytics data ${ts}"`, { stdio: "pipe" });
      execSync(`cd ${REPO_PATH} && git push origin main`, { stdio: "pipe" });
      log("info", `Pushed to GitHub: ${ts}`);
      return;
    } catch (e) {
      lastErr = e;
      const msg = formatExecError(e);
      const rejected = /rejected|non-fast-forward/.test(msg);
      if (!rejected && attempt === 1) {
        // Not a race — a real git error. Log the full thing so it's diagnosable.
        log("error", `Git push failed (attempt ${attempt}/${PUSH_ATTEMPTS}):\n${msg}`);
      } else {
        log("warn", `Git push attempt ${attempt}/${PUSH_ATTEMPTS} rejected — pulling and retrying`);
      }
      if (attempt < PUSH_ATTEMPTS) {
        const backoff = 2000 * attempt;
        execSync(`sleep ${backoff / 1000}`, { stdio: "ignore" });
      }
    }
  }
  throw new Error(`Git push failed after ${PUSH_ATTEMPTS} attempts: ${formatExecError(lastErr)}`);
}

// ═══ MAIN ═══
async function main() {
  log("info", "Silk Nodes Daily Analytics Collector starting");
  log("info", `REPO_PATH: ${REPO_PATH}`);
  log("info", `DATA_DIR: ${DATA_DIR}`);
  log("info", `GIT_PUSH: ${GIT_PUSH_ENABLED}`);

  const todayDate = todayUTC();
  let errors = 0;
  const results = {};

  // ─── 1. Backfill per-day tx count + active addresses for all missing days ───
  // transactions.json is the master file for these two metrics. Both files
  // stay in lockstep so reading either one tells us what to backfill.
  const missingDays = findMissingDays("transactions.json");
  if (missingDays.length === 0) {
    log("info", "No missing days for transactions + active addresses");
  } else {
    log("info", `Backfilling ${missingDays.length} day(s): ${missingDays.join(", ")}`);
  }
  for (const day of missingDays) {
    try {
      log("info", `[${day}] resolving block range via RPC binary search...`);
      const range = await fetchBlockHeightRangeForDate(day);
      if (!range) {
        log("warn", `[${day}] no blocks found on this date, skipping`);
        continue;
      }
      const { lo, hi } = range;
      log("info", `[${day}] blocks ${lo}..${hi} (${hi - lo + 1} blocks)`);

      const txCount = await fetchDailyTxCount(lo, hi);
      appendDataPoint("transactions.json", day, txCount);

      const activeAddrs = await fetchDailyActiveAddresses(lo, hi, txCount);
      appendDataPoint("active-addresses.json", day, activeAddrs);
    } catch (e) {
      // Per-day failures must not abort the remaining days. The next run
      // will retry this specific day. Whatever was written stays on disk.
      log("error", `[${day}] FAILED: ${e.message}`);
      errors++;
    }
  }

  // ─── 2. Snapshot metrics (today's values, overwrites existing today entry) ───
  const snapshot = [
    {
      name: "total-stake",
      fn: async () => {
        const { bonded } = await fetchStakingPool();
        return Math.round(bonded);
      },
    },
    {
      name: "staking-apr",
      fn: async () => {
        const [{ bonded }, prov, tax] = await Promise.all([
          fetchStakingPool(),
          fetchAnnualProvisions(),
          fetchCommunityTax(),
        ]);
        return parseFloat(((prov * (1 - tax) / bonded) * 100).toFixed(4));
      },
    },
    {
      name: "total-supply",
      fn: async () => Math.round(await fetchTotalSupply()),
    },
    {
      name: "circulating-supply",
      fn: async () => parseFloat((await fetchCirculatingSupply()).toFixed(2)),
    },
    {
      name: "staked-pct",
      fn: async () => {
        const [{ bonded }, circ] = await Promise.all([fetchStakingPool(), fetchCirculatingSupply()]);
        return parseFloat(((bonded / circ) * 100).toFixed(1));
      },
    },
    {
      name: "price-usd",
      fn: async () => parseFloat((await fetchPrice()).toFixed(6)),
    },
  ];

  for (const { name, fn } of snapshot) {
    try {
      log("info", `Fetching ${name}...`);
      const value = await fn();
      results[name] = value;
      appendDataPoint(`${name}.json`, todayDate, value);
    } catch (e) {
      log("error", `ERROR (${name}): ${e.message}`);
      errors++;
    }
  }

  // ─── 3. Pending undelegations (full rewrite each run, not append) ───
  try {
    log("info", "Fetching pending undelegations across all validators...");
    const { dailyAmounts, validatorCount } = await fetchPendingUndelegations();
    const pendingData = Object.entries(dailyAmounts)
      .map(([d, amount]) => ({ date: d, value: Math.round(amount) }))
      .sort((a, b) => a.date.localeCompare(b.date));
    writeData("pending-undelegations.json", pendingData);
    log("info", `  pending-undelegations.json: ${pendingData.length} days from ${validatorCount} validators`);
  } catch (e) {
    log("error", `ERROR (pending-undelegations): ${e.message}`);
    errors++;
  }

  // ─── 4. Commit and push ───
  try {
    gitCommitAndPush();
  } catch (e) {
    log("error", `Git push ultimately failed: ${e.message}`);
    errors++;
  }

  log("info", `Done. errors=${errors}`);
  if (errors > 0) process.exit(1);
}

main().catch((e) => {
  log("error", `Fatal error: ${e.stack || e.message}`);
  process.exit(2);
});
