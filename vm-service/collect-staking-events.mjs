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

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_PATH = process.env.REPO_PATH || resolve(__dirname, "..");
const DATA_FILE = join(REPO_PATH, "public", "analytics", "staking-events.json");
const DATA_FILE_REL = "public/analytics/staking-events.json";
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

function parseTx(tx, msgType) {
  const hash = tx.hash;
  const height = parseInt(tx.height);
  const events = tx.tx_result?.events || [];

  const results = [];
  for (const event of events) {
    if (event.type !== msgType.eventName) continue;

    const amountStr = extractAttribute(event, "amount");
    const amount = parseAmount(amountStr || "");
    if (amount < MIN_AMOUNT_TX) continue;

    const delegator = extractAttribute(event, "delegator");

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

    const hasChanges = execSync(`cd ${REPO_PATH} && git diff --name-only ${DATA_FILE_REL}`, {
      stdio: "pipe",
      encoding: "utf-8",
    }).trim();
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
    execSync(`cd ${REPO_PATH} && git add ${DATA_FILE_REL}`, { stdio: "pipe" });
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
      `heartbeat: ${HEARTBEAT_INTERVAL_MS / 60_000}min, circuit breaker: ${MAX_CONSECUTIVE_FAILURES} failures.`,
  );
}

main().catch((e) => {
  log("error", "Fatal error:", e);
  process.exit(1);
});
