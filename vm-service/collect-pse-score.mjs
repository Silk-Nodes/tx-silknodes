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

const API = "https://api.silknodes.io/coreum";
const GRAPHQL = "https://hasura.mainnet-1.coreum.dev/v1/graphql";
const PAGE_LIMIT = 500;
const CONCURRENCY = 20;

async function fetchWithRetry(url, options = {}, attempt = 1) {
  try {
    const res = await fetch(url, options);
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
      try {
        const data = await fetchWithRetry(GRAPHQL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: `{ action_pse_score(address: "${addr}") { score } }`,
          }),
        });
        const score = BigInt(data?.data?.action_pse_score?.score ?? "0");
        if (score > 0n) {
          networkTotal += score;
          withScore++;
        }
      } catch {
        // Fallback: try REST endpoint
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

async function main() {
  console.log("PSE Network Total Score Calculator (VM)\n");
  console.log(
    DB_WRITES_ENABLED
      ? `DB_WRITES: enabled (dual-writing to ${process.env.PGDATABASE}@${process.env.PGHOST || "localhost"})`
      : "DB_WRITES: disabled (set PGUSER/PGPASSWORD/PGDATABASE to enable)",
  );

  const start = Date.now();

  const excludedSet = await fetchExcludedAddresses();
  const validators = await fetchAllValidators();
  const delegators = await fetchAllDelegators(validators, excludedSet);
  const { networkTotal, withScore, errors } = await sumNetworkScore(delegators);

  const result = {
    networkTotalScore: networkTotal.toString(),
    eligibleDelegators: delegators.length,
    delegatorsWithScore: withScore,
    fetchErrors: errors,
    updatedAt: new Date().toISOString(),
    updatedAtTimestamp: Math.floor(Date.now() / 1000),
  };

  // 1. Write JSON (Phase 1: source of truth, still consumed by frontend)
  writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2) + "\n");

  // 2. Dual-write to Postgres (non-fatal — JSON is the safety net during
  //    Phase 1). Time-series row keyed on computed_at.
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
  console.log(`\nSaved to ${OUTPUT_PATH}`);
  console.log(`Completed in ${elapsed}s`);
}

main()
  .catch((err) => {
    console.error("Error:", err.message);
    process.exitCode = 1;
  })
  // Drain the pg pool so the systemd-triggered process exits cleanly.
  .finally(() => closePool().catch(() => {}));
