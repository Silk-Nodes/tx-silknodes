#!/usr/bin/env node

/**
 * Exchange Flows retention pruner.
 *
 * Deletes rows from exchange_flows older than RETENTION_DAYS (default 365)
 * so the table doesn't grow unbounded. The Flows tab queries always filter
 * by window via WHERE timestamp >= sinceDate, so older rows aren't shown
 * anywhere; we keep them around for ~12 months in case product wants to
 * look back at user behaviour, then drop them.
 *
 * exchange_flows_state and exchange_addresses are intentionally untouched.
 *
 * Schedule: silknodes-prune-exchange-flows.timer fires daily at 03:30 UTC,
 * comfortably after collect-daily-analytics runs at 02:00.
 */

import { query, closePool } from "./db.mjs";

const RETENTION_DAYS = Number(process.env.FLOWS_RETENTION_DAYS ?? 365);

function log(level, msg) {
  console.log(JSON.stringify({ level, msg, at: new Date().toISOString() }));
}

async function main() {
  if (!Number.isFinite(RETENTION_DAYS) || RETENTION_DAYS < 30) {
    // Guard against accidental "0" which would wipe the table. Lowest
    // supported retention is 30 days; below that and the chart's 90D
    // window stops working.
    log("error", `invalid FLOWS_RETENTION_DAYS=${RETENTION_DAYS} (min 30)`);
    process.exit(1);
  }

  log("info", `pruning exchange_flows older than ${RETENTION_DAYS} days`);

  const result = await query(
    `DELETE FROM exchange_flows
     WHERE timestamp < NOW() - ($1 || ' days')::interval`,
    [RETENTION_DAYS],
  );
  const deleted = result.rowCount ?? 0;

  log("info", `deleted ${deleted} rows`);

  // Reclaim space proactively. exchange_flows is append-only with a
  // daily prune so dead tuples accumulate in a predictable pattern;
  // a daily VACUUM (no FULL) keeps autovacuum from falling behind on
  // very write-heavy days.
  await query(`VACUUM (ANALYZE) exchange_flows`);
  log("info", "vacuum analyze complete");
}

main()
  .catch((err) => {
    log("error", `prune failed: ${err?.message ?? err}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
