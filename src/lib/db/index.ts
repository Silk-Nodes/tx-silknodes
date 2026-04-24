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

import { Sequelize } from "sequelize";

declare global {
  // eslint-disable-next-line no-var
  var __txSilknodesSequelize: Sequelize | undefined;
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
