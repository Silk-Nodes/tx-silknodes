#!/usr/bin/env node

/**
 * External liveness check for the staking feed.
 *
 * Reads `public/analytics/staking-events.json` (the file the VM collector
 * commits) and fails if the `updatedAt` timestamp is older than the
 * threshold. Run by .github/workflows/staking-feed-health.yml on a cron;
 * a failed run sends GitHub notification emails to the repo's watchers.
 *
 * Threshold rationale: the collector pushes a heartbeat every 30 min even
 * when there are no new events (see HEARTBEAT_INTERVAL_MS in
 * vm-service/collect-staking-events.mjs). 75 min absorbs:
 *   - 30 min heartbeat interval
 *   - up to ~10 min for the next collector cycle to run after the previous
 *     heartbeat boundary
 *   - GitHub Pages rebuild lag (~1-2 min)
 *   - clock skew between the VM and GitHub runners
 *
 * Stays well under "obviously broken" (~hours) so the alert is actionable.
 */

import { readFileSync } from "fs";

const DATA_FILE = "public/analytics/staking-events.json";
const MAX_AGE_MINUTES = 75;

let data;
try {
  data = JSON.parse(readFileSync(DATA_FILE, "utf-8"));
} catch (e) {
  console.error(`❌ Failed to read or parse ${DATA_FILE}: ${e.message}`);
  process.exit(1);
}

const updatedAt = data.updatedAt ? new Date(data.updatedAt).getTime() : 0;
if (!updatedAt) {
  console.error(`❌ ${DATA_FILE} has no usable updatedAt field`);
  process.exit(1);
}

const ageMinutes = (Date.now() - updatedAt) / 60_000;
const eventCount = data.events?.length ?? 0;

console.log(`Data file: ${DATA_FILE}`);
console.log(`updatedAt: ${data.updatedAt}`);
console.log(`age:       ${ageMinutes.toFixed(1)} minutes`);
console.log(`events:    ${eventCount}`);
console.log(`threshold: ${MAX_AGE_MINUTES} minutes`);

if (ageMinutes > MAX_AGE_MINUTES) {
  console.error("");
  console.error(`❌ Staking feed is stale (${ageMinutes.toFixed(1)} min > ${MAX_AGE_MINUTES} min).`);
  console.error("");
  console.error("Likely causes:");
  console.error("  1. VM collector is down or wedged");
  console.error("  2. Git push from VM is failing (auth, network, conflicts)");
  console.error("  3. GitHub Pages deploy workflow is broken");
  console.error("");
  console.error("Diagnose on the VM:");
  console.error("  sudo systemctl status silknodes-collector");
  console.error("  sudo journalctl -u silknodes-collector -n 100");
  process.exit(1);
}

console.log("");
console.log("✅ Feed is fresh.");
