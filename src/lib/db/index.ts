// Sequelize connection singleton for the Next.js server runtime.
//
// WHY SINGLETON: Next.js dev mode hot-reloads modules on every request.
// Without a module-scoped cache we'd leak a new Sequelize instance (and
// its underlying pg Pool) per hot reload, eventually exhausting
// Postgres's max_connections. We cache on globalThis so HMR reuses the
// same instance. Production bundles don't hit this code path (one
// process, one module evaluation) but the guard is harmless there.
//
// CONFIG: credentials come from env — same PGHOST/PGPORT/PGUSER/
// PGPASSWORD/PGDATABASE vars the VM-side collectors use, so a .env file
// on the VM covers both processes with a single source of truth.

import { Sequelize, QueryTypes } from "sequelize";

declare global {
  // eslint-disable-next-line no-var
  var __txSilknodesSequelize: Sequelize | undefined;
  // eslint-disable-next-line no-var
  var __txSilknodesMigrationCheckRan: boolean | undefined;
}

function createSequelize(): Sequelize {
  const host = process.env.PGHOST || "localhost";
  const port = Number(process.env.PGPORT || 5432);
  // Fall back to placeholder strings when env isn't set so that simply
  // IMPORTING this module doesn't throw. Sequelize's constructor only
  // stores config — it doesn't open a connection until the first query
  // — so the placeholders are never reached over the wire. If env
  // really is missing at request time, Postgres will reject the
  // authentication with a clear error. This matters because Next.js
  // evaluates API route modules at build time to collect metadata;
  // throwing here would break `npm run build` on machines without DB
  // credentials (CI, local dev without a .env, etc.).
  const database = process.env.PGDATABASE || "_build_placeholder_";
  const username = process.env.PGUSER || "_build_placeholder_";
  const password = process.env.PGPASSWORD || "_build_placeholder_";

  return new Sequelize({
    dialect: "postgres",
    host,
    port,
    database,
    username,
    password,
    // Small pool — the Next.js server is bounded by incoming requests,
    // not by long-lived analytical queries. Collectors keep their own
    // pool in vm-service/db.mjs, so these two processes share max_
    // connections but neither hogs it.
    pool: { max: 10, min: 0, idle: 10_000, acquire: 10_000 },
    // Silent by default — Next.js request logs are noisy enough. Set
    // DB_LOG=true in env to turn on SQL logging when debugging.
    logging: process.env.DB_LOG === "true" ? console.log : false,
  });
}

export const sequelize: Sequelize =
  globalThis.__txSilknodesSequelize ?? createSequelize();

if (process.env.NODE_ENV !== "production") {
  globalThis.__txSilknodesSequelize = sequelize;
}

// ─── Migration drift check ────────────────────────────────────────────
// Runs once per process on first import. Looks up pg_tables for the
// list of tables every API route in this repo expects to exist and
// logs a clear warning to journalctl if any are missing. Stops us
// from ever shipping a frontend change that depends on a new table
// without remembering to run the migration on the VM.
//
// Never throws and never blocks the request path — it's a fire-and-
// forget that runs on the next event loop tick after import. If the
// connection itself is broken the API path will surface the real
// error normally; this just adds visibility.

const REQUIRED_TABLES = [
  // 001_initial.sql
  "staking_events",
  "validators",
  "pending_undelegations",
  "top_delegators",
  "top_delegators_history",
  "whale_changes",
  "daily_metrics",
  "known_entities",
  "pse_score",
  // 002_exchange_flows.sql
  "exchange_addresses",
  "exchange_flows",
  "exchange_flows_state",
  // 005_entity_submissions.sql
  "entity_submissions",
];

if (!globalThis.__txSilknodesMigrationCheckRan && process.env.PGUSER) {
  globalThis.__txSilknodesMigrationCheckRan = true;
  setImmediate(async () => {
    try {
      const rows = (await sequelize.query<{ tablename: string }>(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
        { type: QueryTypes.SELECT },
      )) as unknown as Array<{ tablename: string }>;
      const present = new Set(rows.map((r) => r.tablename));
      const missing = REQUIRED_TABLES.filter((t) => !present.has(t));
      if (missing.length > 0) {
        console.warn(
          `[db] WARNING: ${missing.length} expected table(s) missing — run vm-service/migrations to fix: ${missing.join(", ")}`,
        );
      } else {
        console.log("[db] migration check OK, all expected tables present");
      }
    } catch (err) {
      console.warn(
        `[db] migration check skipped: ${err instanceof Error ? err.message : err}`,
      );
    }
  });
}
