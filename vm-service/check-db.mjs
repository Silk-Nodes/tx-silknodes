// Smoke-test for the Postgres connection. Run on the VM after env vars are
// set up to confirm db.mjs can talk to the database before any collector
// touches it.
//
// Usage:
//   cd /home/zoltan/tx-silknodes/vm-service
//   set -a; source ~/.silknodes-db.env; set +a
//   npm run check-db
//
// What it checks:
//   1. Connection succeeds with the configured credentials
//   2. All 9 expected tables from migration 001 are present
//   3. Each table is readable (zero rows is fine; we just SELECT count)
//   4. Pool drains cleanly so the script exits without hanging

import { query, closePool } from "./db.mjs";

const EXPECTED_TABLES = [
  "staking_events",
  "validators",
  "top_delegators",
  "top_delegators_history",
  "whale_changes",
  "pending_undelegations",
  "daily_metrics",
  "known_entities",
  "pse_score",
];

async function main() {
  console.log(`[check-db] connecting as ${process.env.PGUSER}@${process.env.PGHOST || "localhost"}/${process.env.PGDATABASE}…`);

  // 1. Server version round-trip — proves the connection works at all.
  const { rows: versionRows } = await query("SELECT version() AS version");
  console.log(`[check-db] server: ${versionRows[0].version}`);

  // 2. Tables present? Compare actual to expected.
  const { rows: tableRows } = await query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  );
  const actual = new Set(tableRows.map((r) => r.table_name));
  const missing = EXPECTED_TABLES.filter((t) => !actual.has(t));
  if (missing.length) {
    console.error(`[check-db] MISSING tables: ${missing.join(", ")}`);
    console.error(`[check-db] Did you apply vm-service/migrations/001_initial.sql?`);
    process.exitCode = 1;
    return;
  }
  console.log(`[check-db] all ${EXPECTED_TABLES.length} expected tables present`);

  // 3. Each table is readable with current credentials.
  for (const t of EXPECTED_TABLES) {
    const { rows } = await query(`SELECT count(*)::int AS n FROM ${t}`);
    console.log(`[check-db]   ${t.padEnd(24)} ${String(rows[0].n).padStart(6)} rows`);
  }

  console.log("[check-db] OK ✅");
}

main()
  .catch((err) => {
    console.error(`[check-db] FAILED: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(closePool);
