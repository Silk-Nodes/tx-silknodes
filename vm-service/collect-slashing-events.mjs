#!/usr/bin/env node
/**
 * Slashing / jailing event collector.
 *
 * Records validator penalty events into slashing_events. This history is NOT
 * reconstructable after the fact: the chain exposes only current state, so
 * every hour this is not running is a permanent hole. Same reasoning as
 * validator_snapshots.
 *
 * TWO DETECTION PATHS, deliberately:
 *
 *  1. state_diff (always on, verified)
 *     Compares the validator set and signing infos against the previous poll.
 *     Any jailed false->true, true->false, or tombstoned false->true is a
 *     transition worth recording. This depends only on LCD state, so it is
 *     robust to event-attribute naming and to RPC availability. It cannot
 *     know the burned amount, so amount_tx stays NULL.
 *
 *  2. event (best effort, adds detail)
 *     Scans finalize_block_events between the cursor and the chain head for
 *     `slash` / `liveness` events, which carry the reason and the burned
 *     coins. TX runs a recent CometBFT where these live in
 *     finalize_block_events, not begin/end_block_events.
 *
 *     This path is written defensively because slash events are genuinely
 *     rare (downtime slash is 0.01%, double-sign 5%) and none occurred in the
 *     blocks available while this was written, so the exact attribute
 *     spelling could not be confirmed against live data. It therefore accepts
 *     several known spellings and, crucially, NEVER blocks path 1. If it
 *     parses nothing, jail history is still complete.
 *
 * Read-only against LCD and RPC. Writes only slashing_events and
 * slashing_cursor.
 *
 * Usage:
 *   node vm-service/collect-slashing-events.mjs
 *   node vm-service/collect-slashing-events.mjs --dry-run
 *   node vm-service/collect-slashing-events.mjs --max-blocks 5000
 */

import { query, closePool } from "./db.mjs";

const LCD_HOSTS = (process.env.COREUM_LCD_HOSTS || [
  "https://full-node.mainnet-1.coreum.dev:1317",
  "https://rest-coreum.ecostake.com",
  "https://coreum-lcd.silknodes.io",
].join(",")).split(",").map(s => s.trim()).filter(Boolean);

const RPC_HOSTS = (process.env.COREUM_RPC_HOSTS || [
  "https://rpc-coreum.ecostake.com",
  "https://full-node.mainnet-1.coreum.dev:26657",
].join(",")).split(",").map(s => s.trim()).filter(Boolean);

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const MAX_BLOCKS = Number(args[args.indexOf("--max-blocks") + 1]) || 3000;
const TIMEOUT_MS = 20000;
const UCORE = 1_000_000;

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = LEVELS[process.env.LOG_LEVEL || "info"] ?? 20;
function log(level, msg) {
  if ((LEVELS[level] ?? 20) < MIN_LEVEL) return;
  console.log(`[${new Date().toISOString()}] [${level}] ${msg}`);
}

async function getJSON(hosts, path, attempts = 2) {
  for (const host of hosts) {
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await fetch(`${host}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (res.status === 404) return null;          // real answer
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (e) {
        if (i === attempts - 1) log("debug", `${host}${path.slice(0, 48)} failed: ${e.message}`);
      }
    }
  }
  return null;
}

// ─── current chain state ──────────────────────────────────────────────
async function fetchValidatorState() {
  // All statuses, not just bonded: a jailed validator leaves the bonded set,
  // and filtering to bonded would make every jailing look like a deletion.
  const out = new Map();
  for (const status of ["BOND_STATUS_BONDED", "BOND_STATUS_UNBONDING", "BOND_STATUS_UNBONDED"]) {
    const d = await getJSON(LCD_HOSTS,
      `/cosmos/staking/v1beta1/validators?status=${status}&pagination.limit=500`);
    for (const v of d?.validators || []) {
      out.set(v.operator_address, {
        moniker: v.description?.moniker || "",
        jailed: Boolean(v.jailed),
        status: v.status,
      });
    }
  }
  return out;
}

async function fetchTombstoned() {
  const d = await getJSON(LCD_HOSTS, `/cosmos/slashing/v1beta1/signing_infos?pagination.limit=500`);
  const out = new Map();
  for (const i of d?.info || []) out.set(i.address, Boolean(i.tombstoned));
  return out;
}

// consensus address -> operator address.
//
// This mapping is not optional plumbing, it is required for correctness:
// signing_infos and slash events both identify validators by CONSENSUS
// address, while everything else in this codebase keys on the OPERATOR
// address. Looking one up with the other silently returns nothing, which
// would make every tombstone and every slash invisible rather than wrong,
// the worst kind of failure. The LCD does not expose the bech32 consensus
// address, so Hasura owns this join (same source the validator API uses).
const HASURA = "https://hasura.mainnet-1.coreum.dev/v1/graphql";
async function fetchConsensusMap() {
  const map = new Map();
  try {
    const res = await fetch(HASURA, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "{ validator_info { consensus_address operator_address } }" }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const d = await res.json();
    for (const v of d?.data?.validator_info || []) {
      if (v.consensus_address && v.operator_address) map.set(v.consensus_address, v.operator_address);
    }
  } catch (e) {
    log("warn", `Hasura consensus map unavailable: ${e.message}`);
  }
  return map;
}

// ─── previous state, from what we already recorded ────────────────────
async function loadLastKnownState() {
  // Reconstruct "what we believed last time" from the event log itself, so
  // the collector needs no side file. The most recent jailed/unjailed row per
  // validator is its last known jail state.
  const { rows } = await query(`
    SELECT DISTINCT ON (operator_address)
           operator_address, event_type
      FROM slashing_events
     WHERE event_type IN ('jailed','unjailed')
     ORDER BY operator_address, occurred_at DESC, id DESC
  `);
  const jailed = new Map();
  for (const r of rows) jailed.set(r.operator_address, r.event_type === "jailed");

  const { rows: tomb } = await query(
    `SELECT DISTINCT operator_address FROM slashing_events WHERE event_type = 'tombstoned'`);
  return { jailed, tombstoned: new Set(tomb.map(r => r.operator_address)) };
}

async function insertEvent(e) {
  if (DRY_RUN) {
    log("info", `  DRY ${e.event_type.padEnd(11)} ${e.moniker || e.operator_address} ` +
      `${e.reason ? `(${e.reason}) ` : ""}${e.amount_tx != null ? `${e.amount_tx} TX ` : ""}[${e.source}]`);
    return 0;
  }
  const { rowCount } = await query(
    `INSERT INTO slashing_events
       (operator_address, moniker, event_type, reason, amount_tx, height, occurred_at, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT DO NOTHING`,
    [e.operator_address, e.moniker || "", e.event_type, e.reason ?? null,
     e.amount_tx ?? null, e.height ?? null, e.occurred_at, e.source],
  );
  return rowCount;
}

// ─── path 2: block events ─────────────────────────────────────────────
const attr = (ev, ...names) => {
  for (const a of ev.attributes || []) {
    // CometBFT returns plain strings on recent versions, base64 on older.
    const k = a.key ?? "";
    const key = /^[A-Za-z_]+$/.test(k) ? k : Buffer.from(k, "base64").toString("utf8");
    if (names.includes(key)) {
      const v = a.value ?? "";
      return /^[\x20-\x7E]*$/.test(v) && !/^[A-Za-z0-9+/]+=*$/.test(v)
        ? v : Buffer.from(v, "base64").toString("utf8");
    }
  }
  return null;
};

async function scanBlockEvents(fromHeight, toHeight, consMap) {
  const found = [];
  let scanned = 0;
  for (let h = fromHeight; h <= toHeight; h++) {
    const d = await getJSON(RPC_HOSTS, `/block_results?height=${h}`, 1);
    scanned++;
    const evs = d?.result?.finalize_block_events
      || d?.result?.begin_block_events
      || [];
    const hits = evs.filter(e => e.type === "slash" || e.type === "liveness");
    if (!hits.length) continue;

    const blk = await getJSON(RPC_HOSTS, `/block?height=${h}`, 1);
    const ts = blk?.result?.block?.header?.time || new Date().toISOString();

    for (const e of hits) {
      const consKey = attr(e, "address", "consensus_address", "validator");
      const burned = attr(e, "burned_coins", "burned_coin");
      const amount = burned ? Number(String(burned).replace(/[^0-9]/g, "")) / UCORE : null;
      found.push({
        operator_address: consMap.get(consKey) || consKey || "unknown",
        moniker: "",
        event_type: "slashed",
        reason: attr(e, "reason"),
        amount_tx: Number.isFinite(amount) && amount > 0 ? amount : null,
        height: h,
        occurred_at: ts,
        source: "event",
      });
    }
  }
  return { found, scanned };
}

// ─── main ─────────────────────────────────────────────────────────────
async function main() {
  log("info", `Slashing collector starting${DRY_RUN ? " (dry run)" : ""}`);

  const status = await getJSON(RPC_HOSTS, `/status`);
  const head = Number(status?.result?.sync_info?.latest_block_height || 0);
  if (!head) throw new Error("could not read chain head from any RPC host");

  // ── path 1: state diff (the reliable one) ──
  const [state, tombByCons, prev, consMap] = await Promise.all([
    fetchValidatorState(), fetchTombstoned(), loadLastKnownState(), fetchConsensusMap(),
  ]);
  // Re-key tombstones from consensus to operator address. Without this every
  // lookup below misses and no tombstone is ever recorded.
  const tomb = new Map();
  for (const [cons, isTomb] of tombByCons) {
    const op = consMap.get(cons);
    if (op) tomb.set(op, isTomb);
  }
  log("info", `Consensus map: ${consMap.size} entries, ${[...tomb.values()].filter(Boolean).length} tombstoned`);
  if (state.size === 0) throw new Error("validator set came back empty from every LCD host");
  log("info", `Chain head ${head}, ${state.size} validators, ${prev.jailed.size} with known prior state`);

  const now = new Date().toISOString();
  let written = 0;
  const first = prev.jailed.size === 0;

  for (const [addr, v] of state) {
    const was = prev.jailed.get(addr);
    // First ever run: seed current state without inventing transitions that
    // we did not observe. Recording "jailed" for 50 validators today would
    // imply they were all jailed today, which is false.
    if (was === undefined) {
      if (!first) {
        // A validator we have never seen before appearing already jailed is
        // worth one row; appearing healthy needs none.
        if (v.jailed) written += await insertEvent({
          operator_address: addr, moniker: v.moniker, event_type: "jailed",
          reason: null, amount_tx: null, height: head, occurred_at: now, source: "state_diff",
        });
      }
      continue;
    }
    if (v.jailed !== was) {
      written += await insertEvent({
        operator_address: addr, moniker: v.moniker,
        event_type: v.jailed ? "jailed" : "unjailed",
        reason: null, amount_tx: null, height: head, occurred_at: now, source: "state_diff",
      });
    }
  }

  // Tombstones are permanent, so only the false -> true edge matters.
  for (const [addr, v] of state) {
    if (tomb.get(addr) === true && !prev.tombstoned.has(addr) && !first) {
      written += await insertEvent({
        operator_address: addr, moniker: v.moniker, event_type: "tombstoned",
        reason: "double_sign", amount_tx: null, height: head, occurred_at: now, source: "state_diff",
      });
    }
  }

  if (first) {
    log("info", "First run: seeding baseline, no historical transitions invented");
    // Seed the baseline so the NEXT run has something to diff against.
    if (!DRY_RUN) {
      for (const [addr, v] of state) {
        await query(
          `INSERT INTO slashing_events
             (operator_address, moniker, event_type, height, occurred_at, source)
           VALUES ($1,$2,$3,$4,$5,'state_diff') ON CONFLICT DO NOTHING`,
          [addr, v.moniker, v.jailed ? "jailed" : "unjailed", head, now]);
        // Seed tombstones too. Without this the NEXT run sees tombstoned=true
        // with no prior record and emits a tombstone event dated today for
        // validators that double-signed long ago.
        if (tomb.get(addr) === true) {
          await query(
            `INSERT INTO slashing_events
               (operator_address, moniker, event_type, reason, height, occurred_at, source)
             VALUES ($1,$2,'tombstoned','double_sign',$3,$4,'state_diff') ON CONFLICT DO NOTHING`,
            [addr, v.moniker, head, now]);
        }
      }
      log("info", `Baseline seeded for ${state.size} validators`);
    }
  }

  // ── path 2: block events (best effort, never fatal) ──
  let cursor = head - 1;
  try {
    const { rows } = await query(`SELECT last_height FROM slashing_cursor WHERE id = 1`);
    if (rows.length) cursor = Number(rows[0].last_height);
  } catch { /* table may not exist yet on a partial migration */ }

  const from = Math.max(cursor + 1, head - MAX_BLOCKS);
  if (from <= head) {
    try {
      // consMap already fetched above for the tombstone re-keying.
      const { found, scanned } = await scanBlockEvents(from, head, consMap);
      for (const e of found) written += await insertEvent(e);
      log("info", `Scanned ${scanned} blocks (${from}-${head}), ${found.length} slash event(s)`);
      if (!DRY_RUN) {
        await query(
          `INSERT INTO slashing_cursor (id, last_height, updated_at) VALUES (1,$1,NOW())
           ON CONFLICT (id) DO UPDATE SET last_height = EXCLUDED.last_height, updated_at = NOW()`,
          [head]);
      }
    } catch (e) {
      // Never let the event path take down the state path.
      log("warn", `Block-event scan failed, jail history unaffected: ${e.message}`);
    }
  }

  log("info", `Done. ${written} event(s) recorded${DRY_RUN ? " (dry run, nothing written)" : ""}`);
}

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch(async (e) => {
    log("error", `FAILED: ${e.message}`);
    await closePool().catch(() => {});
    process.exit(1);
  });
