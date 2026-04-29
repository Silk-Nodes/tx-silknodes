#!/usr/bin/env node

/**
 * One-shot historical backfill for the Flows tab.
 *
 * The continuous daemon (collect-exchange-flows.mjs) only scans forward
 * from the current chain tip. This script does the opposite: walks the
 * full chain history for each tracked exchange address and fills the
 * exchange_flows table with everything since genesis.
 *
 * Run ONCE on the VM after migration 002 applies:
 *
 *   set -a; source ~/.silknodes-db.env; set +a
 *   node vm-service/backfill-exchange-flows.mjs
 *
 * Idempotent — safe to re-run; existing rows are skipped via the UNIQUE
 * constraint. Cursors are also updated, so the continuous daemon won't
 * re-scan the same range afterwards.
 *
 * Uses Tendermint RPC tx_search (same endpoint pattern as the staking
 * collector) because the LCD's tx query endpoint returns 500s on this
 * network.
 */

import {
  getExchangeFlowsCursor,
  listExchangeAddresses,
  setExchangeFlowsCursor,
  writeExchangeFlow,
} from "./db-writes.mjs";
import { closePool } from "./db.mjs";

const RPC = process.env.RPC || "https://rpc-coreum.ecostake.com";
const PER_PAGE = 100;
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

const blockTimestampCache = new Map();
async function getBlockTime(height) {
  if (blockTimestampCache.has(height)) return blockTimestampCache.get(height);
  try {
    const data = await fetchWithRetry(`${RPC}/block?height=${height}`);
    const time = data?.result?.block?.header?.time;
    if (time) {
      blockTimestampCache.set(height, time);
      // Backfill cache can grow larger — we may process tens of thousands
      // of blocks. 5000 entries ~= 1 MB, fine for a one-shot script.
      if (blockTimestampCache.size > 5000) {
        const firstKey = blockTimestampCache.keys().next().value;
        blockTimestampCache.delete(firstKey);
      }
      return time;
    }
  } catch {
    // swallow — we just skip rows we can't timestamp
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

function buildQuery(address, direction) {
  const eventClause =
    direction === "inflow"
      ? `transfer.recipient='${address}'`
      : `transfer.sender='${address}'`;
  return `"${eventClause}"`;
}

async function backfillDirection(address, exchangeName, direction) {
  let page = 1;
  let inserted = 0;
  let maxHeight = 0;
  let processed = 0;
  let totalCount = Infinity;
  // 50k txs = 500 pages × 100/page; well past anything realistic for
  // one address since chain genesis. Keeps a runaway from blowing the
  // RPC budget.
  const MAX_PAGES = 500;

  while (processed < totalCount && page <= MAX_PAGES) {
    const q = encodeURIComponent(buildQuery(address, direction));
    const url = `${RPC}/tx_search?query=${q}&page=${page}&per_page=${PER_PAGE}&order_by=%22asc%22`;
    const data = await fetchWithRetry(url);

    totalCount = parseInt(data?.result?.total_count || "0", 10);
    const txs = data?.result?.txs || [];
    if (txs.length === 0) break;

    for (const tx of txs) {
      const height = parseInt(tx.height, 10);
      if (Number.isFinite(height) && height > maxHeight) maxHeight = height;
      const events = tx?.tx_result?.events || [];
      const transfers = extractTransfers(events, address, direction);
      processed++;
      if (transfers.length === 0) continue;

      const timestamp = await getBlockTime(height);
      if (!timestamp) continue;
      for (const t of transfers) {
        const amountTx = Number(t.amountUcore) / 10 ** DECIMALS;
        inserted += await writeExchangeFlow({
          tx_hash: tx.hash,
          height,
          timestamp,
          exchange_address: address,
          direction,
          counterparty: t.counterparty,
          amount: amountTx,
        });
      }
    }
    page++;
    process.stdout.write(
      `\r  [${exchangeName} ${direction}] page ${page - 1}/${Math.ceil(
        totalCount / PER_PAGE,
      )} · processed=${processed}/${totalCount} · inserted=${inserted} · height=${maxHeight}   `,
    );
  }

  console.log(
    `\n  [${exchangeName} ${direction}] DONE — pages=${page - 1}, processed=${processed}/${totalCount}, max height=${maxHeight}, inserted=${inserted}`,
  );
  return { maxHeight, inserted };
}

async function main() {
  console.log(`Backfilling exchange flows from ${RPC}\n`);
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
