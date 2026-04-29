#!/usr/bin/env node

/**
 * Silk Nodes Exchange Flows Collector
 *
 * Polls the Coreum Tendermint RPC for Bank Send transactions touching
 * each address in the exchange_addresses table and records them into
 * exchange_flows. The Flows tab consumes these rows.
 *
 * Uses Tendermint RPC `tx_search` (same endpoint pattern as the staking
 * collector) rather than the LCD's `/cosmos/tx/v1beta1/txs` because the
 * LCD endpoint returns 500s on this network for these queries.
 *
 * Strategy per cycle, for each (address, direction):
 *   1. Read last_scanned_height cursor from DB
 *   2. tx_search with query
 *        "transfer.recipient='X' AND tx.height>cursor"  (inflow)
 *      or
 *        "transfer.sender='X' AND tx.height>cursor"     (outflow)
 *   3. For each tx, resolve block timestamp via /block, parse the
 *      transfer events, INSERT one exchange_flows row per qualifying
 *      transfer
 *   4. Bump cursor to the highest block height we processed
 *
 * Idempotent: UNIQUE (tx_hash, exchange_address, direction, counterparty,
 * amount) means re-fetching the same window is safe.
 *
 * Threshold: tx fees also generate transfer events. We filter to amount
 * >= MIN_FLOW_UCORE (1 TX = 1_000_000 ucore) so noise stays out.
 */

import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import {
  getExchangeFlowsCursor,
  listExchangeAddresses,
  setExchangeFlowsCursor,
  writeExchangeFlow,
} from "./db-writes.mjs";
import { closePool } from "./db.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_PATH = process.env.REPO_PATH || resolve(__dirname, "..");

const RPC = process.env.RPC || "https://rpc-coreum.ecostake.com";
const POLL_INTERVAL_MS = 5 * 60_000; // 5 min
const PER_PAGE = 100;
const MIN_FLOW_UCORE = 1_000_000n; // 1 TX in ucore — drops fee transfers
const NATIVE_DENOM = "ucore";
const DECIMALS = 6;
const LOG_LEVEL = process.env.LOG_LEVEL || "info";

const levels = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = levels[LOG_LEVEL] ?? 1;
function log(level, ...args) {
  if (levels[level] < currentLevel) return;
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${level.toUpperCase()}]`, ...args);
}

async function fetchWithRetry(url, attempt = 1) {
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.json();
  } catch (err) {
    if (attempt >= 3) throw err;
    await new Promise((r) => setTimeout(r, 500 * attempt));
    return fetchWithRetry(url, attempt + 1);
  }
}

// LRU-ish cache: avoids re-fetching block headers when a single batch
// includes multiple txs from the same height. Capped to 500 entries to
// bound memory use over a long-running daemon.
const blockTimestampCache = new Map();
async function getBlockTime(height) {
  if (blockTimestampCache.has(height)) return blockTimestampCache.get(height);
  try {
    const data = await fetchWithRetry(`${RPC}/block?height=${height}`);
    const time = data?.result?.block?.header?.time;
    if (time) {
      blockTimestampCache.set(height, time);
      if (blockTimestampCache.size > 500) {
        const firstKey = blockTimestampCache.keys().next().value;
        blockTimestampCache.delete(firstKey);
      }
      return time;
    }
  } catch (e) {
    log("warn", `Failed to fetch block ${height}: ${e.message}`);
  }
  return null;
}

function parseUcoreAmount(amountStr) {
  if (!amountStr) return 0n;
  for (const part of String(amountStr).split(",")) {
    if (part.endsWith(NATIVE_DENOM)) {
      try {
        return BigInt(part.slice(0, -NATIVE_DENOM.length));
      } catch {
        return 0n;
      }
    }
  }
  return 0n;
}

/** Extract every transfer event in a tx that involves `address` as
 *  `direction`. Filters out fee-sized transfers via MIN_FLOW_UCORE. */
function extractTransfers(events, address, direction) {
  const matches = [];
  if (!Array.isArray(events)) return matches;
  for (const ev of events) {
    if (ev?.type !== "transfer") continue;
    const attrs = Array.isArray(ev.attributes) ? ev.attributes : [];
    const get = (k) => attrs.find((a) => a?.key === k)?.value;
    const recipient = get("recipient");
    const sender = get("sender");
    const amountStr = get("amount");
    if (!recipient || !sender || !amountStr) continue;
    const isMatch =
      (direction === "inflow" && recipient === address) ||
      (direction === "outflow" && sender === address);
    if (!isMatch) continue;
    const amountUcore = parseUcoreAmount(amountStr);
    if (amountUcore < MIN_FLOW_UCORE) continue;
    matches.push({
      counterparty: direction === "inflow" ? sender : recipient,
      amountUcore,
    });
  }
  return matches;
}

/** Tendermint tx_search wraps the query in double quotes, with single
 *  quotes around the values. Same pattern collect-staking-events.mjs uses
 *  successfully on the same RPC. */
function buildQuery(address, direction, minHeight) {
  const eventClause =
    direction === "inflow"
      ? `transfer.recipient='${address}'`
      : `transfer.sender='${address}'`;
  const heightClause = minHeight > 0 ? ` AND tx.height>${minHeight}` : "";
  return `"${eventClause}${heightClause}"`;
}

async function scanDirection(address, direction, minHeight) {
  let page = 1;
  let inserted = 0;
  let maxHeight = minHeight;
  let totalCount = Infinity;
  let processed = 0;

  while (processed < totalCount) {
    const q = encodeURIComponent(buildQuery(address, direction, minHeight));
    const url = `${RPC}/tx_search?query=${q}&page=${page}&per_page=${PER_PAGE}&order_by=%22asc%22`;
    const data = await fetchWithRetry(url);

    const txs = data?.result?.txs || [];
    totalCount = parseInt(data?.result?.total_count || "0", 10);
    if (txs.length === 0) break;

    for (const tx of txs) {
      const height = parseInt(tx.height, 10);
      if (Number.isFinite(height) && height > maxHeight) maxHeight = height;
      const events = tx?.tx_result?.events || [];
      const transfers = extractTransfers(events, address, direction);
      processed++;
      if (transfers.length === 0) continue;

      const timestamp = await getBlockTime(height);
      if (!timestamp) continue; // skip if we can't get a real timestamp
      for (const t of transfers) {
        const amountTx = Number(t.amountUcore) / 10 ** DECIMALS;
        const n = await writeExchangeFlow({
          tx_hash: tx.hash,
          height,
          timestamp,
          exchange_address: address,
          direction,
          counterparty: t.counterparty,
          amount: amountTx,
        });
        inserted += n;
      }
    }

    page++;
    // Safety bail — incremental polls should never need many pages.
    if (page > 50) {
      log("warn", `${address} ${direction}: bailing at page 50, will resume next cycle`);
      break;
    }
  }

  return { maxHeight, inserted, processed };
}

async function pollOnce() {
  const addresses = await listExchangeAddresses();
  if (addresses.length === 0) {
    log("warn", "No exchange_addresses configured — nothing to scan");
    return;
  }
  log("info", `Scanning ${addresses.length} exchange addresses…`);

  for (const { address, exchange_name } of addresses) {
    const cursor = await getExchangeFlowsCursor(address);
    let totalInserted = 0;
    let totalProcessed = 0;
    let newCursor = cursor;

    for (const direction of ["inflow", "outflow"]) {
      try {
        const { maxHeight, inserted, processed } = await scanDirection(
          address,
          direction,
          cursor,
        );
        totalInserted += inserted;
        totalProcessed += processed;
        if (maxHeight > newCursor) newCursor = maxHeight;
      } catch (err) {
        log(
          "error",
          `${exchange_name} (${address}) ${direction} scan failed: ${err.message}`,
        );
      }
    }

    if (newCursor > cursor) await setExchangeFlowsCursor(address, newCursor);
    log(
      "info",
      `${exchange_name.padEnd(8)} processed=${totalProcessed} new=${totalInserted}  cursor: ${cursor} -> ${newCursor}`,
    );
  }
}

async function main() {
  log("info", "Silk Nodes Exchange Flows Collector starting");
  log("info", `REPO_PATH: ${REPO_PATH}`);
  log("info", `RPC: ${RPC}`);
  log("info", `POLL_INTERVAL_MS: ${POLL_INTERVAL_MS}`);

  while (true) {
    try {
      await pollOnce();
    } catch (err) {
      log("error", `Top-level poll error: ${err.stack || err.message}`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

main().catch((err) => {
  log("error", `Fatal: ${err.stack || err.message}`);
  closePool().finally(() => process.exit(1));
});
