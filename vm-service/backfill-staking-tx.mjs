#!/usr/bin/env node
// One-shot backfill of staking_events from a specific transaction.
//
// Useful when we know a tx contains delegate/unbond/redelegate events
// but the collector's regular polling didn't catch it — e.g. because
// it was wrapped in MsgExecuteContract or MsgExec or (as in our case)
// /cosmos.group.v1.MsgVote → auto-exec from a Group multisig. The new
// per-validator fallback (PR #156) catches future cases; this script
// brings known past ones into the staking_events table on demand.
//
// Idempotent: writeStakingEvents() uses ON CONFLICT DO NOTHING on
// (tx_hash, type, height, delegator, validator), so running this
// twice produces the same final state as running it once.
//
// Default hash is the TX Foundation Group-multisig tx from height
// 72967930 that delegated 116M TX across 58 validators on Silk Nodes
// and the rest of the active set — pass --hash to target a different tx.
//
// Usage:
//   node vm-service/backfill-staking-tx.mjs
//   node vm-service/backfill-staking-tx.mjs --hash=E251...0C69
//   node vm-service/backfill-staking-tx.mjs --dry-run

import { writeStakingEvents } from "./db-writes.mjs";
import { closePool } from "./db.mjs";

const RPC = "https://full-node.mainnet-1.coreum.dev:26657";
const DECIMALS = 6;
const DEFAULT_HASH =
  "E25185E05D4B6DD7A9E3B3941E577D9A2B74DADD1C3BCC19886789B977E90C69";
const MIN_AMOUNT_TX = 5_000; // match the collector's MIN_AMOUNT_TX

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);
const HASH = (args.hash || DEFAULT_HASH).replace(/^0x/, "").toUpperCase();
const DRY_RUN = args["dry-run"] === "true";

const STAKING_EVENT_TYPES = {
  delegate: "delegate",
  unbond: "undelegate",
  redelegate: "redelegate",
};

function ts() {
  return new Date().toISOString();
}
function log(level, ...rest) {
  console.log(`[${ts()}] [${level.toUpperCase()}]`, ...rest);
}

function parseUcoreAmount(s) {
  const m = /^(\d+)ucore$/.exec(s || "");
  if (!m) return 0;
  return Number(m[1]) / 10 ** DECIMALS;
}

function attr(event, key) {
  return event.attributes?.find((a) => a.key === key)?.value || null;
}

async function fetchTx(hash) {
  // Tendermint /tx returns events with type strings and key/value attrs.
  const r = await fetch(`${RPC}/tx?hash=0x${hash}`);
  if (!r.ok) throw new Error(`/tx HTTP ${r.status}`);
  const d = await r.json();
  if (d.error) throw new Error(`/tx error: ${JSON.stringify(d.error)}`);
  return d.result;
}

async function fetchBlockTime(height) {
  const r = await fetch(`${RPC}/block?height=${height}`);
  if (!r.ok) throw new Error(`/block HTTP ${r.status}`);
  const d = await r.json();
  return d.result?.block?.header?.time;
}

function extractEvents(tx) {
  const height = parseInt(tx.height);
  const hash = tx.hash;
  const events = tx.tx_result?.events || [];

  // Tx signer for redelegate fallback. We pick the first /message event's
  // sender — for a Group-multisig exec that's the voter who triggered the
  // auto-exec, not the group policy address. The group policy IS the
  // delegator in the delegate event's `delegator` attribute, so we use
  // that directly and only fall back to txSigner for events that omit it.
  const txSigner = events.find(
    (e) => e.type === "message" && e.attributes?.some((a) => a.key === "sender"),
  )?.attributes?.find((a) => a.key === "sender")?.value;

  const out = [];
  for (const e of events) {
    const recordType = STAKING_EVENT_TYPES[e.type];
    if (!recordType) continue;

    const amount = parseUcoreAmount(attr(e, "amount"));
    if (amount < MIN_AMOUNT_TX) continue;

    const delegator = attr(e, "delegator") || txSigner;
    let validator = attr(e, "validator");
    let sourceValidator = null;
    let destinationValidator = null;

    if (recordType === "redelegate") {
      sourceValidator = attr(e, "source_validator");
      destinationValidator = attr(e, "destination_validator");
      validator = destinationValidator;
    }

    if (!delegator || !validator) continue;

    out.push({
      type: recordType,
      txHash: hash,
      height,
      delegator,
      validator,
      ...(sourceValidator && { sourceValidator }),
      amount,
    });
  }
  return out;
}

async function main() {
  log("info", `Backfill tx ${HASH} (dry_run=${DRY_RUN})`);

  const tx = await fetchTx(HASH);
  const height = parseInt(tx.height);
  log("info", `Fetched tx at height ${height}`);

  const parsed = extractEvents(tx);
  log("info", `Parsed ${parsed.length} staking events (≥ ${MIN_AMOUNT_TX} TX)`);

  // Per-type breakdown for sanity
  const byType = parsed.reduce((acc, e) => {
    acc[e.type] = (acc[e.type] || 0) + 1;
    return acc;
  }, {});
  for (const [t, n] of Object.entries(byType)) {
    console.log(`  ${t}: ${n}`);
  }

  // Per-delegator breakdown
  const byDelegator = parsed.reduce((acc, e) => {
    if (!acc[e.delegator]) acc[e.delegator] = { count: 0, total: 0 };
    acc[e.delegator].count++;
    acc[e.delegator].total += e.amount;
    return acc;
  }, {});
  console.log();
  for (const [d, s] of Object.entries(byDelegator)) {
    console.log(
      `  ${d}  →  ${s.count} delegations, ${s.total.toLocaleString(undefined, { maximumFractionDigits: 0 })} TX total`,
    );
  }

  if (DRY_RUN) {
    log("info", "[dry-run] would insert these events");
    await closePool();
    return;
  }

  const timestamp = await fetchBlockTime(height);
  if (!timestamp) {
    log("error", `Could not resolve block timestamp for height ${height}`);
    process.exit(1);
  }
  log("info", `Block timestamp: ${timestamp}`);

  const enriched = parsed.map((e) => ({ ...e, timestamp }));
  const inserted = await writeStakingEvents(enriched);
  log(
    "info",
    `Inserted ${inserted} new rows into staking_events (${enriched.length - inserted} were already present)`,
  );

  await closePool();
}

main().catch((e) => {
  log("error", e.stack || e.message);
  process.exit(1);
});
