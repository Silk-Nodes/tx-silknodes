#!/usr/bin/env node
// PSE cohort behavior — exploration script (dry-run only)
//
// Answers: of the top N PSE community-pool recipients in each cycle,
// who sent to a tracked CEX, who delegated more, who held — in the
// 7 days following the distribution?
//
// READ-ONLY. This script:
//   - Hits Hasura (read-only) for distribution metadata + per-address transfers.
//   - Hits our local Postgres (read-only) for exchange_flows + staking_events.
//   - Writes JSON snapshots to /tmp/pse-cohort-cycle{N}.json and a summary
//     to /tmp/pse-cohort-summary.json.
//
// It NEVER writes to any production table. Safe to run as many times as
// you like. No migrations created.
//
// Usage:
//   node vm-service/explore-pse-cohort.mjs                # both cycles, top 100
//   node vm-service/explore-pse-cohort.mjs --cycle=1      # just cycle 1
//   node vm-service/explore-pse-cohort.mjs --top=50       # top 50 only
//   node vm-service/explore-pse-cohort.mjs --window-days=7

import { query, closePool } from "./db.mjs";
import { writeFileSync } from "node:fs";

const HASURA = "https://hasura.mainnet-1.coreum.dev/v1/graphql";
const DECIMALS = 6;
const ucoreToTX = (s) => Number(BigInt(s)) / 10 ** DECIMALS;

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);
const TOP_N = Number(args.top || 100);
const WINDOW_DAYS = Number(args["window-days"] || 7);
const ONLY_CYCLE = args.cycle ? Number(args.cycle) : null;

// Coreum's pse_distribution_allocation uses scheduled_at (unix seconds)
// as a stable cycle anchor. distribution_id is unfortunately reused
// across cycles in some early rows (cycle 1 used the timestamp, cycle 2
// uses 2). We key on (allocation_type='pse_community', scheduled_at) to
// be safe against future numbering quirks.
async function fetchDistributions() {
  const res = await fetch(HASURA, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `{
        pse_distribution_allocation(
          where: { allocation_type: { _eq: "pse_community" } }
          order_by: { scheduled_at: asc }
        ) {
          distribution_id
          scheduled_at
          start_at_height
          end_at_height
          total_amount
          total_score
          clearing_account_address
        }
      }`,
    }),
  });
  const data = await res.json();
  if (data.errors) throw new Error(JSON.stringify(data.errors));
  return data.data.pse_distribution_allocation.map((d, i) => ({
    cycleNumber: i + 1,
    distributionId: d.distribution_id,
    scheduledAt: d.scheduled_at,
    distributedAtIso: new Date(d.scheduled_at * 1000).toISOString(),
    height: d.start_at_height,
    totalDistributed: ucoreToTX(d.total_amount),
    totalScore: d.total_score,
    clearingAccount: d.clearing_account_address,
  }));
}

async function fetchTopRecipients(distributionId, topN) {
  const res = await fetch(HASURA, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `{
        pse_transfer(
          where: {
            distribution_id: { _eq: ${distributionId} }
            allocation_type: { _eq: "pse_community" }
          }
          order_by: { amount: desc_nulls_last }
          limit: ${topN}
        ) {
          recipient_address
          amount
          score
          height
        }
      }`,
    }),
  });
  const data = await res.json();
  if (data.errors) throw new Error(JSON.stringify(data.errors));
  return data.data.pse_transfer.map((r, i) => ({
    rank: i + 1,
    address: r.recipient_address,
    amountTX: ucoreToTX(r.amount),
    score: r.score,
    height: r.height,
  }));
}

// One round-trip per cycle with ANY(). 100 addresses + a 7-day window
// hits indexes (counterparty isn't indexed on exchange_flows, but
// timestamp is — Postgres should pick the timestamp index and filter).
async function fetchCexInflowsForCohort(addresses, startIso, endIso) {
  if (addresses.length === 0) return [];
  const res = await query(
    `SELECT counterparty AS address, exchange_address, SUM(amount) AS total, COUNT(*) AS tx_count
     FROM exchange_flows
     WHERE direction = 'inflow'
       AND timestamp >= $1 AND timestamp < $2
       AND counterparty = ANY($3)
     GROUP BY counterparty, exchange_address`,
    [startIso, endIso, addresses],
  );
  return res.rows;
}

async function fetchStakingDeltasForCohort(addresses, startIso, endIso) {
  if (addresses.length === 0) return [];
  const res = await query(
    `SELECT delegator AS address, type, SUM(amount) AS total, COUNT(*) AS tx_count
     FROM staking_events
     WHERE timestamp >= $1 AND timestamp < $2
       AND delegator = ANY($3)
     GROUP BY delegator, type`,
    [startIso, endIso, addresses],
  );
  return res.rows;
}

function classify(received, cexInflow, delegatedNet) {
  // Bucket rules (configurable later). Conservative defaults so we
  // don't over-claim "sold":
  //   sold       — sent >= 25% of received TX to a tracked CEX in 7d
  //   compounded — net delegate >= 25% of received TX in 7d (and not "sold")
  //   partial    — sent some to CEX but < 25% of received
  //   held       — neither significant CEX outflow nor compound
  if (received <= 0) return "held";
  const cexPct = cexInflow / received;
  const compPct = delegatedNet / received;
  if (cexPct >= 0.25) return "sold";
  if (compPct >= 0.25) return "compounded";
  if (cexInflow > 0) return "partial";
  return "held";
}

async function analyzeCycle(cycle) {
  console.log(
    `\n══ Cycle ${cycle.cycleNumber} (distribution_id=${cycle.distributionId}, scheduled ${cycle.distributedAtIso}) ══`,
  );
  console.log(`Total distributed: ${cycle.totalDistributed.toLocaleString()} TX`);
  const recipients = await fetchTopRecipients(cycle.distributionId, TOP_N);
  console.log(`Top ${recipients.length} recipients fetched. Top1 = ${recipients[0]?.amountTX.toLocaleString()} TX`);

  const startIso = cycle.distributedAtIso;
  const endMs = cycle.scheduledAt * 1000 + WINDOW_DAYS * 86400_000;
  const endIso = new Date(endMs).toISOString();
  console.log(`Window: ${startIso} → ${endIso}`);

  const addresses = recipients.map((r) => r.address);
  const [cexRows, stakingRows] = await Promise.all([
    fetchCexInflowsForCohort(addresses, startIso, endIso),
    fetchStakingDeltasForCohort(addresses, startIso, endIso),
  ]);

  // Index per address.
  const cexByAddr = {};
  for (const r of cexRows) {
    cexByAddr[r.address] = (cexByAddr[r.address] || 0) + Number(r.total) / 10 ** DECIMALS;
  }
  const stakingByAddr = {}; // address -> {delegate, undelegate, redelegate}
  for (const r of stakingRows) {
    stakingByAddr[r.address] = stakingByAddr[r.address] || { delegate: 0, undelegate: 0, redelegate: 0 };
    stakingByAddr[r.address][r.type] = Number(r.total) / 10 ** DECIMALS;
  }

  const enriched = recipients.map((r) => {
    const cex = cexByAddr[r.address] || 0;
    const stake = stakingByAddr[r.address] || { delegate: 0, undelegate: 0, redelegate: 0 };
    const delegatedNet = stake.delegate - stake.undelegate;
    return {
      ...r,
      cexInflow7d: cex,
      delegated7d: stake.delegate,
      undelegated7d: stake.undelegate,
      redelegated7d: stake.redelegate,
      delegatedNet7d: delegatedNet,
      bucket: classify(r.amountTX, cex, delegatedNet),
    };
  });

  // Aggregate buckets.
  const buckets = { sold: [], compounded: [], partial: [], held: [] };
  for (const r of enriched) buckets[r.bucket].push(r);

  const summary = {
    cycle: cycle.cycleNumber,
    distributionId: cycle.distributionId,
    distributedAtIso: cycle.distributedAtIso,
    windowEndIso: endIso,
    windowDays: WINDOW_DAYS,
    cohortSize: enriched.length,
    cohortReceivedTX: enriched.reduce((s, r) => s + r.amountTX, 0),
    buckets: Object.fromEntries(
      Object.entries(buckets).map(([k, arr]) => [
        k,
        {
          count: arr.length,
          pct: enriched.length ? (arr.length / enriched.length) * 100 : 0,
          receivedTX: arr.reduce((s, r) => s + r.amountTX, 0),
          cexInflowTX: arr.reduce((s, r) => s + r.cexInflow7d, 0),
          delegatedTX: arr.reduce((s, r) => s + r.delegated7d, 0),
        },
      ]),
    ),
  };

  console.log("\nBuckets:");
  for (const [name, info] of Object.entries(summary.buckets)) {
    console.log(
      `  ${name.padEnd(11)} ${info.count.toString().padStart(3)} addrs ` +
        `(${info.pct.toFixed(1).padStart(5)}%) — ` +
        `received ${info.receivedTX.toLocaleString(undefined, { maximumFractionDigits: 0 })} TX, ` +
        `CEX in ${info.cexInflowTX.toLocaleString(undefined, { maximumFractionDigits: 0 })} TX, ` +
        `delegated ${info.delegatedTX.toLocaleString(undefined, { maximumFractionDigits: 0 })} TX`,
    );
  }

  const outPath = `/tmp/pse-cohort-cycle${cycle.cycleNumber}.json`;
  writeFileSync(
    outPath,
    JSON.stringify({ summary, recipients: enriched }, null, 2),
  );
  console.log(`Wrote ${outPath}`);

  return summary;
}

async function main() {
  const cycles = await fetchDistributions();
  console.log(`Discovered ${cycles.length} community-pool distributions:`);
  for (const c of cycles) {
    console.log(
      `  cycle ${c.cycleNumber}: id=${c.distributionId}, ${c.distributedAtIso}, ${c.totalDistributed.toLocaleString()} TX`,
    );
  }

  const target = ONLY_CYCLE
    ? cycles.filter((c) => c.cycleNumber === ONLY_CYCLE)
    : cycles;

  const summaries = [];
  for (const cycle of target) {
    summaries.push(await analyzeCycle(cycle));
  }

  const summaryPath = "/tmp/pse-cohort-summary.json";
  writeFileSync(summaryPath, JSON.stringify({ generatedAt: new Date().toISOString(), summaries }, null, 2));
  console.log(`\nSummary written to ${summaryPath}`);

  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
