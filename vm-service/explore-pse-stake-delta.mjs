#!/usr/bin/env node
// PSE cohort — stake delta analysis (Path B)
//
// For each top-N PSE community recipient per cycle:
//   - bonded stake at distribution height
//   - bonded stake at distribution height + 7 days (~688k blocks)
//   - delta = stake_after - stake_before
//   - bucket by (delta / amount_received):
//       compounded   delta >= +25% of received  (re-staked most of it)
//       partial      delta within (+1%, +25%)   (re-staked some)
//       flat         delta within ±1% of received  (kept liquid, no move)
//       drawn_down   delta <= -1% of received   (unbonded — possibly to sell)
//
// All data comes from Hasura's action_delegation_total(address, height).
// READ-ONLY. Writes /tmp/pse-stake-delta-cycle{N}.json + summary.
// No PR. No production writes.
//
// Usage:
//   node vm-service/explore-pse-stake-delta.mjs              # both cycles, top 100
//   node vm-service/explore-pse-stake-delta.mjs --top=500
//   node vm-service/explore-pse-stake-delta.mjs --cycle=2

import { writeFileSync } from "node:fs";

const HASURA = "https://hasura.mainnet-1.coreum.dev/v1/graphql";
const DECIMALS = 6;
const ucoreToTX = (s) => Number(BigInt(s)) / 10 ** DECIMALS;
const CONCURRENCY = 8;

// Cycle 1 height = 69509771, Cycle 2 height = 72461119, gap = 2,951,348
// blocks over 30 days = 98,378 blocks/day. 7 days ≈ 688,648 blocks.
const BLOCKS_PER_DAY = 98378;
const SEVEN_DAY_BLOCKS = BLOCKS_PER_DAY * 7;

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);
const TOP_N = Number(args.top || 100);
const ONLY_CYCLE = args.cycle ? Number(args.cycle) : null;

async function gqlQuery(query) {
  const res = await fetch(HASURA, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const data = await res.json();
  if (data.errors) throw new Error(JSON.stringify(data.errors));
  return data.data;
}

async function fetchCommunityCycles() {
  const data = await gqlQuery(`{
    pse_distribution_allocation(
      where: { allocation_type: { _eq: "pse_community" } }
      order_by: { scheduled_at: asc }
    ) {
      distribution_id scheduled_at start_at_height total_amount
    }
  }`);
  return data.pse_distribution_allocation.map((d, i) => ({
    cycleNumber: i + 1,
    distributionId: d.distribution_id,
    scheduledAt: d.scheduled_at,
    distributedAtIso: new Date(d.scheduled_at * 1000).toISOString(),
    distributionHeight: d.start_at_height,
    plus7dHeight: d.start_at_height + SEVEN_DAY_BLOCKS,
    totalDistributed: ucoreToTX(d.total_amount),
  }));
}

async function fetchTopRecipients(distributionId, topN) {
  const data = await gqlQuery(`{
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

// Bonded total at a specific block height. Returns ucore as bigint
// string (or "0" if address has no delegation at that height — Hasura
// returns coins:[] which we map to 0).
async function fetchBondedAt(address, height) {
  const data = await gqlQuery(`{
    action_delegation_total(address: "${address}", height: ${height}) {
      coins
    }
  }`);
  const coins = data.action_delegation_total?.coins || [];
  const ucore = coins.find((c) => c.denom === "ucore");
  return ucore ? ucore.amount : "0";
}

// Run an async map with bounded concurrency. Avoids blasting Hasura
// with 100 simultaneous requests (which Hasura tolerates but the
// node-fetch socket pool doesn't).
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

function classify(received, deltaTX) {
  if (received <= 0) return "flat";
  const ratio = deltaTX / received;
  if (ratio >= 0.25) return "compounded";
  if (ratio >= 0.01) return "partial";
  if (ratio <= -0.01) return "drawn_down";
  return "flat";
}

async function analyzeCycle(cycle) {
  console.log(
    `\n══ Cycle ${cycle.cycleNumber} — distributed at h=${cycle.distributionHeight} (${cycle.distributedAtIso}) ══`,
  );
  console.log(`  +7d height: ${cycle.plus7dHeight} (~${(SEVEN_DAY_BLOCKS / BLOCKS_PER_DAY).toFixed(0)} days of blocks)`);
  console.log(`  Total distributed (community): ${cycle.totalDistributed.toLocaleString()} TX`);

  const recipients = await fetchTopRecipients(cycle.distributionId, TOP_N);
  console.log(`  Fetching bonded stake at 2 heights for ${recipients.length} addresses (concurrency ${CONCURRENCY})...`);

  const start = Date.now();
  const enriched = await pmap(recipients, CONCURRENCY, async (r) => {
    const [beforeUcore, afterUcore] = await Promise.all([
      fetchBondedAt(r.address, cycle.distributionHeight),
      fetchBondedAt(r.address, cycle.plus7dHeight),
    ]);
    const before = Number(BigInt(beforeUcore)) / 10 ** DECIMALS;
    const after = Number(BigInt(afterUcore)) / 10 ** DECIMALS;
    const delta = after - before;
    const deltaPctOfReceived = r.amountTX > 0 ? (delta / r.amountTX) * 100 : 0;
    return {
      ...r,
      bondedBeforeTX: before,
      bondedAfterTX: after,
      deltaTX: delta,
      deltaPctOfReceived,
      bucket: classify(r.amountTX, delta),
    };
  });
  console.log(`  Done in ${((Date.now() - start) / 1000).toFixed(1)}s`);

  // Aggregate.
  const buckets = { compounded: [], partial: [], flat: [], drawn_down: [] };
  for (const r of enriched) {
    if (r.__error) continue;
    buckets[r.bucket].push(r);
  }
  const summary = {
    cycle: cycle.cycleNumber,
    distributionId: cycle.distributionId,
    distributedAtIso: cycle.distributedAtIso,
    distributionHeight: cycle.distributionHeight,
    plus7dHeight: cycle.plus7dHeight,
    cohortSize: enriched.filter((r) => !r.__error).length,
    cohortReceivedTX: enriched.reduce((s, r) => s + (r.amountTX || 0), 0),
    netCohortDeltaTX: enriched.reduce((s, r) => s + (r.deltaTX || 0), 0),
    buckets: Object.fromEntries(
      Object.entries(buckets).map(([k, arr]) => [
        k,
        {
          count: arr.length,
          pct: enriched.length ? (arr.length / enriched.length) * 100 : 0,
          receivedTX: arr.reduce((s, r) => s + r.amountTX, 0),
          netDeltaTX: arr.reduce((s, r) => s + r.deltaTX, 0),
        },
      ]),
    ),
  };

  console.log("\n  Buckets (delta vs received PSE):");
  for (const [name, info] of Object.entries(summary.buckets)) {
    console.log(
      `    ${name.padEnd(11)} ${info.count.toString().padStart(3)} addrs ` +
        `(${info.pct.toFixed(1).padStart(5)}%) · received ` +
        `${info.receivedTX.toLocaleString(undefined, { maximumFractionDigits: 0 })} TX · ` +
        `net Δ ${info.netDeltaTX.toLocaleString(undefined, { maximumFractionDigits: 0 })} TX`,
    );
  }
  console.log(
    `\n  Net cohort stake change: ${summary.netCohortDeltaTX.toLocaleString(undefined, { maximumFractionDigits: 0 })} TX ` +
      `out of ${summary.cohortReceivedTX.toLocaleString(undefined, { maximumFractionDigits: 0 })} TX received ` +
      `(${((summary.netCohortDeltaTX / summary.cohortReceivedTX) * 100).toFixed(1)}% recompounded)`,
  );

  const errors = enriched.filter((r) => r.__error);
  if (errors.length) {
    console.log(`\n  ${errors.length} addresses failed (per-validator hasura issue?)`);
  }

  const path = `/tmp/pse-stake-delta-cycle${cycle.cycleNumber}.json`;
  writeFileSync(path, JSON.stringify({ summary, recipients: enriched }, null, 2));
  console.log(`  Wrote ${path}`);

  return summary;
}

async function main() {
  console.log("PSE Stake Delta Analysis (Path B)");
  console.log(`Top N: ${TOP_N}, concurrency: ${CONCURRENCY}`);

  const cycles = await fetchCommunityCycles();
  console.log(`\nDiscovered ${cycles.length} community-pool cycles.`);

  const target = ONLY_CYCLE
    ? cycles.filter((c) => c.cycleNumber === ONLY_CYCLE)
    : cycles;

  const summaries = [];
  for (const cycle of target) {
    summaries.push(await analyzeCycle(cycle));
  }

  const path = "/tmp/pse-stake-delta-summary.json";
  writeFileSync(path, JSON.stringify({ generatedAt: new Date().toISOString(), summaries }, null, 2));
  console.log(`\nSummary: ${path}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
