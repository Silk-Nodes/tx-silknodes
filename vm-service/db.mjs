// Postgres connection pool used by the collectors. Single shared pool per
// process so we never exceed Postgres's max_connections by accident, and
// every consumer uses the same configured client.
//
// Configuration: ALL credentials come from environment variables. The
// systemd unit files inject these via EnvironmentFile so secrets never
// land in git. For interactive use on the VM, source ~/.silknodes-db.env
// before running the collector locally.
//
// Required env vars:
//   PGHOST       (default 'localhost')
//   PGPORT       (default '5432')
//   PGUSER       (no default — must be set, e.g. 'silknodes')
//   PGPASSWORD   (no default — must be set; loaded from secrets file)
//   PGDATABASE   (no default — must be set, e.g. 'tx_silknodes')
//
// node-postgres reads PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE
// natively when no config object is passed, but we instantiate a Pool
// explicitly so we can tune limits and surface errors.

import pg from "pg";

const { Pool } = pg;

// One pool per process. The collector is a long-running daemon, so we
// initialise lazily on first query and reuse forever. Pool size is
// modest because the collectors are sequential — they don't run many
// queries in parallel — and Postgres's default max_connections is 100,
// shared with any other apps on the VM (agentscan etc.).
let _pool = null;

function getPool() {
  if (_pool) return _pool;

  // Validate required vars early so we fail loudly on misconfiguration
  // instead of getting a confusing "password authentication failed"
  // from Postgres later.
  for (const key of ["PGUSER", "PGPASSWORD", "PGDATABASE"]) {
    if (!process.env[key]) {
      throw new Error(
        `db.mjs: required env var ${key} is not set. ` +
          `Source ~/.silknodes-db.env or check the systemd EnvironmentFile.`,
      );
    }
  }

  _pool = new Pool({
    host: process.env.PGHOST || "localhost",
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    // Modest limits — collectors are sequential single-process daemons.
    // 5 connections is plenty of headroom for a future "small batch
    // parallel" pattern without crowding shared max_connections.
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  // Surface unexpected pool errors. Without this listener node-postgres
  // emits an 'error' event on the pool that, if unhandled, can crash
  // the whole process. We log instead — the collector's outer retry
  // loop handles transient failures.
  _pool.on("error", (err) => {
    // Prefix matches the existing log() helper format used by the
    // collectors so journalctl filtering stays consistent.
    console.error(`[${new Date().toISOString()}] [ERROR] pg pool error: ${err.message}`);
  });

  return _pool;
}

/**
 * Run a parameterised query and return the result rows. Thin wrapper
 * around pool.query so collectors don't have to import `pg` directly.
 *
 * @param {string} text  parameterised SQL (use $1, $2, …)
 * @param {any[]}  params  values to bind
 * @returns {Promise<{rows: any[], rowCount: number}>}
 */
export async function query(text, params = []) {
  const pool = getPool();
  return pool.query(text, params);
}

/**
 * Acquire a dedicated client for transactional work (BEGIN / COMMIT /
 * ROLLBACK). Caller MUST call client.release() in a finally block to
 * return the client to the pool.
 *
 * Typical usage:
 *
 *   const client = await getClient();
 *   try {
 *     await client.query("BEGIN");
 *     await client.query(...);
 *     await client.query("COMMIT");
 *   } catch (e) {
 *     await client.query("ROLLBACK");
 *     throw e;
 *   } finally {
 *     client.release();
 *   }
 */
export async function getClient() {
  const pool = getPool();
  return pool.connect();
}

/** Drain and close the pool. Useful for one-shot scripts (check-db,
 *  daily analytics) so the process exits cleanly instead of hanging on
 *  open sockets. The long-running collector daemon should NOT call this. */
export async function closePool() {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}
