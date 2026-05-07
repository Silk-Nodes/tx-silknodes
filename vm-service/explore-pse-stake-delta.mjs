#!/usr/bin/env node
// PSE cohort — stake + liquid delta analysis (Path B, v3)
//
// PSE rewards land LIQUID in the recipient's wallet. They don't auto-bond.
// So the right question per recipient is: did the liquid TX stay in the
// wallet, get re-bonded, or leave the wallet?
//
// For each top-N PSE community recipient per cycle:
//   - bonded stake at distribution height
//   - bonded stake at min(distribution_height + 7d, current_height)
//   - liquid ucore balance at distribution_height − 1 (just BEFORE PSE)
//   - liquid ucore balance at min(distribution_height + 7d, current_height)
//   - bondedDelta = bonded_after − bonded_before
//   - liquidDelta = liquid_after − liquid_before
//
// Bucket priority (first match wins):
//   net_unbonded   bondedDelta < −1% of PSE      (drew down EXISTING stake)
//   compounded     bondedDelta ≥ +25% of PSE     (re-staked the reward)
//   held_liquid    liquidDelta ≥ +75% of PSE      (still sitting in the wallet)
//   moved_out      liquidDelta <  +75% of PSE     (left the wallet)
//
// Validator self-bonds are flagged so we can report buckets w/ and w/out them.
//
// Read-only. Writes /tmp/pse-stake-delta-cycle{N}.json + summary.json.
// No PR. No production writes.

import { writeFileSync } from "node:fs";

const HASURA = "https://hasura.mainnet-1.coreum.dev/v1/graphql";
const DECIMALS = 6;
const ucoreToTX = (s) => Number(BigInt(s)) / 10 ** DECIMALS;
const CONCURRENCY = 8;

// Cycle 1→2 height gap = 2,951,348 over 30 days = 98,378 blocks/day.
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

function ucoreFromCoins(coins) {
  if (!coins) return "0";
  const c = coins.find((x) => x.denom === "ucore");
  return c ? c.amount : "0";
}

async function fetchBondedAt(address, height) {
  const data = await gqlQuery(`{
    action_delegation_total(address: "${address}", height: ${height}) { coins }
  }`);
  return ucoreFromCoins(data.action_delegation_total?.coins);
}

async function fetchLiquidAt(address, height) {
  const data = await gqlQuery(`{
    action_account_balance(address: "${address}", height: ${height}) { coins }
  }`);
  return ucoreFromCoins(data.action_account_balance?.coins);
}

async function fetchValidatorSelfBonds() {
  const data = await gqlQuery(`{
    validator_info { self_delegate_address }
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

function classify(received, bondedDelta, liquidDelta) {
  if (received <= 0) return "held_liquid";
  const bondedPct = bondedDelta / received;
  const liquidPct = liquidDelta / received;
  // Order matters: net_unbonded takes precedence so we don't paint a
  // wallet that drew down its existing stake as "compounded" or "held".
  if (bondedPct < -0.01) return "net_unbonded";
  if (bondedPct >= 0.25) return "compounded";
  if (liquidPct >= 0.75) return "held_liquid";
  return "moved_out";
}

function emptyBuckets() {
  return { compounded: [], held_liquid: [], moved_out: [], net_unbonded: [] };
}

function aggregate(rows) {
  const buckets = emptyBuckets();
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

async function analyzeCohort(cycle, topN, currentHeight, validatorSelfBonds) {
  const recipients = await fetchTopRecipients(cycle.distributionId, topN);
  const plus7dHeight = Math.min(cycle.fullPlus7dHeight, currentHeight);
  const windowDaysCovered = Math.min(
    7,
    (plus7dHeight - cycle.distributionHeight) / BLOCKS_PER_DAY,
  );
  const windowComplete = plus7dHeight === cycle.fullPlus7dHeight;
  const beforeHeight = cycle.distributionHeight - 1;

  const enriched = await pmap(recipients, CONCURRENCY, async (r) => {
    const [bondedBefore, bondedAfter, liquidBefore, liquidAfter] = await Promise.all([
      fetchBondedAt(r.address, cycle.distributionHeight),
      fetchBondedAt(r.address, plus7dHeight),
      fetchLiquidAt(r.address, beforeHeight),
      fetchLiquidAt(r.address, plus7dHeight),
    ]);
    const bondedBeforeTX = Number(BigInt(bondedBefore)) / 10 ** DECIMALS;
    const bondedAfterTX = Number(BigInt(bondedAfter)) / 10 ** DECIMALS;
    const liquidBeforeTX = Number(BigInt(liquidBefore)) / 10 ** DECIMALS;
    const liquidAfterTX = Number(BigInt(liquidAfter)) / 10 ** DECIMALS;
    const bondedDeltaTX = bondedAfterTX - bondedBeforeTX;
    const liquidDeltaTX = liquidAfterTX - liquidBeforeTX;
    return {
      ...r,
      bondedBeforeTX,
      bondedAfterTX,
      bondedDeltaTX,
      liquidBeforeTX,
      liquidAfterTX,
      liquidDeltaTX,
      bondedDeltaPctOfPSE: r.amountTX > 0 ? (bondedDeltaTX / r.amountTX) * 100 : 0,
      liquidDeltaPctOfPSE: r.amountTX > 0 ? (liquidDeltaTX / r.amountTX) * 100 : 0,
      bucket: classify(r.amountTX, bondedDeltaTX, liquidDeltaTX),
      isValidatorSelfBond: validatorSelfBonds.has(r.address),
    };
  });

  const valid = enriched.filter((r) => !r.__error);
  const exValidators = valid.filter((r) => !r.isValidatorSelfBond);

  const totalReceived = valid.reduce((s, r) => s + r.amountTX, 0);
  const totalBondedDelta = valid.reduce((s, r) => s + r.bondedDeltaTX, 0);
  const totalLiquidDelta = valid.reduce((s, r) => s + r.liquidDeltaTX, 0);
  // Of the PSE distributed to this cohort, where did it end up?
  // We measure it as "the share that stayed in either bonded or liquid
  // form within the original wallet." Anything else moved out.
  const stayedTX = Math.max(0, totalBondedDelta) + Math.max(0, totalLiquidDelta);
  const movedOutTX = Math.max(0, totalReceived - stayedTX);

  return {
    cohortSize: valid.length,
    receivedTX: totalReceived,
    bondedDeltaTX: totalBondedDelta,
    liquidDeltaTX: totalLiquidDelta,
    stayedInWalletTX: Math.min(stayedTX, totalReceived),
    movedOutTX,
    movedOutPct: totalReceived ? (movedOutTX / totalReceived) * 100 : 0,
    validatorSelfBondCount: valid.filter((r) => r.isValidatorSelfBond).length,
    plus7dHeight,
    beforeHeight,
    windowDaysCovered,
    windowComplete,
    buckets: aggregate(valid),
    bucketsExValidators: aggregate(exValidators),
    errors: enriched.filter((r) => r.__error).length,
    recipients: valid,
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
        `    ${name.padEnd(13)} ${info.count.toString().padStart(4)} (${info.pct.toFixed(1).padStart(5)}%) · ` +
          `received ${info.receivedTX.toLocaleString(undefined, { maximumFractionDigits: 0 }).padStart(13)} TX · ` +
          `bondedΔ ${info.bondedDeltaTX.toLocaleString(undefined, { maximumFractionDigits: 0 }).padStart(13)} · ` +
          `liquidΔ ${info.liquidDeltaTX.toLocaleString(undefined, { maximumFractionDigits: 0 }).padStart(13)}`,
      );
    }
    console.log(
      `    HEADLINE: ${res.movedOutPct.toFixed(1)}% moved out of recipient wallets ` +
        `(${(res.movedOutTX / 1e6).toFixed(1)}M TX of ${(res.receivedTX / 1e6).toFixed(1)}M received)`,
    );
    if (res.validatorSelfBondCount > 0) {
      const exRows = res.recipients.filter((r) => !r.isValidatorSelfBond);
      const exReceived = exRows.reduce((s, r) => s + r.amountTX, 0);
      const exBonded = exRows.reduce((s, r) => s + r.bondedDeltaTX, 0);
      const exLiquid = exRows.reduce((s, r) => s + r.liquidDeltaTX, 0);
      const exStayed = Math.max(0, exBonded) + Math.max(0, exLiquid);
      const exMoved = Math.max(0, exReceived - exStayed);
      const exPct = exReceived ? (exMoved / exReceived) * 100 : 0;
      console.log(
        `    excl. validator self-bonds: ${exPct.toFixed(1)}% moved out`,
      );
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
  console.log("PSE Stake + Liquid Delta Analysis (Path B, v3)");

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
