#!/usr/bin/env node

/**
 * External liveness check for every analytics file the VM owns.
 *
 * Runs in GitHub Actions on a schedule (see .github/workflows/staking-feed-health.yml).
 * If any file's committed data is older than its threshold, the workflow exits
 * non-zero and GitHub sends a notification email to the repo's watchers.
 *
 * Two freshness modes:
 *   - updatedAt mode: the file has a top-level `updatedAt` ISO timestamp
 *     (staking-events.json). Age = now - parsed(updatedAt).
 *   - lastDate mode: the file is an array of { date, value } entries written
 *     daily. Age = now - endOfDay(lastEntry.date), because the entry
 *     represents the full UTC day (e.g. `"2026-04-15"` is valid until
 *     2026-04-16T00:00:00Z).
 *
 * Thresholds are intentionally generous so transient GitHub Pages rebuild lag
 * and clock skew don't produce false positives. A failed run means the data
 * is meaningfully behind — worth an email.
 *
 * Run locally any time:
 *   node scripts/check-feed-freshness.mjs
 */

import { readFileSync } from "fs";

/**
 * @typedef {object} Check
 * @property {string} file  repo-relative path
 * @property {string} label short human label for logs
 * @property {number} thresholdMinutes  max tolerated age
 * @property {"updatedAt" | "lastDate"} mode
 */

const MIN = 1;
const HOUR = 60 * MIN;

/** @type {Check[]} */
const CHECKS = [
  // Staking events: pushed every 5 min when active, every 30 min as heartbeat.
  // 75 min absorbs heartbeat + Pages rebuild + clock skew.
  {
    file: "public/analytics/staking-events.json",
    label: "Staking Events",
    thresholdMinutes: 75 * MIN,
    mode: "updatedAt",
  },

  // Daily metrics: pushed once per day by silknodes-daily-analytics timer at
  // 02:00 UTC. Between runs, age drifts up to ~26h; threshold 36h gives us
  // a ~10h grace window after a missed run before alerting.
  { file: "public/analytics/transactions.json", label: "Transactions", thresholdMinutes: 36 * HOUR, mode: "lastDate" },
  { file: "public/analytics/active-addresses.json", label: "Active Addresses", thresholdMinutes: 36 * HOUR, mode: "lastDate" },
  { file: "public/analytics/total-stake.json", label: "Total Stake", thresholdMinutes: 36 * HOUR, mode: "lastDate" },
  { file: "public/analytics/staking-apr.json", label: "Staking APR", thresholdMinutes: 36 * HOUR, mode: "lastDate" },
  { file: "public/analytics/staked-pct.json", label: "Staked %", thresholdMinutes: 36 * HOUR, mode: "lastDate" },
  { file: "public/analytics/total-supply.json", label: "Total Supply", thresholdMinutes: 36 * HOUR, mode: "lastDate" },
  { file: "public/analytics/circulating-supply.json", label: "Circulating Supply", thresholdMinutes: 36 * HOUR, mode: "lastDate" },
  { file: "public/analytics/price-usd.json", label: "Price USD", thresholdMinutes: 36 * HOUR, mode: "lastDate" },

  // Note: pending-undelegations.json is intentionally not checked here. It is
  // a forward-looking file (unbonding entries with future completion_time) and
  // has no natural "updatedAt" primitive. Since all daily files are written in
  // one atomic commit, any one of them being fresh proves pending-undelegations
  // was refreshed too.
];

function check(c) {
  let data;
  try {
    data = JSON.parse(readFileSync(c.file, "utf-8"));
  } catch (e) {
    return { ok: false, reason: `cannot read/parse: ${e.message}`, ageMinutes: null };
  }

  let timestampMs;
  if (c.mode === "updatedAt") {
    if (!data.updatedAt) return { ok: false, reason: "missing updatedAt field", ageMinutes: null };
    timestampMs = new Date(data.updatedAt).getTime();
    if (!Number.isFinite(timestampMs)) {
      return { ok: false, reason: `invalid updatedAt: ${data.updatedAt}`, ageMinutes: null };
    }
  } else {
    if (!Array.isArray(data) || data.length === 0) {
      return { ok: false, reason: "file is empty or not an array", ageMinutes: null };
    }
    const last = data[data.length - 1];
    if (!last || !last.date) return { ok: false, reason: "last entry missing date field", ageMinutes: null };
    // End of the UTC day that `date` represents.
    timestampMs = new Date(`${last.date}T00:00:00Z`).getTime() + 24 * HOUR * 60_000;
    if (!Number.isFinite(timestampMs)) {
      return { ok: false, reason: `invalid date string: ${last.date}`, ageMinutes: null };
    }
  }

  const ageMinutes = (Date.now() - timestampMs) / 60_000;
  if (ageMinutes > c.thresholdMinutes) {
    return {
      ok: false,
      reason: `stale: age ${formatDuration(ageMinutes)} exceeds threshold ${formatDuration(c.thresholdMinutes)}`,
      ageMinutes,
    };
  }
  return { ok: true, ageMinutes, reason: null };
}

function formatDuration(minutes) {
  // Negative age = the entry's date is today UTC (snapshot metrics like
  // total-stake write `date: today`, and endOfDay(today) is still in the
  // future). Treat this as "fresh".
  if (minutes < 0) return "fresh today";
  if (minutes < 120) return `${minutes.toFixed(1)}min`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

console.log(`Analytics Data Health Check — ${new Date().toISOString()}`);
console.log("=".repeat(90));

let failures = 0;
for (const c of CHECKS) {
  const r = check(c);
  const ageStr = r.ageMinutes !== null ? formatDuration(r.ageMinutes) : "n/a";
  const statusIcon = r.ok ? "✅" : "❌";
  const line = `${statusIcon} ${c.label.padEnd(22)}  ${c.file.padEnd(46)}  age ${ageStr.padStart(10)}`;
  if (r.ok) {
    console.log(line);
  } else {
    console.error(`${line}  ← ${r.reason}`);
    failures++;
  }
}

console.log("=".repeat(90));

if (failures > 0) {
  console.error(`\n${failures} of ${CHECKS.length} checks FAILED.`);
  console.error("");
  console.error("Likely causes:");
  console.error("  - If every file is stale: VM offline or git push broken");
  console.error("  - If only staking-events stale: silknodes-collector.service wedged");
  console.error("  - If only daily files stale: silknodes-daily-analytics.timer not firing");
  console.error("");
  console.error("Diagnose on the VM:");
  console.error("  sudo systemctl status silknodes-collector");
  console.error("  sudo systemctl list-timers | grep silknodes");
  console.error("  sudo journalctl -u silknodes-collector -n 50 --no-pager");
  console.error("  sudo journalctl -u silknodes-daily-analytics -n 200 --no-pager");
  process.exit(1);
}

console.log("\nAll checks passed.");
