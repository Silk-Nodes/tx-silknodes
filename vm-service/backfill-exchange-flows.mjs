#!/usr/bin/env node

/**
 * One-shot historical backfill for the Flows tab.
 *
 * The continuous daemon (collect-exchange-flows.mjs) only scans forward
 * from the current chain tip. This script does the opposite: starts
 * from height 0 and walks the chain forward through every Bank Send
 * touching the tracked exchange addresses, populating exchange_flows
 * with all of history.
 *
 * Run it ONCE on the VM after the migration applies:
 *
 *   set -a; source ~/.silknodes-db.env; set +a
 *   node vm-service/backfill-exchange-flows.mjs
 *
 * Idempotent — re-running is safe; existing rows are skipped via the
 * UNIQUE constraint. Cursors are also updated, so the continuous
 * daemon won't re-scan the same range afterwards.
 */

import {
  getExchangeFlowsCursor,
  listExchangeAddresses,
  setExchangeFlowsCursor,
  writeExchangeFlow,
} from "./db-writes.mjs";
import { closePool } from "./db.mjs";

const LCD = process.env.LCD || "https://rest-coreum.ecostake.com";
const PAGE_LIMIT = 100;
const MIN_FLOW_UCORE = 1_000_000n;
const NATIVE_DENOM = "ucore";
const DECIMALS = 6;

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

async function backfillDirection(address, exchangeName, direction) {
  const eventQuery =
    direction === "inflow"
      ? `transfer.recipient='${address}'`
      : `transfer.sender='${address}'`;

  let nextKey = null;
  let inserted = 0;
  let maxHeight = 0;
  let pages = 0;
  // Hard upper bound to keep a runaway script from blowing through the
  // LCD rate limits. 500 pages × 100 = 50 000 txs per direction is plenty
  // for any realistic exchange address since Coreum genesis.
  const MAX_PAGES = 500;

  do {
    pages++;
    if (pages > MAX_PAGES) {
      console.log(`  [${exchangeName} ${direction}] hit MAX_PAGES — stopping`);
      break;
    }
    const keyParam = nextKey
      ? `&pagination.key=${encodeURIComponent(nextKey)}`
      : "";
    const url =
      `${LCD}/cosmos/tx/v1beta1/txs` +
      `?events=${encodeURIComponent(eventQuery)}` +
      `&pagination.limit=${PAGE_LIMIT}` +
      `&order_by=ORDER_BY_ASC` +
      keyParam;

    const data = await fetchWithRetry(url);
    const responses = Array.isArray(data?.tx_responses) ? data.tx_responses : [];

    for (const r of responses) {
      const height = parseInt(r.height, 10);
      if (Number.isFinite(height) && height > maxHeight) maxHeight = height;
      const transfers = extractTransfers(r.events, address, direction);
      if (transfers.length === 0) continue;
      for (const t of transfers) {
        const amountTx = Number(t.amountUcore) / 10 ** DECIMALS;
        inserted += await writeExchangeFlow({
          tx_hash: r.txhash,
          height,
          timestamp: r.timestamp,
          exchange_address: address,
          direction,
          counterparty: t.counterparty,
          amount: amountTx,
        });
      }
    }
    nextKey = data?.pagination?.next_key ?? null;
    if (pages % 10 === 0) {
      process.stdout.write(
        `\r  [${exchangeName} ${direction}] page ${pages}, height ~${maxHeight}, ${inserted} inserted   `,
      );
    }
  } while (nextKey);

  console.log(
    `\n  [${exchangeName} ${direction}] DONE — ${pages} pages, max height ${maxHeight}, ${inserted} rows inserted`,
  );
  return { maxHeight, inserted };
}

async function main() {
  console.log(`Backfilling exchange flows from ${LCD}\n`);
  const start = Date.now();

  const addresses = await listExchangeAddresses();
  console.log(
    `Tracked addresses: ${addresses.map((a) => a.exchange_name).join(", ")}\n`,
  );

  let grandTotal = 0;
  for (const { address, exchange_name } of addresses) {
    console.log(`==> ${exchange_name} (${address})`);
    let highest = await getExchangeFlowsCursor(address);
    for (const direction of ["inflow", "outflow"]) {
      try {
        const { maxHeight, inserted } = await backfillDirection(
          address,
          exchange_name,
          direction,
        );
        grandTotal += inserted;
        if (maxHeight > highest) highest = maxHeight;
      } catch (err) {
        console.error(
          `  [${exchange_name} ${direction}] FAILED: ${err.message}`,
        );
      }
    }
    if (highest > 0) await setExchangeFlowsCursor(address, highest);
    console.log();
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`GRAND TOTAL: ${grandTotal} rows in ${elapsed}s`);
}

main()
  .catch((err) => {
    console.error("FAILED:", err.stack || err.message);
    process.exitCode = 1;
  })
  .finally(() => closePool().catch(() => {}));
