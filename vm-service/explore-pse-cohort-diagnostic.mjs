#!/usr/bin/env node
// PSE cohort diagnostic — explains whether the "everyone holds" result
// is real signal or a coverage gap.
//
// Answers, in order:
//   1. How many CEXes do we track? What's their 30d inflow volume?
//   2. Does the cohort have ANY staking activity in the past 30 days?
//      (sanity check — the recipient_address column should be the same
//       wallet that delegated to earn the reward)
//   3. Are any cohort addresses already labeled in known_entities?
//   4. Re-run the bucket analysis at top=500 and top=1000.
//   5. Re-bucket the original top=100 at multiple thresholds (1%, 5%, 25%).
//
// READ-ONLY. Writes /tmp/pse-cohort-diagnostic.json.

import { query, closePool } from "./db.mjs";
import { writeFileSync } from "node:fs";

const HASURA = "https://hasura.mainnet-1.coreum.dev/v1/graphql";
const DECIMALS = 6;
const ucoreToTX = (s) => Number(BigInt(s)) / 10 ** DECIMALS;

async function fetchCommunityCycles() {
  const res = await fetch(HASURA, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `{
        pse_distribution_allocation(
          where: { allocation_type: { _eq: "pse_community" } }
          order_by: { scheduled_at: asc }
        ) {
          distribution_id scheduled_at total_amount
        }
      }`,
    }),
  });
  const data = await res.json();
  return data.data.pse_distribution_allocation.map((d, i) => ({
    cycleNumber: i + 1,
    distributionId: d.distribution_id,
    scheduledAt: d.scheduled_at,
    distributedAtIso: new Date(d.scheduled_at * 1000).toISOString(),
    totalDistributed: ucoreToTX(d.total_amount),
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
        ) { recipient_address amount }
      }`,
    }),
  });
  const data = await res.json();
  return data.data.pse_transfer.map((r, i) => ({
    rank: i + 1,
    address: r.recipient_address,
    amountTX: ucoreToTX(r.amount),
  }));
}

// ─── 1. Exchange coverage ────────────────────────────────────────────────
async function exchangeCoverage() {
  const exchanges = (
    await query(`SELECT address, exchange_name AS label FROM exchange_addresses ORDER BY exchange_name`)
  ).rows;
  const flows30d = (
    await query(`
      SELECT exchange_address, direction, SUM(amount) AS total, COUNT(*) AS tx_count
      FROM exchange_flows
      WHERE timestamp >= NOW() - INTERVAL '30 days'
      GROUP BY exchange_address, direction
    `)
  ).rows;
  const byAddr = {};
  for (const e of exchanges) byAddr[e.address] = { label: e.label, address: e.address, inflow: 0, outflow: 0, txCount: 0 };
  for (const f of flows30d) {
    const row = byAddr[f.exchange_address] || { label: "?", address: f.exchange_address, inflow: 0, outflow: 0, txCount: 0 };
    row[f.direction] += Number(f.total) / 10 ** DECIMALS;
    row.txCount += Number(f.tx_count);
    byAddr[f.exchange_address] = row;
  }
  return Object.values(byAddr).sort((a, b) => b.inflow + b.outflow - (a.inflow + a.outflow));
}

// ─── 2. Cohort liveness ──────────────────────────────────────────────────
async function cohortLiveness(addresses) {
  if (addresses.length === 0) return { totalAddrs: 0, withStakingActivity30d: 0, totalEvents: 0 };
  const res = await query(
    `SELECT delegator AS address, COUNT(*) AS event_count, SUM(amount) AS total_amount
     FROM staking_events
     WHERE timestamp >= NOW() - INTERVAL '30 days'
       AND delegator = ANY($1)
     GROUP BY delegator`,
    [addresses],
  );
  return {
    totalAddrs: addresses.length,
    withStakingActivity30d: res.rows.length,
    totalEvents: res.rows.reduce((s, r) => s + Number(r.event_count), 0),
    activeAddrs: res.rows.map((r) => ({ address: r.address, events: Number(r.event_count) })),
  };
}

// ─── 3. Known-entity tagging ─────────────────────────────────────────────
async function knownEntityTagging(addresses) {
  if (addresses.length === 0) return [];
  const res = await query(
    `SELECT address, label, type FROM known_entities WHERE address = ANY($1)`,
    [addresses],
  );
  return res.rows;
}

// ─── 4-5. Bucket analysis at multiple top-N and thresholds ───────────────
async function fetchCohortBehavior(addresses, startIso, endIso) {
  const [cexRows, stakingRows] = await Promise.all([
    query(
      `SELECT counterparty AS address, SUM(amount) AS total
       FROM exchange_flows
       WHERE direction = 'inflow' AND timestamp >= $1 AND timestamp < $2 AND counterparty = ANY($3)
       GROUP BY counterparty`,
      [startIso, endIso, addresses],
    ),
    query(
      `SELECT delegator AS address, type, SUM(amount) AS total
       FROM staking_events
       WHERE timestamp >= $1 AND timestamp < $2 AND delegator = ANY($3)
       GROUP BY delegator, type`,
      [startIso, endIso, addresses],
    ),
  ]);
  const cex = {};
  for (const r of cexRows.rows) cex[r.address] = Number(r.total) / 10 ** DECIMALS;
  const staking = {};
  for (const r of stakingRows.rows) {
    staking[r.address] = staking[r.address] || { delegate: 0, undelegate: 0, redelegate: 0 };
    staking[r.address][r.type] = Number(r.total) / 10 ** DECIMALS;
  }
  return { cex, staking };
}

function bucketize(recipients, behavior, threshold) {
  const buckets = { sold: 0, compounded: 0, partial: 0, held: 0 };
  let cexInflowTotal = 0;
  let delegatedTotal = 0;
  for (const r of recipients) {
    const cex = behavior.cex[r.address] || 0;
    const stake = behavior.staking[r.address] || { delegate: 0, undelegate: 0 };
    const delegatedNet = stake.delegate - stake.undelegate;
    cexInflowTotal += cex;
    delegatedTotal += stake.delegate;
    const cexPct = r.amountTX > 0 ? cex / r.amountTX : 0;
    const compPct = r.amountTX > 0 ? delegatedNet / r.amountTX : 0;
    if (cexPct >= threshold) buckets.sold++;
    else if (compPct >= threshold) buckets.compounded++;
    else if (cex > 0) buckets.partial++;
    else buckets.held++;
  }
  return { buckets, cexInflowTotal, delegatedTotal };
}

async function main() {
  const cycles = await fetchCommunityCycles();
  const out = { generatedAt: new Date().toISOString(), cycles: [] };

  console.log("═══ 1. Exchange coverage (30 days) ═══");
  const cov = await exchangeCoverage();
  out.exchangeCoverage = cov;
  for (const e of cov.slice(0, 20)) {
    console.log(
      `  ${(e.label || "?").padEnd(20)} in=${e.inflow.toLocaleString(undefined, { maximumFractionDigits: 0 }).padStart(15)} TX  ` +
        `out=${e.outflow.toLocaleString(undefined, { maximumFractionDigits: 0 }).padStart(15)} TX  ` +
        `txs=${e.txCount}`,
    );
  }
  console.log(`  total tracked exchange addresses: ${cov.length}`);

  for (const cycle of cycles) {
    console.log(`\n═══ Cycle ${cycle.cycleNumber} (${cycle.distributedAtIso}) ═══`);
    const startIso = cycle.distributedAtIso;
    const endIso = new Date(cycle.scheduledAt * 1000 + 7 * 86400_000).toISOString();
    const cycleOut = { cycle: cycle.cycleNumber, startIso, endIso, byCohortSize: {} };

    for (const topN of [100, 500, 1000]) {
      const recipients = await fetchTopRecipients(cycle.distributionId, topN);
      const addresses = recipients.map((r) => r.address);

      const liveness = await cohortLiveness(addresses);
      const labeled = await knownEntityTagging(addresses);
      const behavior = await fetchCohortBehavior(addresses, startIso, endIso);

      const thresholds = {};
      for (const t of [0.01, 0.05, 0.25]) {
        const { buckets, cexInflowTotal, delegatedTotal } = bucketize(recipients, behavior, t);
        thresholds[`${(t * 100).toFixed(0)}pct`] = {
          ...buckets,
          cexInflowTX: cexInflowTotal,
          delegatedTX: delegatedTotal,
        };
      }

      const totalReceived = recipients.reduce((s, r) => s + r.amountTX, 0);
      cycleOut.byCohortSize[`top${topN}`] = {
        cohortSize: recipients.length,
        receivedTX: totalReceived,
        liveness,
        labeled,
        thresholds,
      };

      console.log(
        `\n  top ${topN}: ${recipients.length} addrs · ${totalReceived.toLocaleString(undefined, { maximumFractionDigits: 0 })} TX received`,
      );
      console.log(`    liveness 30d:  ${liveness.withStakingActivity30d}/${liveness.totalAddrs} have staking activity`);
      console.log(`    labeled:       ${labeled.length} match known_entities`);
      for (const [t, info] of Object.entries(thresholds)) {
        console.log(
          `    @${t}: sold=${info.sold} compounded=${info.compounded} partial=${info.partial} held=${info.held} · ` +
            `cex=${info.cexInflowTX.toFixed(2)} TX · delegated=${info.delegatedTX.toFixed(2)} TX`,
        );
      }
    }
    out.cycles.push(cycleOut);
  }

  const path = "/tmp/pse-cohort-diagnostic.json";
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${path}`);
  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
