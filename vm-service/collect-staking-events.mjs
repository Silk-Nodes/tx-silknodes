#!/usr/bin/env node

/**
 * Silk Nodes Staking Events Collector
 *
 * Runs 24/7 on a home VM. Polls Coreum RPC for delegate/undelegate/redelegate
 * transactions, stores a rolling 3 month window in staking-events.json, and
 * pushes to GitHub every 5 minutes.
 *
 * Environment variables:
 *   REPO_PATH    Path to the tx-silknodes repo (default: parent of this file's dir)
 *   GIT_PUSH     Set to "false" to disable git push (for local testing)
 *   LOG_LEVEL    "debug" | "info" | "warn" | "error" (default: "info")
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { bech32 } from "bech32";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_PATH = process.env.REPO_PATH || resolve(__dirname, "..");
const DATA_FILE = join(REPO_PATH, "public", "analytics", "staking-events.json");
const DATA_FILE_REL = "public/analytics/staking-events.json";
// Pending undelegations is a "current-state snapshot" (list of unbonding
// entries whose completion_time is in the future). It's owned by this
// continuous collector instead of the daily analytics collector because:
//   - It needs to refresh faster than once/day — entries mature at arbitrary
//     times and a daily cadence leaves completed entries on the chart for
//     up to 24h.
//   - Single writer = no push races.
// The daily collector no longer writes this file (PR that introduced this
// change removed its section).
const PENDING_FILE = join(REPO_PATH, "public", "analytics", "pending-undelegations.json");
const PENDING_FILE_REL = "public/analytics/pending-undelegations.json";
// Top delegators: ranked list of largest bonded accounts. Refreshed every
// few hours (stake rankings move slowly). known-entities.json piggy-backs
// on the same refresh cycle since it's also a "who is who" artifact.
const TOP_DELEGATORS_FILE = join(REPO_PATH, "public", "analytics", "top-delegators.json");
const TOP_DELEGATORS_FILE_REL = "public/analytics/top-delegators.json";
const KNOWN_ENTITIES_FILE = join(REPO_PATH, "public", "analytics", "known-entities.json");
const KNOWN_ENTITIES_FILE_REL = "public/analytics/known-entities.json";
const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const GIT_PUSH_ENABLED = process.env.GIT_PUSH !== "false";

// ═══ CONFIG ═══
const RPC = "https://rpc-coreum.ecostake.com";
const LCD = "https://rest-coreum.ecostake.com";
const DECIMALS = 6;
const MIN_AMOUNT_TX = 5000;
const RETENTION_DAYS = 90;
const POLL_INTERVAL_MS = 60_000;
const PUSH_INTERVAL_MS = 5 * 60_000;
const HEARTBEAT_INTERVAL_MS = 30 * 60_000; // force a push every 30 min so updatedAt never goes silently stale
const PENDING_REFRESH_MS = 15 * 60_000; // refresh pending undelegations every 15 min
const TOP_DELEGATORS_REFRESH_MS = 6 * 60 * 60_000; // refresh ranked delegator list every 6 h
const TOP_DELEGATORS_COUNT = 200; // write top N to the file; the UI can show a subset + paginate
const VALIDATOR_REFRESH_MS = 60 * 60_000;
const MAX_EVENTS = 5000;
const MAX_CONSECUTIVE_FAILURES = 5; // exit (systemd restarts) after this many failures in a row

const MSG_TYPES = [
  { url: "/cosmos.staking.v1beta1.MsgDelegate", eventName: "delegate", type: "delegate" },
  { url: "/cosmos.staking.v1beta1.MsgUndelegate", eventName: "unbond", type: "undelegate" },
  { url: "/cosmos.staking.v1beta1.MsgBeginRedelegate", eventName: "redelegate", type: "redelegate" },
];

// ═══ STATE ═══
let events = [];
let validatorMonikers = {};
let txHashSet = new Set();
let blockTimestampCache = new Map();
let lastValidatorRefresh = 0;
let hasNewEvents = false;
let lastPushTime = 0;
let lastSuccessfulPush = 0;
let lastPendingRefresh = 0;
let lastTopDelegatorsRefresh = 0;
let consecutivePushFailures = 0;
let consecutivePollFailures = 0;

// ═══ LOGGING ═══
const levels = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = levels[LOG_LEVEL] ?? 1;
function log(level, ...args) {
  if (levels[level] < currentLevel) return;
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${level.toUpperCase()}]`, ...args);
}

// ═══ HELPERS ═══
function toDisplay(amount) {
  return Number(amount) / Math.pow(10, DECIMALS);
}

// execSync returns an Error with .stderr/.stdout buffers. The default
// Error.message only includes the command line, so "git push failed: Command
// failed: ..." is useless for debugging. Pull the actual stderr too.
function formatExecError(e) {
  const parts = [e.message];
  const stderr = e.stderr?.toString().trim();
  const stdout = e.stdout?.toString().trim();
  if (stderr) parts.push(`stderr: ${stderr}`);
  if (stdout) parts.push(`stdout: ${stdout}`);
  return parts.join("\n");
}

function bailIfTooManyFailures(kind, count) {
  if (count < MAX_CONSECUTIVE_FAILURES) return;
  log(
    "error",
    `[CIRCUIT BREAKER] ${count} consecutive ${kind} failures. Exiting so systemd restarts ` +
      `with a fresh process state (and any pulled code changes).`,
  );
  process.exit(2);
}

async function fetchWithRetry(url, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, i)));
      }
    }
  }
  throw lastErr;
}

// ═══ DATA PERSISTENCE ═══
function loadExistingData() {
  if (!existsSync(DATA_FILE)) {
    log("info", `No existing data file at ${DATA_FILE}, starting fresh`);
    return;
  }
  try {
    const raw = readFileSync(DATA_FILE, "utf-8");
    const data = JSON.parse(raw);
    events = data.events || [];
    validatorMonikers = data.validators || {};
    txHashSet = new Set(events.map((e) => e.txHash));
    log("info", `Loaded ${events.length} events, ${Object.keys(validatorMonikers).length} validators`);
  } catch (e) {
    log("error", "Failed to load existing data:", e.message);
  }
}

function saveData() {
  const dir = dirname(DATA_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const payload = {
    updatedAt: new Date().toISOString(),
    validators: validatorMonikers,
    events: events.slice(0, MAX_EVENTS),
  };
  writeFileSync(DATA_FILE, JSON.stringify(payload, null, null));
  log("debug", `Saved ${events.length} events to ${DATA_FILE}`);
}

// ═══ VALIDATOR CACHE ═══
async function refreshValidators() {
  try {
    let allValidators = [];
    let nextKey = "";
    while (true) {
      const url = nextKey
        ? `${LCD}/cosmos/staking/v1beta1/validators?pagination.limit=200&pagination.key=${encodeURIComponent(nextKey)}`
        : `${LCD}/cosmos/staking/v1beta1/validators?pagination.limit=200`;
      const data = await fetchWithRetry(url);
      allValidators.push(...data.validators);
      nextKey = data.pagination?.next_key || "";
      if (!nextKey) break;
    }

    const map = {};
    for (const v of allValidators) {
      map[v.operator_address] = v.description?.moniker || v.operator_address;
    }
    validatorMonikers = map;
    lastValidatorRefresh = Date.now();
    log("info", `Refreshed ${allValidators.length} validators`);
  } catch (e) {
    log("warn", "Failed to refresh validators:", e.message);
  }
}

// ═══ BLOCK TIMESTAMPS ═══
async function getBlockTime(height) {
  if (blockTimestampCache.has(height)) {
    return blockTimestampCache.get(height);
  }
  try {
    const data = await fetchWithRetry(`${RPC}/block?height=${height}`);
    const time = data?.result?.block?.header?.time;
    if (time) {
      blockTimestampCache.set(height, time);
      // Limit cache size
      if (blockTimestampCache.size > 500) {
        const firstKey = blockTimestampCache.keys().next().value;
        blockTimestampCache.delete(firstKey);
      }
      return time;
    }
  } catch (e) {
    log("warn", `Failed to fetch block ${height}:`, e.message);
  }
  return null;
}

// ═══ EVENT PARSING ═══
function parseAmount(amountStr) {
  // "670000000ucore" → 670
  const match = /^(\d+)ucore$/.exec(amountStr);
  if (!match) return 0;
  return toDisplay(match[1]);
}

function extractAttribute(event, key) {
  const attr = event.attributes?.find((a) => a.key === key);
  return attr?.value || null;
}

// Cosmos SDK's `redelegate` event does NOT emit a `delegator` attribute —
// only source_validator, destination_validator, amount, and completion_time.
// The signer (true delegator) lives on the `message` event's `sender`
// attribute for the same tx. Extract it once so we can fall back to it for
// redelegates (and defensively for any delegate/undelegate event that may
// also omit the delegator field on certain SDK versions).
function extractTxSigner(events) {
  for (const ev of events) {
    if (ev.type !== "message") continue;
    for (const a of ev.attributes || []) {
      if (a.key === "sender" && typeof a.value === "string" && a.value.startsWith("core1")) {
        return a.value;
      }
    }
  }
  return null;
}

function parseTx(tx, msgType) {
  const hash = tx.hash;
  const height = parseInt(tx.height);
  const events = tx.tx_result?.events || [];
  const txSigner = extractTxSigner(events);

  const results = [];
  for (const event of events) {
    if (event.type !== msgType.eventName) continue;

    const amountStr = extractAttribute(event, "amount");
    const amount = parseAmount(amountStr || "");
    if (amount < MIN_AMOUNT_TX) continue;

    // Prefer the delegator attribute if present, fall back to the tx signer.
    // Redelegate events never emit a delegator attribute, so txSigner is the
    // only way to identify who initiated the redelegation.
    const delegator = extractAttribute(event, "delegator") || txSigner;

    let validator = extractAttribute(event, "validator");
    let sourceValidator = null;
    let destinationValidator = null;

    if (msgType.type === "redelegate") {
      sourceValidator = extractAttribute(event, "source_validator");
      destinationValidator = extractAttribute(event, "destination_validator");
      validator = destinationValidator;
    }

    if (!delegator || !validator) continue;

    results.push({
      type: msgType.type,
      height,
      delegator,
      validator,
      ...(sourceValidator && { sourceValidator }),
      ...(destinationValidator && { destinationValidator }),
      amount,
      txHash: hash,
    });
  }
  return results;
}

// ═══ PENDING UNDELEGATIONS ═══
// Fetches every validator's unbonding_delegations, filters to entries whose
// completion_time is still in the future, and aggregates the balance by
// completion day. Writes public/analytics/pending-undelegations.json with
// the schema { updatedAt: ISO, entries: [{date, value}] }.
//
// updatedAt lets the external freshness monitor treat this file the same
// way it treats staking-events.json. The entries array is what the dashboard
// renders — same {date, value} shape as before.

async function fetchAllValidatorAddresses() {
  const addresses = [];
  let nextKey = "";
  while (true) {
    const url = nextKey
      ? `${LCD}/cosmos/staking/v1beta1/validators?pagination.limit=200&pagination.key=${encodeURIComponent(nextKey)}`
      : `${LCD}/cosmos/staking/v1beta1/validators?pagination.limit=200`;
    const data = await fetchWithRetry(url, 3);
    addresses.push(...data.validators.map((v) => v.operator_address));
    nextKey = data.pagination?.next_key || "";
    if (!nextKey) break;
  }
  return addresses;
}

async function fetchPendingUndelegations() {
  const validators = await fetchAllValidatorAddresses();
  const nowMs = Date.now();
  const dailyAmounts = {};

  // Per-validator errors are caught and swallowed so one unreachable
  // validator doesn't break the whole aggregate. A failed validator is
  // rare and would just under-count its own unbonding entries for this
  // cycle — the next cycle retries.
  for (const valAddr of validators) {
    try {
      const data = await fetchWithRetry(
        `${LCD}/cosmos/staking/v1beta1/validators/${valAddr}/unbonding_delegations?pagination.limit=1000`,
        2,
      );
      for (const resp of data.unbonding_responses || []) {
        for (const entry of resp.entries || []) {
          const completionMs = new Date(entry.completion_time).getTime();
          if (completionMs <= nowMs) continue; // already released on-chain
          const dateKey = entry.completion_time.slice(0, 10);
          const amount = parseInt(entry.balance) / Math.pow(10, DECIMALS);
          dailyAmounts[dateKey] = (dailyAmounts[dateKey] || 0) + amount;
        }
      }
    } catch {
      // swallow per-validator errors
    }
  }

  const entries = Object.entries(dailyAmounts)
    .map(([d, amount]) => ({ date: d, value: Math.round(amount) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { entries, validatorCount: validators.length };
}

function savePending(entries) {
  const dir = dirname(PENDING_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const payload = {
    updatedAt: new Date().toISOString(),
    entries,
  };
  writeFileSync(PENDING_FILE, JSON.stringify(payload, null, null));
  log("debug", `Saved ${entries.length} pending-undelegations entries`);
}

async function refreshPendingUndelegations() {
  try {
    const { entries, validatorCount } = await fetchPendingUndelegations();
    savePending(entries);
    lastPendingRefresh = Date.now();
    log("info", `Pending undelegations refreshed: ${entries.length} days from ${validatorCount} validators`);
  } catch (e) {
    // This runs on its own interval — a failure just leaves the file at
    // its last good state. The next tick retries. We log but don't bail.
    log("error", `refreshPendingUndelegations failed: ${e.message}`);
  }
}

// ═══ TOP DELEGATORS + KNOWN ENTITIES ═══
// Ranks every bonded account by total stake across all validators and writes
// public/analytics/top-delegators.json. Also writes known-entities.json — a
// label registry that maps addresses to human-friendly names (validator
// self-stakes, PSE-excluded addresses, and a _manual slot for community
// contributions).
//
// Cadence: 6 h (TOP_DELEGATORS_REFRESH_MS). Stake rankings move slowly so
// this is generous — the LCD cost is ~100 validators × a few pages of
// delegations each, a couple of minutes per refresh, 4×/day.

// Convert a validator operator address (corevaloper1...) to its account
// address (core1...). Both share the same underlying bytes, only the HRP
// differs. This is how we identify which delegation is a validator's own
// self-bond versus an arbitrary delegator.
function valoperToAccount(valoperAddr) {
  try {
    const { prefix, words } = bech32.decode(valoperAddr);
    if (!prefix.endsWith("valoper")) return null;
    const accountPrefix = prefix.slice(0, -"valoper".length);
    return bech32.encode(accountPrefix, words);
  } catch {
    return null;
  }
}

// Fetch the PSE module's params to learn which addresses are excluded from
// community PSE rewards. Labelling these on the top-delegators list is
// useful context (they're often protocol-owned addresses or team holdings).
async function fetchPSEExcludedAddresses() {
  const endpoints = [
    "https://api.silknodes.io/coreum/tx/pse/v1/params",
    "https://full-node.mainnet-1.coreum.dev:1317/tx/pse/v1/params",
  ];
  for (const base of endpoints) {
    try {
      const data = await fetchWithRetry(base, 2);
      const list = data?.params?.excluded_addresses;
      if (Array.isArray(list) && list.length > 0) return list;
    } catch {
      // try next
    }
  }
  return [];
}

// Iterate every validator's delegations and aggregate bonded stake by
// delegator address. Returns a Map(address -> { totalUcore, validators: Set }).
async function aggregateAllDelegations(validatorAddresses) {
  const byDelegator = new Map();
  for (const valAddr of validatorAddresses) {
    let nextKey = "";
    // Paginate defensively — top validators can have 500+ delegators.
    // We cap iterations to avoid a runaway loop if the LCD misbehaves.
    for (let page = 0; page < 50; page++) {
      const base = `${LCD}/cosmos/staking/v1beta1/validators/${valAddr}/delegations?pagination.limit=500`;
      const url = nextKey ? `${base}&pagination.key=${encodeURIComponent(nextKey)}` : base;
      let data;
      try {
        data = await fetchWithRetry(url, 2);
      } catch {
        break; // give up on this validator, move on
      }
      for (const resp of data.delegation_responses || []) {
        const addr = resp.delegation?.delegator_address;
        const amount = parseInt(resp.balance?.amount || "0");
        if (!addr || !amount) continue;
        const entry = byDelegator.get(addr) || { totalUcore: 0, validators: new Set() };
        entry.totalUcore += amount;
        entry.validators.add(valAddr);
        byDelegator.set(addr, entry);
      }
      nextKey = data.pagination?.next_key || "";
      if (!nextKey) break;
    }
  }
  return byDelegator;
}

// Build known-entities.json from on-chain facts we know. Each validator's
// self-stake account (derived via bech32) gets labelled "<Moniker> (self)".
// PSE-excluded addresses get labelled "PSE Excluded". The _manual section is
// preserved from any existing file so manual labels (CEX addresses, team
// wallets, etc.) aren't overwritten.
function buildKnownEntities(existing, validators, pseExcluded) {
  const entries = {};

  // 1. Validator self-stakes
  for (const v of validators) {
    const accountAddr = valoperToAccount(v.operator_address);
    if (!accountAddr) continue;
    const moniker = v.description?.moniker || "Validator";
    entries[accountAddr] = {
      label: `${moniker} (self)`,
      type: "validator",
      verified: true,
      source: "derived from validator operator_address",
    };
  }

  // 2. PSE-excluded addresses
  for (const addr of pseExcluded) {
    if (typeof addr !== "string" || !addr.startsWith("core1")) continue;
    // Don't overwrite a validator-self label with PSE-excluded — a validator
    // could be both. Concatenate the types in the label if so.
    if (entries[addr]) {
      entries[addr].label += " · PSE Excluded";
      entries[addr].type = "validator+pse";
    } else {
      entries[addr] = {
        label: "PSE Excluded",
        type: "pse-excluded",
        verified: true,
        source: "on-chain /tx/pse/v1/params",
      };
    }
  }

  // 3. Preserve manual contributions from existing file
  const manual = existing?._manual && typeof existing._manual === "object" ? existing._manual : {};

  return {
    updatedAt: new Date().toISOString(),
    // Manual labels take precedence — they're explicit human decisions.
    entries: { ...entries, ...manual },
    _manual: manual, // keep a separate slot so the user knows which entries are hand-curated
  };
}

function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function saveTopDelegators(entries) {
  const dir = dirname(TOP_DELEGATORS_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(
    TOP_DELEGATORS_FILE,
    JSON.stringify({ updatedAt: new Date().toISOString(), entries }, null, null),
  );
}

function saveKnownEntities(payload) {
  const dir = dirname(KNOWN_ENTITIES_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(KNOWN_ENTITIES_FILE, JSON.stringify(payload, null, null));
}

async function refreshTopDelegators() {
  try {
    log("info", "Refreshing top delegators (may take 1-2 min)...");

    // Fetch validator list with full info so we get monikers for known-entities.
    const validators = [];
    let nextKey = "";
    while (true) {
      const url = nextKey
        ? `${LCD}/cosmos/staking/v1beta1/validators?pagination.limit=200&pagination.key=${encodeURIComponent(nextKey)}`
        : `${LCD}/cosmos/staking/v1beta1/validators?pagination.limit=200`;
      const d = await fetchWithRetry(url, 3);
      validators.push(...d.validators);
      nextKey = d.pagination?.next_key || "";
      if (!nextKey) break;
    }

    const pseExcluded = await fetchPSEExcludedAddresses();
    const existingEntities = readJsonFile(KNOWN_ENTITIES_FILE);
    const knownEntities = buildKnownEntities(existingEntities, validators, pseExcluded);
    saveKnownEntities(knownEntities);

    const validatorAddrs = validators.map((v) => v.operator_address);
    const byDelegator = await aggregateAllDelegations(validatorAddrs);

    const ranked = [...byDelegator.entries()]
      .map(([address, v]) => ({
        address,
        totalUcore: v.totalUcore,
        validatorCount: v.validators.size,
      }))
      .sort((a, b) => b.totalUcore - a.totalUcore)
      .slice(0, TOP_DELEGATORS_COUNT);

    const entries = ranked.map((r, i) => {
      const label = knownEntities.entries[r.address] || null;
      return {
        rank: i + 1,
        address: r.address,
        totalStake: Math.floor(r.totalUcore / 1_000_000), // TX units
        validatorCount: r.validatorCount,
        label: label
          ? { text: label.label, type: label.type, verified: !!label.verified }
          : null,
      };
    });

    saveTopDelegators(entries);
    lastTopDelegatorsRefresh = Date.now();
    log(
      "info",
      `Top delegators refreshed: ${entries.length} ranked, ${Object.keys(knownEntities.entries).length} labels (${validators.length} validators, ${pseExcluded.length} PSE excluded)`,
    );
  } catch (e) {
    // Non-fatal. The file stays at its last good state until the next tick.
    log("error", `refreshTopDelegators failed: ${e.message}`);
  }
}

// ═══ POLLING ═══
async function pollMessageType(msgType) {
  const q = encodeURIComponent(`"message.action='${msgType.url}'"`);
  const url = `${RPC}/tx_search?query=${q}&per_page=100&order_by="desc"`;

  let data;
  try {
    data = await fetchWithRetry(url);
  } catch (e) {
    log("warn", `tx_search failed for ${msgType.type}:`, e.message);
    return 0;
  }

  const txs = data?.result?.txs || [];
  let newCount = 0;

  for (const tx of txs) {
    if (txHashSet.has(tx.hash)) continue;

    const parsed = parseTx(tx, msgType);
    if (parsed.length === 0) {
      // Still add hash to dedupe set even if no events matched, to avoid reprocessing
      txHashSet.add(tx.hash);
      continue;
    }

    const timestamp = await getBlockTime(parseInt(tx.height));
    if (!timestamp) continue;

    for (const event of parsed) {
      events.unshift({ ...event, timestamp });
      txHashSet.add(event.txHash);
      newCount++;
    }
  }

  if (newCount > 0) {
    log("info", `  ${msgType.type}: +${newCount} events`);
  }
  return newCount;
}

function pruneOldEvents() {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const before = events.length;
  events = events.filter((e) => new Date(e.timestamp).getTime() >= cutoff);
  if (before !== events.length) {
    // Rebuild hash set
    txHashSet = new Set(events.map((e) => e.txHash));
    log("info", `Pruned ${before - events.length} events older than ${RETENTION_DAYS} days`);
  }
}

async function poll() {
  log("debug", "Polling for new events...");

  // Refresh validators if stale
  if (Date.now() - lastValidatorRefresh > VALIDATOR_REFRESH_MS) {
    await refreshValidators();
  }

  let totalNew = 0;
  for (const msgType of MSG_TYPES) {
    totalNew += await pollMessageType(msgType);
  }

  if (totalNew > 0) {
    // Sort by timestamp descending (newest first)
    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    pruneOldEvents();
    saveData();
    hasNewEvents = true;
    log("info", `Total: +${totalNew} new events (${events.length} in window)`);
  } else {
    log("debug", "No new events");
  }
}

// ═══ GIT PUSH ═══
// Always rewrite the file before pushing so updatedAt reflects "now". This is
// important for the heartbeat path: even with no new events, we want the
// committed JSON to advertise a fresh updatedAt so the client and external
// monitors can tell the collector is alive.
function gitCommitAndPush({ heartbeat = false } = {}) {
  if (!GIT_PUSH_ENABLED) {
    log("debug", "Git push disabled via env");
    return;
  }
  try {
    execSync(`cd ${REPO_PATH} && git pull --rebase --autostash origin main`, { stdio: "pipe" });

    // Refresh updatedAt right before commit so the JSON timestamp always
    // matches the actual push time (within a second).
    saveData();

    // The push cycle is responsible for four files now. Check all of them
    // for changes so a refresh of any one (pending undels every 15 min,
    // top-delegators every 6 h) naturally triggers a push even if no
    // staking events happened in the window.
    const TRACKED = [DATA_FILE_REL, PENDING_FILE_REL, TOP_DELEGATORS_FILE_REL, KNOWN_ENTITIES_FILE_REL].join(" ");
    const hasChanges = execSync(
      `cd ${REPO_PATH} && git diff --name-only ${TRACKED}`,
      { stdio: "pipe", encoding: "utf-8" },
    ).trim();
    if (!hasChanges) {
      log("debug", `No file changes to commit (${heartbeat ? "heartbeat" : "regular"} cycle)`);
      // Still counts as a successful "push attempt" for failure tracking,
      // since the git pipeline itself worked.
      consecutivePushFailures = 0;
      lastSuccessfulPush = Date.now();
      return;
    }
    const ts = new Date().toISOString().slice(0, 16);
    const subject = heartbeat
      ? `chore: heartbeat update staking events ${ts}`
      : `chore: update staking events ${ts}`;
    execSync(`cd ${REPO_PATH} && git add ${TRACKED}`, { stdio: "pipe" });
    execSync(`cd ${REPO_PATH} && git commit -m "${subject}"`, { stdio: "pipe" });
    execSync(`cd ${REPO_PATH} && git push origin main`, { stdio: "pipe" });
    log("info", `Pushed to GitHub${heartbeat ? " (heartbeat)" : ""}: ${ts}`);
    lastPushTime = Date.now();
    lastSuccessfulPush = Date.now();
    hasNewEvents = false;
    consecutivePushFailures = 0;
  } catch (e) {
    consecutivePushFailures++;
    log(
      "error",
      `Git push failed (${consecutivePushFailures}/${MAX_CONSECUTIVE_FAILURES} consecutive):\n${formatExecError(e)}`,
    );
    bailIfTooManyFailures("git push", consecutivePushFailures);
  }
}

// ═══ MAIN ═══
async function main() {
  log("info", "Silk Nodes Staking Events Collector starting");
  log("info", `REPO_PATH: ${REPO_PATH}`);
  log("info", `DATA_FILE: ${DATA_FILE}`);
  log("info", `GIT_PUSH: ${GIT_PUSH_ENABLED}`);

  loadExistingData();
  await refreshValidators();
  await poll();
  // Refresh pending undelegations before the initial push so the first
  // commit carries a fresh file (and the file exists on disk for git add
  // in subsequent pushes even when pending hasn't changed since).
  await refreshPendingUndelegations();
  // Refresh top delegators + known entities on startup too. Takes 1-2 min
  // on first run, then 6 h cadence after. If this fails on startup the
  // files stay at their last good state and the next interval retries.
  await refreshTopDelegators();
  // Always run an initial push so lastSuccessfulPush is set to "now" and the
  // heartbeat clock has a sensible baseline. This also surfaces any git auth
  // problem at startup instead of hours later.
  gitCommitAndPush();

  setInterval(async () => {
    try {
      await poll();
      consecutivePollFailures = 0;
    } catch (e) {
      consecutivePollFailures++;
      log(
        "error",
        `Poll failed (${consecutivePollFailures}/${MAX_CONSECUTIVE_FAILURES} consecutive): ${e.message}`,
      );
      bailIfTooManyFailures("poll", consecutivePollFailures);
    }
  }, POLL_INTERVAL_MS);

  // Pending undelegations refresh. Independent of the push cycle — the
  // push cycle naturally picks up any diff the refresh produces. Failures
  // here are non-fatal: the file keeps its last good state until the next
  // tick succeeds.
  setInterval(() => {
    refreshPendingUndelegations().catch((e) => {
      log("error", `pending refresh interval error: ${e.message}`);
    });
  }, PENDING_REFRESH_MS);

  // Top delegators refresh (6 h). Same non-fatal semantics: failures leave
  // the file at its last good state. Runs off the push cycle so we don't
  // block a push on the slow delegation aggregation.
  setInterval(() => {
    refreshTopDelegators().catch((e) => {
      log("error", `top-delegators refresh interval error: ${e.message}`);
    });
  }, TOP_DELEGATORS_REFRESH_MS);

  setInterval(() => {
    const sinceLastPush = Date.now() - lastPushTime;
    const heartbeatDue = Date.now() - lastSuccessfulPush >= HEARTBEAT_INTERVAL_MS;

    if (hasNewEvents && sinceLastPush >= PUSH_INTERVAL_MS) {
      gitCommitAndPush({ heartbeat: false });
    } else if (heartbeatDue) {
      // Force a refresh of the JSON's updatedAt so the client and external
      // monitors can distinguish "alive but quiet" from "dead". The git diff
      // check inside gitCommitAndPush will short-circuit harmlessly if the
      // file content hasn't changed.
      gitCommitAndPush({ heartbeat: true });
    }
  }, PUSH_INTERVAL_MS);

  log(
    "info",
    `Collector running. Poll: ${POLL_INTERVAL_MS / 1000}s, push: ${PUSH_INTERVAL_MS / 60_000}min, ` +
      `heartbeat: ${HEARTBEAT_INTERVAL_MS / 60_000}min, pending refresh: ${PENDING_REFRESH_MS / 60_000}min, ` +
      `top-delegators refresh: ${TOP_DELEGATORS_REFRESH_MS / 3_600_000}h, ` +
      `circuit breaker: ${MAX_CONSECUTIVE_FAILURES} failures.`,
  );
}

main().catch((e) => {
  log("error", "Fatal error:", e);
  process.exit(1);
});
