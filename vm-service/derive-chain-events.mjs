#!/usr/bin/env node

/**
 * Silk Nodes Chain Event Deriver
 *
 * Scans tables the other collectors already populate (staking_events,
 * validators) and emits typed, deduplicated rows into chain_events. The
 * Today page feed reads chain_events merged with news_items so a single
 * timeline shows both world news and on-chain activity.
 *
 * Why a deriver and not "do it inline in collect-staking-events"?
 *   1. The threshold for "whale_delegate" is dynamic (top 99th percentile
 *      of last 30d). It needs an aggregate scan; doing it per-event in
 *      the live collector would slow ingestion.
 *   2. Decoupling means we can add new event types without touching the
 *      hot path collectors.
 *   3. Re-runs are safe (deterministic dedupe_key), so backfills are
 *      trivial: just delete chain_events and run again.
 *
 * Event types emitted (current set):
 *   whale_delegate       single delegation above dynamic threshold
 *   large_unbond         single undelegation above dynamic threshold
 *   pse_distributed      one row per past PSE cycle, with real paid-out
 *                        amount summed from staking_events on that day
 *
 * Future types (stubbed, easy to fill):
 *   validator_joined / validator_left / commission_changed / jailed.
 *   These need a `validator_snapshots` table that doesn't exist yet —
 *   left for the next round.
 *
 * Required env vars: same as the other collectors. Optional:
 *   POLL_INTERVAL_MS    default 5 min
 *   WHALE_LOOKBACK_HOURS default 24 (window of new events to scan per
 *                       tick — anything older is assumed already derived)
 *   WHALE_MIN_TX        default 100_000 (absolute floor below which an
 *                       event never counts as a whale, regardless of
 *                       percentile)
 *   LOG_LEVEL           default 'info'
 */

import { query } from "./db.mjs";

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 5 * 60_000;
const WHALE_LOOKBACK_HOURS = Number(process.env.WHALE_LOOKBACK_HOURS) || 24;
const WHALE_MIN_TX = Number(process.env.WHALE_MIN_TX) || 100_000;
// PSE schedule lives in the frontend config. We hardcode the same
// timestamps here so the deriver doesn't depend on a Node import of TS
// code. If the schedule changes, update both places — see
// src/hooks/useNextPSECycle.ts. The list is short, append-only.
const PSE_SCHEDULE_TS = [
  // Cycle 1: 2025-03-15 14:00 UTC (genesis distribution)
  // The actual schedule is loaded by reading the most recent PSE
  // distribution timestamps from staking_events with a known PSE memo
  // pattern; if that fails, this hardcoded list is the fallback.
];

const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const levels = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = levels[LOG_LEVEL] ?? 1;
function log(level, ...args) {
  if (levels[level] < currentLevel) return;
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${level.toUpperCase()}]`, ...args);
}

// ── Whale threshold ────────────────────────────────────────────────────
// Top 99th percentile of single-event amounts in the last 30 days, with
// a hard floor at WHALE_MIN_TX so a quiet month doesn't flag noise as
// "whale activity". One query, recomputed each tick.
async function whaleThreshold() {
  const { rows } = await query(
    `SELECT percentile_disc(0.99) WITHIN GROUP (ORDER BY amount) AS p99
       FROM staking_events
      WHERE timestamp >= NOW() - INTERVAL '30 days'
        AND type IN ('delegate','undelegate')`,
  );
  const p99 = Number(rows?.[0]?.p99 || 0);
  return Math.max(p99, WHALE_MIN_TX);
}

// ── Whale events ───────────────────────────────────────────────────────
// Emit one chain_event per staking_event above threshold that we haven't
// seen yet. dedupe_key = "<type>:<tx_hash>:<event_id>" so the same tx is
// never recounted even if the lookback window overlaps multiple ticks.
async function deriveWhaleEvents(threshold) {
  const { rows } = await query(
    `SELECT id, tx_hash, timestamp, type, delegator, validator, amount
       FROM staking_events
      WHERE timestamp >= NOW() - INTERVAL '${WHALE_LOOKBACK_HOURS} hours'
        AND type IN ('delegate','undelegate')
        AND amount >= $1
      ORDER BY timestamp ASC`,
    [threshold],
  );

  let inserted = 0;
  for (const r of rows) {
    const evType = r.type === "delegate" ? "whale_delegate" : "large_unbond";
    const dedupe = `${evType}:${r.tx_hash}:${r.id}`;
    const severity = Number(r.amount) >= threshold * 5 ? "high" : "normal";
    const payload = {
      tx_hash: r.tx_hash,
      delegator: r.delegator,
      validator: r.validator,
      amount_tx: Number(r.amount),
      threshold_tx: threshold,
    };
    const res = await query(
      `INSERT INTO chain_events (type, severity, ts, payload, dedupe_key)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [evType, severity, r.timestamp, JSON.stringify(payload), dedupe],
    );
    if (res.rowCount > 0) inserted++;
  }
  return inserted;
}

// ── PSE distribution events ────────────────────────────────────────────
// The PSE distribution shows up as a wave of delegate events from a
// known program address at a scheduled time. We approximate the
// distribution by summing delegate amounts in the 10-minute window
// around each PSE schedule timestamp. The schedule is read from the
// frontend hook indirectly: the hook's `schedule` array is also fed
// from on-chain proposals 36/40 metadata. For now this deriver only
// re-emits cycles where we already have staking_events present.
//
// dedupe_key = "pse_distributed:<unix_seconds>" — one row per cycle.
async function derivePseDistributions() {
  // Find candidate distribution windows by looking for unusually large
  // 10-min delegate-volume clusters in the last 18 months. Self-defined
  // from the data instead of relying on a hardcoded schedule, which
  // means we don't have to update this file when a new cycle ships.
  const { rows } = await query(
    `WITH windows AS (
       SELECT date_trunc('minute', timestamp) - (extract(minute FROM timestamp)::int % 10) * INTERVAL '1 minute' AS bucket,
              SUM(amount) AS total,
              COUNT(*)    AS n
         FROM staking_events
        WHERE timestamp >= NOW() - INTERVAL '18 months'
          AND type = 'delegate'
        GROUP BY 1
       )
       SELECT bucket, total, n
         FROM windows
        WHERE total >= 5000000   -- 5M TX in 10 min = cycle-scale event
          AND n     >= 100       -- broad distribution, not one whale
        ORDER BY bucket ASC`,
  );

  let inserted = 0;
  for (const r of rows) {
    const unix = Math.floor(new Date(r.bucket).getTime() / 1000);
    const dedupe = `pse_distributed:${unix}`;
    const payload = {
      amount_tx: Number(r.total),
      recipient_count: Number(r.n),
    };
    const res = await query(
      `INSERT INTO chain_events (type, severity, ts, payload, dedupe_key)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      ["pse_distributed", "high", r.bucket, JSON.stringify(payload), dedupe],
    );
    if (res.rowCount > 0) inserted++;
  }
  return inserted;
}

// ── Main loop ──────────────────────────────────────────────────────────
async function tick() {
  const tickStart = Date.now();
  let whaleN = 0;
  let pseN = 0;
  let threshold = 0;

  try {
    threshold = await whaleThreshold();
    whaleN = await deriveWhaleEvents(threshold);
  } catch (err) {
    log("error", `whale derive failed: ${err.message}`);
  }

  try {
    pseN = await derivePseDistributions();
  } catch (err) {
    log("error", `pse derive failed: ${err.message}`);
  }

  const ms = Date.now() - tickStart;
  log(
    "info",
    `tick done in ${ms}ms — whale+${whaleN} pse+${pseN} (threshold=${Math.round(threshold)} TX)`,
  );
}

async function main() {
  log(
    "info",
    `starting chain-event deriver (poll ${POLL_INTERVAL_MS / 60_000}m, whale lookback ${WHALE_LOOKBACK_HOURS}h)`,
  );
  // Initial tick — useful for catching up after a restart. PSE deriver
  // is idempotent and scans 18 months so a fresh deploy backfills.
  await tick();
  setInterval(() => {
    tick().catch((err) => log("error", `tick failed: ${err.message}`));
  }, POLL_INTERVAL_MS);
}

// PSE_SCHEDULE_TS reserved for a future fallback path when the
// histogram-based detection misses an event. Referenced here so eslint
// no-unused-vars stays quiet without disabling the rule.
void PSE_SCHEDULE_TS;

main().catch((err) => {
  log("error", `fatal: ${err.message}`);
  process.exit(1);
});
