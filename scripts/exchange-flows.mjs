// Net exchange flow over a window, or two windows compared around an event.
//
// Written after a hand-rolled version of this scan produced numbers that were
// wrong twice, in two different ways. Both mistakes are guarded against here.
//
//   1. Window boundaries were estimated from an assumed 0.7426s block time
//      rather than read from real block timestamps. The estimate drifted far
//      enough to move transactions between the before and after windows, which
//      changed a headline figure from "87% of the swing is one wallet" to
//      "102%". Boundaries are now found by binary search on actual block times.
//
//   2. tx_search only sees what the node it is asked has indexed, and index
//      COVERAGE is not the same as the tx_index setting. All-time deposits
//      into one Gate address: archive 8,668, ecostake 757, polkachu 394,
//      rpc.silknodes.io 0. That last node runs indexer = "kv" and reports
//      tx_index "on"; its index simply starts a few hours back, because
//      tx_index only fills for blocks a node actually executes, so a
//      state-synced node has none of the history it can still serve blocks
//      for. node_info tells you the setting, never the coverage. A short
//      index returns a smaller number with no error, so the scan looks like
//      it worked. The node's real index floor is measured below and the run
//      aborts if it starts after the window.
//
// Usage:
//   node scripts/exchange-flows.mjs --days 7
//   node scripts/exchange-flows.mjs --around 2026-08-14T21:05:00Z --days 7
//   node scripts/exchange-flows.mjs --around <iso> --days 7 --json
//
// Caveats this prints and you should keep saying out loud:
//   - It covers the labelled hot wallets below. Exchanges use many deposit
//     addresses, so this is a consistent sample, not total exchange flow.
//   - A single large transfer can dominate a week. The output always breaks
//     out the largest one so a whale is never mistaken for a trend.

const RPC = process.env.RPC || "https://archive.rpc.mainnet-1.tx.org";

// Labelled exchange hot wallets. Keep in sync with vm-service/collect-exchange-flows.
const EXCHANGES = {
  Gate: "core155svs6sgxe55rnvs6ghprtqu0mh69kehsahk8c",
  Kraken: "core1ctpu5ssl0hys60ukglv9pwzmqtys3x9gn8fh5l",
  MEXC: "core12lj6mhmhuvjwfwwxkzucqq9vq7hkp0gl5tnune",
  Bitrue: "core1g2c72hh78wma9fqlva9wu5a9hx5vq8aeznltds",
  Bitget: "core1yr8z44x2cxdaen0ha95qchqmugckxllwa7qcgx",
};

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 || i === args.length - 1 ? fallback : args[i + 1];
};
const DAYS = Number(flag("days", "7"));
const AROUND = flag("around");
const AS_JSON = args.includes("--json");

async function rpc(path, timeoutMs = 60_000) {
  for (let i = 0; i < 4; i++) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeoutMs);
    try {
      const r = await fetch(`${RPC}${path}`, { signal: c.signal });
      if (r.ok) return await r.json();
    } catch { /* retry */ } finally { clearTimeout(t); }
  }
  return null;
}

const blockTime = async (h) => {
  const b = await rpc(`/block?height=${h}`);
  const t = b?.result?.block?.header?.time;
  return t ? Date.parse(t) : null;
};

/** Height of the first block at or after a timestamp. Binary search, no
 *  assumption about block time, which is what the estimate got wrong. */
async function heightAt(target, tipHeight, lowest = 1) {
  // Start at the node's retained floor, not block 1. A pruned node cannot
  // serve blocks below it, and probing there fails the search on nodes that
  // do cover the window we actually want.
  let lo = Math.max(1, lowest), hi = tipHeight;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const t = await blockTime(mid);
    if (t === null) throw new Error(`node cannot serve block ${mid}`);
    if (t < target) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/** ucore total from a possibly multi-denom amount string. */
function ucore(amount) {
  let total = 0;
  for (const part of String(amount).split(",")) {
    const p = part.trim();
    if (p.endsWith("ucore")) {
      const n = Number(p.slice(0, -5));
      if (Number.isFinite(n)) total += n;
    }
  }
  return total / 1e6;
}

/** Every matching transfer in a height range, fully paged. Throws rather than
 *  truncating: a short read here is indistinguishable from a quiet week. */
async function transfers(address, direction, fromH, toH) {
  const key = direction === "in" ? "transfer.recipient" : "transfer.sender";
  const q = encodeURIComponent(`"${key}='${address}' AND tx.height>=${fromH} AND tx.height<=${toH}"`);
  const out = [];
  let page = 1, total = null, walked = 0;
  for (;;) {
    const d = await rpc(`/tx_search?query=${q}&page=${page}&per_page=100&order_by=%22asc%22`);
    if (!d?.result) throw new Error(`tx_search failed for ${address} ${direction}`);
    total = Number(d.result.total_count);
    const txs = d.result.txs ?? [];
    if (txs.length === 0) break;
    for (const tx of txs) {
      walked++;
      for (const e of tx.tx_result?.events ?? []) {
        if (e.type !== "transfer") continue;
        const kv = {};
        for (const a of e.attributes) kv[a.key] = a.value;
        if ((direction === "in" ? kv.recipient : kv.sender) !== address) continue;
        const v = ucore(kv.amount ?? "");
        if (v > 0) out.push({ height: Number(tx.height), amount: v, counterparty: direction === "in" ? kv.sender : kv.recipient });
      }
    }
    if (walked >= total) break;
    if (++page > 300) throw new Error(`${address} ${direction}: more than 30,000 txs, refusing to truncate`);
  }
  return out;
}

const status = await rpc("/status");
const sync = status?.result?.sync_info;
if (!sync) { console.error(`cannot reach ${RPC}`); process.exit(2); }
const tipHeight = Number(sync.latest_block_height);
const tipTime = Date.parse(sync.latest_block_time);
if (Date.now() - tipTime > 300_000) {
  console.error(`${RPC} is ${(Math.round((Date.now() - tipTime) / 1000))}s behind tip. Refusing to scan from a stale node.`);
  process.exit(2);
}

const anchor = AROUND ? Date.parse(AROUND) : tipTime;
if (!Number.isFinite(anchor)) { console.error(`bad --around value: ${AROUND}`); process.exit(2); }
const windowMs = DAYS * 86_400_000;
const startTime = anchor - windowMs;
const endTime = Math.min(anchor + windowMs, tipTime);

// Guard 2: the node must actually cover the window. A pruned index answers
// with a smaller count and no error, which is the failure mode this prevents.
/**
 * Lowest block this node can actually serve.
 *
 * earliest_block_height is not dependable: rpc.silknodes.io reports 0 while
 * refusing every block below 82,486,560. Trusting the field sends the binary
 * search to block 1, where it fails and looks like a different problem. So we
 * probe when the field claims full history.
 */
async function oldestServable(tipH) {
  if (await blockTime(1) !== null) return 1;
  let lo = 1, hi = tipH;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (await blockTime(mid) !== null) hi = mid; else lo = mid + 1;
  }
  return lo;
}

const reported = Number(sync.earliest_block_height || 0);
const earliest = reported > 1 ? reported : await oldestServable(tipHeight);
let startH;
try {
  startH = await heightAt(startTime, tipHeight, earliest);
} catch (err) {
  // A pruning node reports earliest_block_height 0 and then fails to serve the
  // old blocks the search walks through. That is a pruned node, not a bug here.
  console.error(`${RPC} cannot serve the blocks needed to locate the window start.`);
  console.error(`It is pruned (${err instanceof Error ? err.message : err}). Use the archive node:`);
  console.error(`  RPC=https://archive.rpc.mainnet-1.tx.org node scripts/exchange-flows.mjs ${args.join(" ")}`);
  process.exit(2);
}
if (earliest > 1) {
  const floorTime = await blockTime(earliest);
  if (floorTime !== null && floorTime > startTime) {
    console.error(`${RPC} retains blocks only from ${new Date(floorTime).toISOString().slice(0, 10)} (height ${earliest.toLocaleString()}` +
      (reported > 1 ? "" : ", measured; the node reports 0") + `),`);
    console.error(`but the window starts ${new Date(startTime).toISOString().slice(0, 10)}. Its index cannot cover this window.`);
    console.error(`Use the archive node: RPC=https://archive.rpc.mainnet-1.tx.org`);
    process.exit(2);
  }
}
let anchorH, endH;
try {
  anchorH = AROUND ? await heightAt(anchor, tipHeight, earliest) : null;
  endH = await heightAt(endTime, tipHeight, earliest);
} catch (err) {
  console.error(`${RPC} cannot serve the blocks needed to locate the window: ${err instanceof Error ? err.message : err}`);
  console.error(`Use the archive node: RPC=https://archive.rpc.mainnet-1.tx.org`);
  process.exit(2);
}

// Guard 2b: prove the index is populated. Our own node reports earliest 0 and
// returns total_count 0 for every query because tx indexing is disabled, which
// would otherwise read as "no flows at all".
/** Transactions the node has indexed in a slice, or -1 if the query errors. */
async function indexedIn(fromH, toH) {
  const q = encodeURIComponent(`"tx.height>=${fromH} AND tx.height<=${toH}"`);
  const d = await rpc(`/tx_search?query=${q}&page=1&per_page=1`);
  if (!d?.result) return -1;
  return Number(d.result.total_count ?? 0);
}

/**
 * Lowest height this node has transactions indexed for.
 *
 * Measured, not read from config: node_info reports the tx_index SETTING,
 * which says nothing about coverage. rpc.silknodes.io reports tx_index "on"
 * and indexes only the last few hours, because the index fills as blocks are
 * executed and a state-synced node never executed the earlier ones.
 */
async function indexFloor(tipH) {
  const SLICE = 2000;
  if (await indexedIn(startH, startH + SLICE) > 0) return startH;
  let lo = startH, hi = tipH;
  while (hi - lo > SLICE) {
    const mid = Math.floor((lo + hi) / 2);
    if (await indexedIn(mid, mid + SLICE) > 0) hi = mid; else lo = mid + 1;
  }
  return hi;
}

const floor = await indexFloor(tipHeight);
if (floor > startH) {
  const floorTime = await blockTime(floor);
  console.error(`${RPC} has transactions indexed only from height ${floor.toLocaleString()}` +
    (floorTime ? ` (${new Date(floorTime).toISOString().slice(0, 16)}Z)` : "") + ",");
  console.error(`but this window starts at ${startH.toLocaleString()} (${new Date(startTime).toISOString().slice(0, 16)}Z).`);
  console.error(``);
  console.error(`This is index COVERAGE, not the tx_index setting. A node can report`);
  console.error(`tx_index "on" and still hold only recent history: the index fills as`);
  console.error(`blocks are executed, so a state-synced node has none for blocks before`);
  console.error(`the snapshot it started from, even where it can still serve those blocks.`);
  console.error(``);
  console.error(`Use the archive node:`);
  console.error(`  RPC=https://archive.rpc.mainnet-1.tx.org node scripts/exchange-flows.mjs ${args.join(" ")}`);
  process.exit(2);
}

const label = (h) => (anchorH === null ? "window" : h >= anchorH ? "after" : "before");
const buckets = {};
const all = [];
for (const [name, addr] of Object.entries(EXCHANGES)) {
  for (const dir of ["in", "out"]) {
    for (const t of await transfers(addr, dir, startH, endH)) {
      const b = (buckets[label(t.height)] ??= {});
      const v = (b[name] ??= { in: 0, out: 0 });
      v[dir] += t.amount;
      all.push({ ...t, venue: name, dir, period: label(t.height) });
    }
  }
}

const spanDays = (a, b) => (b - a) / 86_400_000;
/** Signed, thousands-separated, with the sign attached to the digits so the
 *  column stays aligned when padStart runs. */
const signed = (n) => (n >= 0 ? "+" : "-") + Math.abs(Math.round(n)).toLocaleString();
const periods = anchorH === null
  ? [["window", startTime, endTime]]
  : [["before", startTime, anchor], ["after", anchor, endTime]];

if (AS_JSON) {
  console.log(JSON.stringify({ rpc: RPC, startH, anchorH, endH, buckets }, null, 2));
} else {
  console.log(`node ${RPC}`);
  for (const [p, a, b] of periods) console.log(`  ${p}: ${new Date(a).toISOString().slice(0, 16)}Z to ${new Date(b).toISOString().slice(0, 16)}Z  (${spanDays(a, b).toFixed(2)} days)`);
  console.log();
  for (const [p, a, b] of periods) {
    const days = spanDays(a, b);
    const rows = buckets[p] ?? {};
    let ti = 0, to = 0;
    console.log(`${p.toUpperCase()}`);
    console.log(`  ${"venue".padEnd(8)}${"in".padStart(15)}${"out".padStart(15)}${"net".padStart(15)}`);
    for (const name of Object.keys(EXCHANGES)) {
      const v = rows[name] ?? { in: 0, out: 0 };
      ti += v.in; to += v.out;
      console.log(`  ${name.padEnd(8)}${Math.round(v.in).toLocaleString().padStart(15)}${Math.round(v.out).toLocaleString().padStart(15)}${signed(v.in - v.out).padStart(15)}`);
    }
    const net = ti - to;
    console.log(`  ${"TOTAL".padEnd(8)}${Math.round(ti).toLocaleString().padStart(15)}${Math.round(to).toLocaleString().padStart(15)}${signed(net).padStart(15)}`);
    console.log(`  per day: ${signed(net / days)} TX  (${net >= 0 ? "net INTO exchanges, sell side" : "net OUT of exchanges"})`);
    // Largest single transfer, so one whale is never read as a trend.
    const big = all.filter((t) => t.period === p).sort((x, y) => y.amount - x.amount)[0];
    if (big) {
      const swing = net;
      console.log(`  largest single: ${Math.round(big.amount).toLocaleString()} TX ${big.dir === "in" ? "into" : "out of"} ${big.venue}` +
        (swing !== 0 ? `, ${Math.abs(big.amount / swing * 100).toFixed(0)}% of this period's net` : ""));
      console.log(`                  net excluding it: ${signed(big.dir === "in" ? net - big.amount : net + big.amount)} TX`);
    }
    console.log();
  }
  console.log("Covers the labelled hot wallets only. Exchanges use many deposit");
  console.log("addresses, so this is a consistent sample, not total exchange flow.");
}
