#!/usr/bin/env node

/**
 * Silk Nodes Exchange Flows Collector
 *
 * Polls the Coreum LCD for Bank Send transactions touching each address
 * in the exchange_addresses table and records them into exchange_flows.
 * The Flows tab consumes these rows to render in / out / net signals
 * per exchange.
 *
 * Strategy:
 *   For each (address, direction) pair:
 *     1. Read the last_scanned_height cursor from DB
 *     2. Page through LCD txs filtered by transfer.recipient (inflow) or
 *        transfer.sender (outflow), starting from the cursor
 *     3. For each new transaction, parse its `transfer` events and
 *        INSERT one exchange_flows row per qualifying transfer
 *     4. Bump the cursor to the highest block height we just processed
 *
 * Idempotency: the UNIQUE constraint on
 *   (tx_hash, exchange_address, direction, counterparty, amount)
 * means re-fetching the same window is safe.
 *
 * Threshold: small fee transfers also generate `transfer` events. We
 * filter to amount >= MIN_FLOW_UCORE (1 TX = 1_000_000 ucore) so noise
 * doesn't pollute the cards. Real exchange traffic is way above this.
 *
 * Run via systemd: silknodes-exchange-flows.service (long-running daemon).
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

const LCD = process.env.LCD || "https://rest-coreum.ecostake.com";
const POLL_INTERVAL_MS = 5 * 60_000; // 5 min — exchange flows aren't real-time critical
const PAGE_LIMIT = 100;
const MIN_FLOW_UCORE = 1_000_000n; // 1 TX in ucore — drops fee-transfer noise
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

/** Pull amount from a denom-suffixed string like "12345ucore" -> 12345n. */
function parseUcoreAmount(amountStr) {
  if (!amountStr) return 0n;
  // amount can be comma-separated for multi-coin transfers; we only care
  // about the ucore portion.
  for (const part of String(amountStr).split(",")) {
    if (part.endsWith(NATIVE_DENOM)) {
      const num = part.slice(0, -NATIVE_DENOM.length);
      try {
        return BigInt(num);
      } catch {
        return 0n;
      }
    }
  }
  return 0n;
}

/** Find every `transfer` event inside a tx_response.events array that
 *  involves the given exchange address as `direction`. Returns an array
 *  of { counterparty, amountUcore } pairs, all >= MIN_FLOW_UCORE. */
function extractTransfers(events, address, direction) {
  const matches = [];
  if (!Array.isArray(events)) return matches;
  for (const ev of events) {
    if (ev?.type !== "transfer") continue;
    const attrs = Array.isArray(ev.attributes) ? ev.attributes : [];
    const get = (k) =>
      attrs.find((a) => (a?.key === k || a?.key === Buffer.from(k).toString("base64")))?.value;
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

/** Page through txs touching `address` in the given `direction` since
 *  `minHeight`. Returns the highest block height seen + count of inserted
 *  rows. */
async function scanDirection(address, direction, minHeight) {
  const eventQuery =
    direction === "inflow"
      ? `transfer.recipient='${address}'`
      : `transfer.sender='${address}'`;
  const heightQuery = minHeight > 0 ? `&query=tx.height>=${minHeight}` : "";

  let nextKey = null;
  let inserted = 0;
  let maxHeight = minHeight;
  let pages = 0;

  do {
    pages++;
    if (pages > 50) {
      log("warn", `${address} ${direction}: bailing after 50 pages — will resume next cycle`);
      break;
    }
    const keyParam = nextKey
      ? `&pagination.key=${encodeURIComponent(nextKey)}`
      : "";
    const url =
      `${LCD}/cosmos/tx/v1beta1/txs` +
      `?events=${encodeURIComponent(eventQuery)}` +
      `&pagination.limit=${PAGE_LIMIT}` +
      `&order_by=ORDER_BY_DESC` +
      heightQuery +
      keyParam;

    const data = await fetchWithRetry(url);
    const responses = Array.isArray(data?.tx_responses) ? data.tx_responses : [];

    for (const r of responses) {
      const height = parseInt(r.height, 10);
      if (Number.isFinite(height) && height > maxHeight) maxHeight = height;
      if (height <= minHeight) continue; // already processed last cycle

      const transfers = extractTransfers(r.events, address, direction);
      if (transfers.length === 0) continue;

      const timestamp = r.timestamp; // ISO string from LCD
      for (const t of transfers) {
        const amountTx = Number(t.amountUcore) / 10 ** DECIMALS;
        const n = await writeExchangeFlow({
          tx_hash: r.txhash,
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
    nextKey = data?.pagination?.next_key ?? null;
  } while (nextKey);

  return { maxHeight, inserted };
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
    let newCursor = cursor;

    for (const direction of ["inflow", "outflow"]) {
      try {
        const { maxHeight, inserted } = await scanDirection(
          address,
          direction,
          cursor,
        );
        totalInserted += inserted;
        if (maxHeight > newCursor) newCursor = maxHeight;
      } catch (err) {
        log(
          "error",
          `${exchange_name} (${address}) ${direction} scan failed: ${err.message}`,
        );
      }
    }

    if (newCursor > cursor) {
      await setExchangeFlowsCursor(address, newCursor);
    }
    log(
      "info",
      `${exchange_name.padEnd(8)} ${totalInserted} new flow(s)  cursor: ${cursor} -> ${newCursor}`,
    );
  }
}

async function main() {
  log("info", "Silk Nodes Exchange Flows Collector starting");
  log("info", `REPO_PATH: ${REPO_PATH}`);
  log("info", `LCD: ${LCD}`);
  log("info", `POLL_INTERVAL_MS: ${POLL_INTERVAL_MS}`);

  // Long-running daemon: poll, sleep, repeat. Errors inside pollOnce
  // are swallowed per-address so one flaky LCD response doesn't take
  // the whole daemon down.
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
