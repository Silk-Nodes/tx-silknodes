#!/usr/bin/env node

/**
 * PSE Network Total Score Calculator (VM-side)
 *
 * Originally lived at scripts/update-pse-network-score.js and was driven
 * by GitHub Actions on a 6 h cron. Moved to the VM as part of the DB
 * migration so all collectors share one operational pattern (systemd
 * timer + dual-write to Postgres) and we drop a recurring source of
 * git push spam from CI.
 *
 * Enumerates all eligible delegators on Coreum and sums their real PSE
 * scores to produce the accurate network-wide Σ(S×T) denominator.
 *
 * Output:
 *   - public/pse-network-score.json (Phase 1: still the source of truth)
 *   - INSERT into pse_score (Phase 1 dual-write, time-series append)
 *
 * Schedule: silknodes-pse-score.timer fires every 6 h.
 */

import { writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { writePseScore } from "./db-writes.mjs";
import { closePool } from "./db.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_PATH = process.env.REPO_PATH || resolve(__dirname, "..");
const OUTPUT_PATH = join(REPO_PATH, "public", "pse-network-score.json");

// Phase 1 dual-write toggle. If PGUSER isn't set in env, runs JSON-only.
const DB_WRITES_ENABLED = !!process.env.PGUSER;

// Step 7 kill-switch. Defaults OFF — DB is the sole source of truth for
// PSE score. Set JSON_WRITES=true to re-enable the legacy JSON file.
const JSON_WRITES_ENABLED = process.env.JSON_WRITES === "true";

const API = "https://api.silknodes.io/coreum";
const PAGE_LIMIT = 500;
const CONCURRENCY = 20;

// Every read is pinned to one block, so the total is a sum of scores that
// all existed at the same moment. Unpinned, the 12:00 run on 6 Nov 2026 read
// for 13 minutes across the PSE payout: wallets read in the first minute
// still carried a month of score, the rest had just been reset, and the total
// came out ~20x too large. Our node serves recent heights; the public ones
// do not, which is why API stays on it.
let HEIGHT = null;

// A payout resets every score over ~60 blocks. Never snapshot inside it.
const PAYOUT_GUARD_SECONDS = 300;

async function fetchWithRetry(url, options = {}, attempt = 1) {
  try {
    const headers = HEIGHT ? { ...(options.headers ?? {}), "x-cosmos-block-height": String(HEIGHT) } : options.headers;
    const res = await fetch(url, { ...options, headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (attempt >= 3) throw err;
    await new Promise((r) => setTimeout(r, 500 * attempt));
    return fetchWithRetry(url, options, attempt + 1);
  }
}

async function pMap(items, fn, concurrency) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function fetchExcludedAddresses() {
  console.log("Fetching PSE excluded addresses...");
  const data = await fetchWithRetry(`${API}/tx/pse/v1/params`);
  const excluded = data?.params?.excluded_addresses ?? [];
  console.log(`  Excluding ${excluded.length} addresses`);
  return new Set(excluded);
}

async function fetchValidatorsByStatus(status) {
  const validators = [];
  let nextKey = null;
  do {
    const keyParam = nextKey ? `&pagination.key=${encodeURIComponent(nextKey)}` : "";
    const data = await fetchWithRetry(
      `${API}/cosmos/staking/v1beta1/validators?status=${status}&pagination.limit=${PAGE_LIMIT}${keyParam}`,
    );
    validators.push(...(data?.validators ?? []));
    nextKey = data?.pagination?.next_key ?? null;
  } while (nextKey);
  return validators;
}

async function fetchAllValidators() {
  console.log("Fetching all validators...");
  const [bonded, unbonding, unbonded] = await Promise.all([
    fetchValidatorsByStatus("BOND_STATUS_BONDED"),
    fetchValidatorsByStatus("BOND_STATUS_UNBONDING"),
    fetchValidatorsByStatus("BOND_STATUS_UNBONDED"),
  ]);
  const all = [...bonded, ...unbonding, ...unbonded];
  console.log(
    `  Bonded: ${bonded.length} | Unbonding: ${unbonding.length} | Unbonded: ${unbonded.length} | Total: ${all.length}`,
  );
  return all;
}

async function fetchAllDelegators(validators, excludedSet) {
  console.log("Enumerating delegators...");
  const delegatorSet = new Set();
  let skipped = 0;
  for (let i = 0; i < validators.length; i++) {
    const valAddr = validators[i].operator_address;
    let nextKey = null;
    do {
      const keyParam = nextKey ? `&pagination.key=${encodeURIComponent(nextKey)}` : "";
      const data = await fetchWithRetry(
        `${API}/cosmos/staking/v1beta1/validators/${valAddr}/delegations?pagination.limit=${PAGE_LIMIT}${keyParam}`,
      );
      for (const d of data?.delegation_responses ?? []) {
        const addr = d?.delegation?.delegator_address;
        if (!addr) continue;
        if (excludedSet.has(addr)) {
          skipped++;
          continue;
        }
        const balance = BigInt(d?.balance?.amount ?? "0");
        if (balance === 0n) {
          skipped++;
          continue;
        }
        delegatorSet.add(addr);
      }
      nextKey = data?.pagination?.next_key ?? null;
    } while (nextKey);
    if ((i + 1) % 10 === 0 || i === validators.length - 1) {
      process.stdout.write(
        `\r  Validator ${i + 1}/${validators.length} | Delegators: ${delegatorSet.size} | Skipped: ${skipped}   `,
      );
    }
  }
  console.log(`\n  Found ${delegatorSet.size} eligible delegators (${skipped} skipped)`);
  return [...delegatorSet];
}

async function sumNetworkScore(delegators) {
  console.log(`Fetching PSE scores for ${delegators.length} delegators (concurrency: ${CONCURRENCY})...`);
  let done = 0;
  let networkTotal = 0n;
  let withScore = 0;
  let errors = 0;

  await pMap(
    delegators,
    async (addr) => {
      // Straight from the chain at the pinned height. The GraphQL indexer this
      // used first (hasura.mainnet-1.coreum.dev) went dark on 5 Nov 2026, and
      // three failed attempts per wallet stretched each run to 13 minutes.
      try {
        const data = await fetchWithRetry(`${API}/tx/pse/v1/score/${addr}`);
        const score = BigInt(data?.score ?? "0");
        if (score > 0n) {
          networkTotal += score;
          withScore++;
        }
      } catch {
        errors++;
      }
      done++;
      if (done % 200 === 0 || done === delegators.length) {
        process.stdout.write(
          `\r  Progress: ${done}/${delegators.length} | With score: ${withScore} | Errors: ${errors}   `,
        );
      }
    },
    CONCURRENCY,
  );

  console.log();
  return { networkTotal, withScore, errors };
}

// The timer fires at 12:00 UTC, the same second payouts are scheduled. If a
// payout is within the guard window either side, wait until it is over.
async function waitOutPayout() {
  const data = await fetchWithRetry(`${API}/tx/pse/v1/scheduled_distributions`).catch(() => null);
  const list = Object.values(data ?? {}).find(Array.isArray) ?? [];
  const now = Date.now() / 1000;
  const near = list.map((d) => Number(d.timestamp)).find((ts) => Math.abs(now - ts) < PAYOUT_GUARD_SECONDS);
  if (!near) return;
  const waitMs = (near + PAYOUT_GUARD_SECONDS - now) * 1000;
  console.log(`PSE payout at ${new Date(near * 1000).toISOString()}, waiting ${Math.round(waitMs / 1000)}s`);
  await new Promise((r) => setTimeout(r, waitMs));
}

async function main() {
  console.log("PSE Network Total Score Calculator (VM)\n");
  console.log(
    DB_WRITES_ENABLED
      ? `DB_WRITES: enabled (dual-writing to ${process.env.PGDATABASE}@${process.env.PGHOST || "localhost"})`
      : "DB_WRITES: disabled (set PGUSER/PGPASSWORD/PGDATABASE to enable)",
  );
  console.log(
    JSON_WRITES_ENABLED
      ? "JSON_WRITES: enabled (legacy — writing public/pse-network-score.json)"
      : "JSON_WRITES: disabled (DB is authoritative; no file write)",
  );

  const start = Date.now();

  await waitOutPayout();
  const latest = await fetchWithRetry(`${API}/cosmos/base/tendermint/v1beta1/blocks/latest`);
  // Two blocks back, so every node behind the endpoint already has it.
  HEIGHT = Number(latest?.block?.header?.height) - 2;
  if (!Number.isFinite(HEIGHT) || HEIGHT <= 0) throw new Error("could not read the latest height");
  console.log(`Pinned to block ${HEIGHT}`);

  const excludedSet = await fetchExcludedAddresses();
  const validators = await fetchAllValidators();
  const delegators = await fetchAllDelegators(validators, excludedSet);
  const { networkTotal, withScore, errors } = await sumNetworkScore(delegators);

  const result = {
    networkTotalScore: networkTotal.toString(),
    eligibleDelegators: delegators.length,
    delegatorsWithScore: withScore,
    fetchErrors: errors,
    height: HEIGHT,
    updatedAt: new Date().toISOString(),
    updatedAtTimestamp: Math.floor(Date.now() / 1000),
  };

  // 1. Legacy JSON write. Step 7 gates this off by default — the
  //    frontend reads from /api/pse-score (Postgres) and nothing else
  //    consumes the file now.
  if (JSON_WRITES_ENABLED) {
    writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2) + "\n");
    console.log(`Saved to ${OUTPUT_PATH}`);
  }

  // 2. Dual-write to Postgres (now the authoritative source).
  //    Time-series row keyed on computed_at.
  if (DB_WRITES_ENABLED) {
    try {
      await writePseScore(result.updatedAt, result.networkTotalScore, result);
      console.log("db: pse_score row written");
    } catch (e) {
      console.error(`db: pse_score FAILED: ${e.message}`);
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log("\nResult:");
  console.log(JSON.stringify(result, null, 2));
  console.log(`Completed in ${elapsed}s`);
}

main()
  .catch((err) => {
    console.error("Error:", err.message);
    process.exitCode = 1;
  })
  // Drain the pg pool so the systemd-triggered process exits cleanly.
  .finally(() => closePool().catch(() => {}));
