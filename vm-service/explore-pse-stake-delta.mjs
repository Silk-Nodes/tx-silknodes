#!/usr/bin/env node
// PSE cohort — stake delta analysis (Path B)
//
// For each top-N PSE community recipient per cycle:
//   - bonded stake at distribution height
//   - bonded stake at min(distribution_height + 7d, current_height)
//   - delta = stake_after - stake_before
//   - bucket by (delta / amount_received):
//       compounded   delta >= +25% of received
//       partial      delta within (+1%, +25%)
//       flat         delta within ±1% of received
//       drawn_down   delta <= -1% of received
//
// Two enhancements over the original script:
//   1. Cycles whose +7d window hasn't closed yet clamp the second
//      query to current chain height. The summary annotates
//      windowDaysCovered so the UI can render "Day 1 of 7".
//   2. Validator self-bonds (operator address == delegator address)
//      are flagged so the UI can show a number with and without them
//      — these structurally don't compound and would skew the
//      "stakers held" narrative if mixed in.
//
// All data from Hasura. READ-ONLY. Writes to /tmp.
//
// Usage:
//   node vm-service/explore-pse-stake-delta.mjs
//   node vm-service/explore-pse-stake-delta.mjs --top=500
//   node vm-service/explore-pse-stake-delta.mjs --cycle=2

import { writeFileSync } from "node:fs";

const HASURA = "https://hasura.mainnet-1.coreum.dev/v1/graphql";
const DECIMALS = 6;
const ucoreToTX = (s) => Number(BigInt(s)) / 10 ** DECIMALS;
const CONCURRENCY = 8;

// Cycle 1→2 height gap = 2,951,348 over exactly 30 days = 98,378 blocks/day.
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

async function fetchCurrentHeight() {
  const data = await gqlQuery(`{ block(order_by: {height: desc}, limit: 1) { height timestamp } }`);
  return { height: data.block[0].height, timestamp: data.block[0].timestamp };
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
    fullPlus7dHeight: d.start_at_height + SEVEN_DAY_BLOCKS,
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

// Validator operator addresses (corevaloper...) → corresponding self-bond
// account address (core...). Cosmos SDK derives both from the same
// pubkey, so the SDK exposes a per-validator self_delegate_address.
// We use Hasura's validator_info table to grab the mapping in one call.
async function fetchValidatorSelfBonds() {
  const data = await gqlQuery(`{
    validator_info { self_delegate_address operator_address }
  }`);
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

function classify(received, deltaTX) {
  if (received <= 0) return "flat";
  const ratio = deltaTX / received;
  if (ratio >= 0.25) return "compounded";
  if (ratio >= 0.01) return "partial";
  if (ratio <= -0.01) return "drawn_down";
  return "flat";
}

function emptyBuckets() {
  return { compounded: [], partial: [], flat: [], drawn_down: [] };
}

function aggregate(enriched) {
  const buckets = emptyBuckets();
  for (const r of enriched) {
    if (r.__error) continue;
    buckets[r.bucket].push(r);
  }
  const valid = enriched.filter((r) => !r.__error);
  return Object.fromEntries(
    Object.entries(buckets).map(([k, arr]) => [
      k,
      {
        count: arr.length,
        pct: valid.length ? (arr.length / valid.length) * 100 : 0,
        receivedTX: arr.reduce((s, r) => s + r.amountTX, 0),
        netDeltaTX: arr.reduce((s, r) => s + r.deltaTX, 0),
      },
    ]),
  );
}

async function analyzeCohort(cycle, topN, currentHeight, validatorSelfBonds) {
  const recipients = await fetchTopRecipients(cycle.distributionId, topN);
  const plus7dHeight = Math.min(cycle.fullPlus7dHeight, currentHeight);
  const windowDaysCovered = Math.min(
    7,
    (plus7dHeight - cycle.distributionHeight) / BLOCKS_PER_DAY,
  );
  const windowComplete = plus7dHeight === cycle.fullPlus7dHeight;

  const enriched = await pmap(recipients, CONCURRENCY, async (r) => {
    const [beforeUcore, afterUcore] = await Promise.all([
      fetchBondedAt(r.address, cycle.distributionHeight),
      fetchBondedAt(r.address, plus7dHeight),
    ]);
    const before = Number(BigInt(beforeUcore)) / 10 ** DECIMALS;
    const after = Number(BigInt(afterUcore)) / 10 ** DECIMALS;
    const delta = after - before;
    const isValidatorSelfBond = validatorSelfBonds.has(r.address);
    return {
      ...r,
      bondedBeforeTX: before,
      bondedAfterTX: after,
      deltaTX: delta,
      deltaPctOfReceived: r.amountTX > 0 ? (delta / r.amountTX) * 100 : 0,
      bucket: classify(r.amountTX, delta),
      isValidatorSelfBond,
    };
  });

  const validRows = enriched.filter((r) => !r.__error);
  const ex = validRows.filter((r) => !r.isValidatorSelfBond);

  const totalReceived = validRows.reduce((s, r) => s + r.amountTX, 0);
  const totalDelta = validRows.reduce((s, r) => s + r.deltaTX, 0);
  // "Liquid overhang" = received - net positive delta. Doesn't double-count
  // negative deltas (those are net liquid too, but already accounted).
  const reBondedTX = Math.max(0, totalDelta);
  const liquidOverhangTX = Math.max(0, totalReceived - reBondedTX);

  return {
    cohortSize: validRows.length,
    receivedTX: totalReceived,
    netDeltaTX: totalDelta,
    reBondedTX,
    liquidOverhangTX,
    reBondPct: totalReceived ? (reBondedTX / totalReceived) * 100 : 0,
    liquidOverhangPct: totalReceived ? (liquidOverhangTX / totalReceived) * 100 : 0,
    validatorSelfBondCount: validRows.filter((r) => r.isValidatorSelfBond).length,
    plus7dHeight,
    windowDaysCovered,
    windowComplete,
    buckets: aggregate(validRows),
    bucketsExValidators: aggregate(ex),
    errors: enriched.filter((r) => r.__error).length,
    recipients: validRows,
  };
}

async function analyzeCycle(cycle, currentHeight, validatorSelfBonds) {
  console.log(
    `\n══ Cycle ${cycle.cycleNumber} — distributed h=${cycle.distributionHeight} (${cycle.distributedAtIso}) ══`,
  );
  console.log(`  Total distributed (community): ${cycle.totalDistributed.toLocaleString()} TX`);

  const cohorts = {};
  for (const topN of [100, 500, 1000]) {
    const start = Date.now();
    const res = await analyzeCohort(cycle, topN, currentHeight, validatorSelfBonds);
    cohorts[`top${topN}`] = res;
    console.log(
      `\n  top ${topN} (${((Date.now() - start) / 1000).toFixed(1)}s) · ` +
        `window: ${res.windowDaysCovered.toFixed(2)}d ${res.windowComplete ? "(closed)" : "(open, partial)"} · ` +
        `${res.validatorSelfBondCount} validator self-bonds in cohort`,
    );
    for (const [name, info] of Object.entries(res.buckets)) {
      console.log(
        `    ${name.padEnd(11)} ${info.count.toString().padStart(4)} (${info.pct.toFixed(1).padStart(5)}%) · ` +
          `received ${info.receivedTX.toLocaleString(undefined, { maximumFractionDigits: 0 }).padStart(14)} TX · ` +
          `Δ ${info.netDeltaTX.toLocaleString(undefined, { maximumFractionDigits: 0 }).padStart(14)} TX`,
      );
    }
    console.log(
      `    HEADLINE: ${res.reBondPct.toFixed(1)}% re-bonded, ${res.liquidOverhangPct.toFixed(1)}% liquid overhang ` +
        `(${(res.liquidOverhangTX / 1e6).toFixed(1)}M TX)`,
    );
    if (res.validatorSelfBondCount > 0) {
      const exTotal = res.bucketsExValidators;
      const exReceived = Object.values(exTotal).reduce((s, b) => s + b.receivedTX, 0);
      const exDelta = Object.values(exTotal).reduce((s, b) => s + b.netDeltaTX, 0);
      const exReBondPct = exReceived ? (Math.max(0, exDelta) / exReceived) * 100 : 0;
      console.log(`    excl. validator self-bonds: ${exReBondPct.toFixed(1)}% re-bonded`);
    }
  }

  const summary = {
    cycle: cycle.cycleNumber,
    distributionId: cycle.distributionId,
    distributedAtIso: cycle.distributedAtIso,
    distributionHeight: cycle.distributionHeight,
    fullPlus7dHeight: cycle.fullPlus7dHeight,
    measuredAtHeight: currentHeight,
    cohorts: Object.fromEntries(
      Object.entries(cohorts).map(([k, v]) => {
        const { recipients: _drop, ...rest } = v;
        return [k, rest];
      }),
    ),
  };

  const path = `/tmp/pse-stake-delta-cycle${cycle.cycleNumber}.json`;
  writeFileSync(
    path,
    JSON.stringify(
      {
        summary,
        recipientsByCohort: Object.fromEntries(
          Object.entries(cohorts).map(([k, v]) => [k, v.recipients]),
        ),
      },
      null,
      2,
    ),
  );
  console.log(`  Wrote ${path}`);
  return summary;
}

async function main() {
  console.log("PSE Stake Delta Analysis (Path B, enhanced)");

  const [cycles, current, validatorSelfBonds] = await Promise.all([
    fetchCommunityCycles(),
    fetchCurrentHeight(),
    fetchValidatorSelfBonds(),
  ]);
  console.log(`Current height: ${current.height} (${current.timestamp})`);
  console.log(`Discovered ${cycles.length} community-pool cycles.`);
  console.log(`Loaded ${validatorSelfBonds.size} validator self-bond addresses.`);

  const target = ONLY_CYCLE
    ? cycles.filter((c) => c.cycleNumber === ONLY_CYCLE)
    : cycles;

  const summaries = [];
  for (const cycle of target) {
    summaries.push(await analyzeCycle(cycle, current.height, validatorSelfBonds));
  }

  const path = "/tmp/pse-stake-delta-summary.json";
  writeFileSync(
    path,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), measuredAtHeight: current.height, summaries },
      null,
      2,
    ),
  );
  console.log(`\nSummary: ${path}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
