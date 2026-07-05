#!/usr/bin/env node

/**
 * Production liveness check for the data the VM serves.
 *
 * Runs in GitHub Actions on a schedule (see
 * .github/workflows/staking-feed-health.yml). It hits the LIVE production API
 * and fails (which notifies the repo watchers) if the served data is stale.
 *
 * History: this used to read committed public/analytics/*.json files. After
 * the Phase 2 migration the app serves everything from Postgres via /api/*,
 * and those static files are no longer written, so the file check produced
 * permanent false failures. This version checks the real thing: the live
 * endpoints and their freshness.
 *
 * Checks:
 *   - /api/staking-feed    top-level `updatedAt` (the realtime collector
 *                          pipeline). Must be recent.
 *   - /api/analytics-data  each daily dataset's last `date` (the daily
 *                          analytics pipeline). Must be recent.
 *
 * Override the base with BASE_URL for staging/local runs.
 *
 * Run locally any time:
 *   node scripts/check-feed-freshness.mjs
 */

const BASE_URL = (process.env.BASE_URL || "https://tx.silknodes.io").replace(/\/$/, "");
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

async function getJson(path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "cache-control": "no-cache" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Age of an end-of-day date string ("2026-07-05"): the entry covers the whole
// UTC day, so it's only "stale" once that day has fully passed plus slack.
function ageOfDate(dateStr) {
  const end = new Date(`${dateStr}T00:00:00Z`).getTime() + 24 * HOUR;
  return Date.now() - end;
}

function fmt(ms) {
  if (ms < 0) return "0m";
  const m = ms / MIN;
  if (m < 90) return `${m.toFixed(0)}m`;
  const h = ms / HOUR;
  if (h < 48) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

const results = [];

// 1) Realtime staking feed — proves the collector -> Postgres pipeline is live.
try {
  const feed = await getJson("/api/staking-feed");
  const ts = feed?.updatedAt ? new Date(feed.updatedAt).getTime() : NaN;
  const age = Number.isFinite(ts) ? Date.now() - ts : Infinity;
  const threshold = 90 * MIN;
  results.push({
    label: "Staking feed",
    detail: `${feed?.events?.length ?? 0} events`,
    age,
    ok: age <= threshold,
    reason: `updatedAt ${fmt(age)} old exceeds ${fmt(threshold)}`,
  });
} catch (e) {
  results.push({ label: "Staking feed", detail: "/api/staking-feed", age: Infinity, ok: false, reason: `fetch failed: ${e.message}` });
}

// Datasets that are knowingly stale and should warn (not fail) the run.
// price-usd stopped updating ~2026-04-24 (the daily price series). Tracked
// separately; remove from here once the price collector is fixed or the
// series is dropped from analytics.
const WARN_ONLY = new Set(["price-usd"]);

// 2) Daily analytics datasets — prove the daily analytics pipeline is fresh.
try {
  const data = await getJson("/api/analytics-data");
  const datasets = data?.datasets ?? {};
  const threshold = 36 * HOUR;
  for (const [key, series] of Object.entries(datasets)) {
    const last = Array.isArray(series) && series.length ? series[series.length - 1] : null;
    const date = last?.date;
    const age = date ? ageOfDate(date) : Infinity;
    const fresh = age <= threshold;
    results.push({
      label: key,
      detail: date ? `last ${date}` : "no data",
      age,
      ok: fresh || WARN_ONLY.has(key),
      warn: !fresh && WARN_ONLY.has(key),
      reason: date ? `${fmt(age)} old exceeds ${fmt(threshold)}` : "no dated entries",
    });
  }
} catch (e) {
  results.push({ label: "analytics-data", detail: "/api/analytics-data", age: Infinity, ok: false, reason: `fetch failed: ${e.message}` });
}

console.log(`Analytics Data Health Check — ${new Date().toISOString()}`);
console.log(`Target: ${BASE_URL}`);
console.log("=".repeat(90));

let failures = 0;
for (const r of results) {
  const ageStr = Number.isFinite(r.age) ? fmt(r.age) : "n/a";
  const icon = r.warn ? "⚠️" : r.ok ? "✅" : "❌";
  const line = `${icon} ${r.label.padEnd(20)}  ${String(r.detail).padEnd(24)}  age ${ageStr.padStart(8)}`;
  if (r.warn) console.warn(`${line}  ← ${r.reason} (known-stale, not failing)`);
  else if (r.ok) console.log(line);
  else { console.error(`${line}  ← ${r.reason}`); failures++; }
}

console.log("=".repeat(90));

if (failures > 0) {
  console.error(`\n${failures} of ${results.length} checks FAILED.`);
  console.error("");
  console.error("Likely causes:");
  console.error("  - Staking feed stale: silknodes-collector.service wedged, or the site is down");
  console.error("  - Daily datasets stale: silknodes-daily-analytics.timer not firing");
  console.error("");
  console.error("Diagnose on the VM:");
  console.error("  sudo systemctl status silknodes-collector silknodes-web");
  console.error("  sudo systemctl list-timers | grep silknodes");
  console.error("  sudo journalctl -u silknodes-collector -n 50 --no-pager");
  console.error("  sudo journalctl -u silknodes-daily-analytics -n 200 --no-pager");
  process.exit(1);
}

console.log("\nAll checks passed.");
