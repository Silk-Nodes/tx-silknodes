#!/usr/bin/env node
// PSE Cohort Snapshot Collector
//
// Captures behavior of top-N PSE community recipients per cycle and
// writes a snapshot row to pse_cohort_snapshots. Designed to run daily
// via silknodes-pse-cohort.timer.
//
// Per cycle, per cohort size (100, 500, 1000):
//   - Snapshot the cohort at current chain height (or +7d, whichever is earlier).
//   - Bucket each recipient by bondedΔ vs received PSE.
//   - Store kept_bonded_tx, unbonded_tx, exited_wallet_tx, liquid_retained_tx.
//
// Idempotent: PRIMARY KEY (cycle, cohort_top_n, measured_at_height).
// Re-running at the same height inserts nothing (ON CONFLICT DO NOTHING).
//
// Closed cycles (window already past 7d) get exactly one final snapshot
// at the +7d height. The collector skips them on subsequent runs.
//
// Usage:
//   node vm-service/collect-pse-cohort.mjs                # daily run
//   node vm-service/collect-pse-cohort.mjs --backfill     # snapshot at +7d for closed cycles
//   node vm-service/collect-pse-cohort.mjs --dry-run      # don't write to DB
//
// READ-ONLY against Hasura. Writes only to pse_cohort_snapshots.

import { query, closePool } from "./db.mjs";

const HASURA = "https://hasura.mainnet-1.coreum.dev/v1/graphql";
const DECIMALS = 6;
const ucoreToTX = (s) => Number(BigInt(s)) / 10 ** DECIMALS;
const CONCURRENCY = 8;

const BLOCKS_PER_DAY = 98378; // measured from cycle1→cycle2 height gap
const SEVEN_DAY_BLOCKS = BLOCKS_PER_DAY * 7;

const TOP_NS = [100, 500, 1000];

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);
const DRY_RUN = args["dry-run"] === "true";
const BACKFILL = args.backfill === "true";

function ts() {
  return new Date().toISOString();
}
function log(level, ...rest) {
  console.log(`[${ts()}] [${level.toUpperCase()}]`, ...rest);
}

async function gql(queryStr) {
  const res = await fetch(HASURA, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: queryStr }),
  });
  const data = await res.json();
  if (data.errors) throw new Error(JSON.stringify(data.errors));
  return data.data;
}

async function fetchCurrentHeight() {
  const data = await gql(`{ block(order_by: {height: desc}, limit: 1) { height timestamp } }`);
  return { height: data.block[0].height, timestamp: data.block[0].timestamp };
}

async function fetchCommunityCycles() {
  const data = await gql(`{
    pse_distribution_allocation(
      where: { allocation_type: { _eq: "pse_community" } }
      order_by: { scheduled_at: asc }
    ) { distribution_id scheduled_at start_at_height total_amount }
  }`);
  return data.pse_distribution_allocation.map((d, i) => ({
    cycleNumber: i + 1,
    distributionId: d.distribution_id,
    scheduledAt: d.scheduled_at,
    distributedAtIso: new Date(d.scheduled_at * 1000).toISOString(),
    distributionHeight: d.start_at_height,
    fullPlus7dHeight: d.start_at_height + SEVEN_DAY_BLOCKS,
    totalDistributed: ucoreToTX(d.total_amount),
  }));
}

async function fetchTopRecipients(distributionId, topN) {
  const data = await gql(`{
    pse_transfer(
      where: {
        distribution_id: { _eq: ${distributionId} }
        allocation_type: { _eq: "pse_community" }
      }
      order_by: { amount: desc_nulls_last }
      limit: ${topN}
    ) { recipient_address amount }
  }`);
  return data.pse_transfer.map((r, i) => ({
    rank: i + 1,
    address: r.recipient_address,
    amountTX: ucoreToTX(r.amount),
  }));
}

function ucoreFromCoins(coins) {
  if (!coins) return "0";
  const c = coins.find((x) => x.denom === "ucore");
  return c ? c.amount : "0";
}
async function fetchBondedAt(address, height) {
  const data = await gql(`{
    action_delegation_total(address: "${address}", height: ${height}) { coins }
  }`);
  return ucoreFromCoins(data.action_delegation_total?.coins);
}
async function fetchLiquidAt(address, height) {
  const data = await gql(`{
    action_account_balance(address: "${address}", height: ${height}) { coins }
  }`);
  return ucoreFromCoins(data.action_account_balance?.coins);
}
async function fetchValidatorSelfBonds() {
  const data = await gql(`{ validator_info { self_delegate_address } }`);
  const set = new Set();
  for (const v of data.validator_info || []) {
    if (v.self_delegate_address) set.add(v.self_delegate_address);
  }
  return set;
}

async function pmap(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: n }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      try {
        out[idx] = await fn(items[idx], idx);
      } catch (e) {
        out[idx] = { __error: e.message };
      }
    }
  });
  await Promise.all(workers);
  return out;
}

function classify(received, bondedDelta) {
  if (received <= 0) return "kept_bonded";
  const ratio = bondedDelta / received;
  if (ratio < -0.01) return "net_drew_down";
  if (ratio >= 0.75) return "kept_bonded";
  if (ratio >= 0.25) return "partial_unbond";
  return "fully_unbonded";
}
function aggregate(rows) {
  const buckets = { kept_bonded: [], partial_unbond: [], fully_unbonded: [], net_drew_down: [] };
  for (const r of rows) buckets[r.bucket].push(r);
  const total = rows.length;
  return Object.fromEntries(
    Object.entries(buckets).map(([k, arr]) => [
      k,
      {
        count: arr.length,
        pct: total ? (arr.length / total) * 100 : 0,
        receivedTX: arr.reduce((s, r) => s + r.amountTX, 0),
        bondedDeltaTX: arr.reduce((s, r) => s + r.bondedDeltaTX, 0),
        liquidDeltaTX: arr.reduce((s, r) => s + r.liquidDeltaTX, 0),
      },
    ]),
  );
}

async function buildSnapshot(cycle, topN, measuredAtHeight, validatorSelfBonds) {
  const recipients = await fetchTopRecipients(cycle.distributionId, topN);
  const beforeHeight = cycle.distributionHeight - 1;
  const windowDaysCovered = Math.min(
    7,
    (measuredAtHeight - cycle.distributionHeight) / BLOCKS_PER_DAY,
  );
  const windowComplete = measuredAtHeight >= cycle.fullPlus7dHeight;

  const enriched = await pmap(recipients, CONCURRENCY, async (r) => {
    const [bondedBefore, bondedAfter, liquidBefore, liquidAfter] = await Promise.all([
      fetchBondedAt(r.address, beforeHeight),
      fetchBondedAt(r.address, measuredAtHeight),
      fetchLiquidAt(r.address, beforeHeight),
      fetchLiquidAt(r.address, measuredAtHeight),
    ]);
    const bondedBeforeTX = Number(BigInt(bondedBefore)) / 10 ** DECIMALS;
    const bondedAfterTX = Number(BigInt(bondedAfter)) / 10 ** DECIMALS;
    const liquidBeforeTX = Number(BigInt(liquidBefore)) / 10 ** DECIMALS;
    const liquidAfterTX = Number(BigInt(liquidAfter)) / 10 ** DECIMALS;
    const bondedDeltaTX = bondedAfterTX - bondedBeforeTX;
    const liquidDeltaTX = liquidAfterTX - liquidBeforeTX;
    return {
      ...r,
      bondedDeltaTX,
      liquidDeltaTX,
      bucket: classify(r.amountTX, bondedDeltaTX),
      isValidatorSelfBond: validatorSelfBonds.has(r.address),
    };
  });

  const valid = enriched.filter((r) => !r.__error);
  const ex = valid.filter((r) => !r.isValidatorSelfBond);

  const totalReceived = valid.reduce((s, r) => s + r.amountTX, 0);
  const totalBondedDelta = valid.reduce((s, r) => s + r.bondedDeltaTX, 0);
  const totalLiquidDelta = valid.reduce((s, r) => s + r.liquidDeltaTX, 0);
  const keptBondedTX = Math.max(0, Math.min(totalReceived, totalBondedDelta));
  const unbondedTX = Math.max(0, totalReceived - keptBondedTX);
  const liquidRetainedTX = Math.max(0, totalLiquidDelta);
  const exitedWalletTX = Math.max(0, unbondedTX - liquidRetainedTX);

  return {
    cycle: cycle.cycleNumber,
    cohort_top_n: topN,
    measured_at_height: measuredAtHeight,
    distribution_height: cycle.distributionHeight,
    full_plus_7d_height: cycle.fullPlus7dHeight,
    window_days_covered: windowDaysCovered,
    window_complete: windowComplete,
    cohort_size: valid.length,
    validator_self_bond_count: valid.filter((r) => r.isValidatorSelfBond).length,
    received_tx: totalReceived,
    bonded_delta_tx: totalBondedDelta,
    liquid_delta_tx: totalLiquidDelta,
    kept_bonded_tx: keptBondedTX,
    unbonded_tx: unbondedTX,
    exited_wallet_tx: exitedWalletTX,
    liquid_retained_tx: liquidRetainedTX,
    buckets: aggregate(valid),
    buckets_ex_validators: aggregate(ex),
  };
}

async function snapshotAlreadyExists(cycle, topN, height) {
  if (DRY_RUN) return false;
  const r = await query(
    `SELECT 1 FROM pse_cohort_snapshots
     WHERE cycle = $1 AND cohort_top_n = $2 AND measured_at_height = $3
     LIMIT 1`,
    [cycle, topN, height],
  );
  return r.rowCount > 0;
}

async function finalSnapshotExists(cycle, topN) {
  if (DRY_RUN) return false;
  const r = await query(
    `SELECT 1 FROM pse_cohort_snapshots
     WHERE cycle = $1 AND cohort_top_n = $2 AND window_complete = true
     LIMIT 1`,
    [cycle, topN],
  );
  return r.rowCount > 0;
}

async function insertSnapshot(snap) {
  if (DRY_RUN) {
    log("info", `[dry-run] would insert cycle=${snap.cycle} top=${snap.cohort_top_n} h=${snap.measured_at_height} keptPct=${((snap.kept_bonded_tx / snap.received_tx) * 100).toFixed(1)}%`);
    return;
  }
  await query(
    `INSERT INTO pse_cohort_snapshots (
       cycle, cohort_top_n, measured_at, measured_at_height,
       distribution_height, full_plus_7d_height,
       window_days_covered, window_complete, cohort_size, validator_self_bond_count,
       received_tx, bonded_delta_tx, liquid_delta_tx,
       kept_bonded_tx, unbonded_tx, exited_wallet_tx, liquid_retained_tx,
       buckets, buckets_ex_validators
     ) VALUES (
       $1, $2, NOW(), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18::jsonb
     ) ON CONFLICT (cycle, cohort_top_n, measured_at_height) DO NOTHING`,
    [
      snap.cycle,
      snap.cohort_top_n,
      snap.measured_at_height,
      snap.distribution_height,
      snap.full_plus_7d_height,
      snap.window_days_covered,
      snap.window_complete,
      snap.cohort_size,
      snap.validator_self_bond_count,
      snap.received_tx,
      snap.bonded_delta_tx,
      snap.liquid_delta_tx,
      snap.kept_bonded_tx,
      snap.unbonded_tx,
      snap.exited_wallet_tx,
      snap.liquid_retained_tx,
      JSON.stringify(snap.buckets),
      JSON.stringify(snap.buckets_ex_validators),
    ],
  );
}

async function processCycle(cycle, currentHeight, validatorSelfBonds) {
  const windowClosed = currentHeight >= cycle.fullPlus7dHeight;

  for (const topN of TOP_NS) {
    let measuredAtHeight;

    if (windowClosed) {
      // Snapshot the closed cycle exactly once at +7d. Skip if we
      // already have a window_complete=true row for this (cycle, topN).
      if (!BACKFILL && (await finalSnapshotExists(cycle.cycleNumber, topN))) {
        log("info", `cycle ${cycle.cycleNumber} top ${topN}: closed and already snapshotted, skip`);
        continue;
      }
      measuredAtHeight = cycle.fullPlus7dHeight;
    } else {
      // Open window: take a fresh snapshot at current height, but skip
      // if we already snapshotted at this exact height today.
      measuredAtHeight = currentHeight;
      if (await snapshotAlreadyExists(cycle.cycleNumber, topN, measuredAtHeight)) {
        log("info", `cycle ${cycle.cycleNumber} top ${topN}: already snapshotted at h=${measuredAtHeight}, skip`);
        continue;
      }
    }

    const start = Date.now();
    const snap = await buildSnapshot(cycle, topN, measuredAtHeight, validatorSelfBonds);
    const ms = Date.now() - start;
    log(
      "info",
      `cycle ${cycle.cycleNumber} top ${topN} h=${measuredAtHeight} ` +
        `(${(ms / 1000).toFixed(1)}s) · ` +
        `kept ${((snap.kept_bonded_tx / snap.received_tx) * 100).toFixed(1)}% · ` +
        `unbonded ${((snap.unbonded_tx / snap.received_tx) * 100).toFixed(1)}% · ` +
        `exited ${((snap.exited_wallet_tx / snap.received_tx) * 100).toFixed(1)}% · ` +
        `window ${snap.window_days_covered.toFixed(2)}d ${snap.window_complete ? "(closed)" : "(open)"}`,
    );
    await insertSnapshot(snap);
  }
}

async function main() {
  log("info", `PSE cohort collector (dry_run=${DRY_RUN}, backfill=${BACKFILL})`);

  const [cycles, current, validatorSelfBonds] = await Promise.all([
    fetchCommunityCycles(),
    fetchCurrentHeight(),
    fetchValidatorSelfBonds(),
  ]);
  log("info", `current height=${current.height}, ${cycles.length} cycles, ${validatorSelfBonds.size} validator self-bonds`);

  for (const cycle of cycles) {
    await processCycle(cycle, current.height, validatorSelfBonds);
  }

  await closePool();
  log("info", "done");
}

main().catch((e) => {
  log("error", e.stack || e.message);
  process.exit(1);
});
