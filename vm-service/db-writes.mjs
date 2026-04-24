// Write helpers used by the collectors during the dual-write phase.
// Every function here MIRRORS one writeFileSync site in the collector
// and throws on any error — the caller decides whether to log + continue
// (Phase 1 dual-write) or fail loudly (Phase 2 once JSON is gone).
//
// Idempotency strategy per table:
//   staking_events            INSERT … ON CONFLICT DO NOTHING (UNIQUE
//                             constraint covers tx_hash+type+height+
//                             delegator+validator)
//   validators                UPSERT on operator_address
//   top_delegators            TRUNCATE + bulk INSERT in a transaction so
//                             a partial failure can never leave the table
//                             empty
//   top_delegators_history    INSERT … ON CONFLICT DO NOTHING (PK is
//                             date + address; one snapshot per UTC day)
//   whale_changes             UPSERT singleton row (id = 1)
//   pending_undelegations     TRUNCATE + bulk INSERT in a transaction
//   known_entities            UPSERT per entry on address

import { query, getClient } from "./db.mjs";

// ─── helpers ─────────────────────────────────────────────────────────────

/** Build a parameter-tuple string like "($1,$2,$3),($4,$5,$6)…" for a bulk
 *  INSERT. cols is the number of columns per row, rows is the number of
 *  rows. Used together with a flat values array. */
function tuples(rows, cols) {
  const out = [];
  for (let r = 0; r < rows; r++) {
    const inner = [];
    for (let c = 0; c < cols; c++) inner.push(`$${r * cols + c + 1}`);
    out.push(`(${inner.join(",")})`);
  }
  return out.join(",");
}

// ─── staking_events ──────────────────────────────────────────────────────
//
// Called every time the collector flushes a new batch of events. Most
// cycles add only a handful of new rows (the dedupe set in the collector
// filters out everything we've already seen), so INSERT-per-row is fine.
// If the batch ever grows huge we can switch to a bulk INSERT, but the
// per-row UPSERT keeps error handling per-row simple.
export async function writeStakingEvents(events) {
  if (!events?.length) return 0;
  let inserted = 0;
  for (const e of events) {
    const res = await query(
      `INSERT INTO staking_events
         (tx_hash, height, timestamp, type, delegator, validator,
          source_validator, amount, memo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (tx_hash, type, height, delegator, validator)
       DO NOTHING`,
      [
        e.txHash,
        e.height,
        e.timestamp,
        e.type,
        e.delegator,
        e.validator,
        e.sourceValidator ?? null,
        e.amount,
        e.memo ?? null,
      ],
    );
    inserted += res.rowCount;
  }
  return inserted;
}

// ─── validators ──────────────────────────────────────────────────────────
//
// validatorMonikers is the in-memory object {operator: moniker}. Refresh
// runs hourly and is expected to be a small set (~100 entries on Coreum),
// so per-row UPSERT is fine.
export async function writeValidators(validatorMonikers) {
  const entries = Object.entries(validatorMonikers || {});
  if (!entries.length) return 0;
  let upserted = 0;
  for (const [op, moniker] of entries) {
    if (!op || !moniker) continue;
    await query(
      `INSERT INTO validators (operator_address, moniker, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (operator_address)
       DO UPDATE SET moniker = EXCLUDED.moniker, updated_at = NOW()`,
      [op, moniker],
    );
    upserted++;
  }
  return upserted;
}

// ─── pending_undelegations ───────────────────────────────────────────────
//
// Snapshot table: every refresh wipes and re-inserts the whole curve.
// Both ops in one transaction so a partial INSERT failure can never leave
// the table empty.
export async function writePendingUndelegations(entries) {
  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query("TRUNCATE pending_undelegations");
    if (entries?.length) {
      const flat = [];
      for (const e of entries) {
        flat.push(e.date, e.value);
      }
      await client.query(
        `INSERT INTO pending_undelegations (date, value)
         VALUES ${tuples(entries.length, 2)}`,
        flat,
      );
    }
    await client.query("COMMIT");
    return entries?.length ?? 0;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ─── top_delegators ──────────────────────────────────────────────────────
//
// TRUNCATE + bulk INSERT in a transaction. Single round-trip on the wire
// for the whole 500-row payload (well under PG's 65535 parameter limit:
// 500 × 7 = 3500 params).
export async function writeTopDelegators(entries) {
  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query("TRUNCATE top_delegators");
    if (entries?.length) {
      const flat = [];
      for (const e of entries) {
        flat.push(
          e.address,
          e.rank,
          e.totalStake,
          e.validatorCount,
          e.label?.text ?? null,
          e.label?.type ?? null,
          e.label?.verified ?? null,
        );
      }
      await client.query(
        `INSERT INTO top_delegators
           (address, rank, total_stake, validator_count,
            label_text, label_type, label_verified)
         VALUES ${tuples(entries.length, 7)}`,
        flat,
      );
    }
    await client.query("COMMIT");
    return entries?.length ?? 0;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ─── top_delegators_history ──────────────────────────────────────────────
//
// One snapshot per UTC day. PRIMARY KEY (date, address) makes the INSERT
// idempotent — re-running the same day's snapshot is a no-op. Bulk INSERT
// for the same reason as top_delegators.
export async function writeTopDelegatorsHistory(date, entries) {
  if (!entries?.length) return 0;
  const flat = [];
  for (const e of entries) {
    flat.push(date, e.rank, e.address, e.totalStake, e.labelType ?? null);
  }
  const res = await query(
    `INSERT INTO top_delegators_history
       (date, rank, address, total_stake, label_type)
     VALUES ${tuples(entries.length, 5)}
     ON CONFLICT (date, address) DO NOTHING`,
    flat,
  );
  return res.rowCount;
}

// ─── whale_changes ───────────────────────────────────────────────────────
//
// Singleton row (id = 1). Every refresh overwrites it. JSONB columns
// store the four mover lists wholesale — the frontend already consumes
// them as one payload so flattening would only add joins.
export async function writeWhaleChanges(changes, rankThreshold, stakeThresholdTX) {
  await query(
    `INSERT INTO whale_changes
       (id, updated_at, rank_threshold, stake_threshold_tx,
        arrivals, exits, rank_movers, stake_movers)
     VALUES (1, NOW(), $1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       updated_at         = EXCLUDED.updated_at,
       rank_threshold     = EXCLUDED.rank_threshold,
       stake_threshold_tx = EXCLUDED.stake_threshold_tx,
       arrivals           = EXCLUDED.arrivals,
       exits              = EXCLUDED.exits,
       rank_movers        = EXCLUDED.rank_movers,
       stake_movers       = EXCLUDED.stake_movers`,
    [
      rankThreshold,
      stakeThresholdTX,
      JSON.stringify(changes.arrivals ?? []),
      JSON.stringify(changes.exits ?? []),
      JSON.stringify(changes.rankMovers ?? []),
      JSON.stringify(changes.stakeMovers ?? []),
    ],
  );
  return 1;
}

// ─── daily_metrics ───────────────────────────────────────────────────────
//
// One wide row per UTC day. The collector writes one column at a time
// (e.g. "transactions" for day D, then "active_addresses" for day D, …),
// so we UPSERT touching only the column being updated. The other columns
// already on disk are preserved by ON CONFLICT DO UPDATE setting just one.
//
// Column name MUST be inlined into SQL (parameterised values can't be
// column names). We validate against ALLOWED_DAILY_COLUMNS so a malformed
// caller can never inject SQL via the column argument.
const ALLOWED_DAILY_COLUMNS = new Set([
  "transactions",
  "active_addresses",
  "total_stake",
  "staking_apr",
  "staked_pct",
  "total_supply",
  "circulating_supply",
  "price_usd",
]);

export async function writeDailyMetric(date, columnName, value) {
  if (!ALLOWED_DAILY_COLUMNS.has(columnName)) {
    throw new Error(`writeDailyMetric: unknown column "${columnName}"`);
  }
  // Safe to inline columnName here because of the allowlist above; no
  // user input ever reaches this string.
  await query(
    `INSERT INTO daily_metrics (date, ${columnName}, computed_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (date) DO UPDATE SET
       ${columnName} = EXCLUDED.${columnName},
       computed_at   = NOW()`,
    [date, value],
  );
  return 1;
}

// ─── pse_score ───────────────────────────────────────────────────────────
//
// Time-series append. PRIMARY KEY is computed_at (TIMESTAMPTZ) so unique
// computations never collide; the script takes several seconds and now()
// resolves to microseconds, so collisions are effectively impossible. We
// still ON CONFLICT DO NOTHING to be defensive against same-tick re-runs.
//
// `score` is NUMERIC because the network total is a large bigint stored
// as a string by the script (exceeds 2^53). Postgres parses the string
// directly into NUMERIC with arbitrary precision.
export async function writePseScore(computedAt, score, payload) {
  await query(
    `INSERT INTO pse_score (computed_at, score, payload)
     VALUES ($1::timestamptz, $2::numeric, $3::jsonb)
     ON CONFLICT (computed_at) DO NOTHING`,
    [computedAt, score, JSON.stringify(payload ?? {})],
  );
  return 1;
}

// ─── known_entities ──────────────────────────────────────────────────────
//
// payload mirrors known-entities.json shape: {updatedAt, entries: {address: {label, type, verified, source}}}.
// Few hundred entries. Per-row UPSERT keeps the code simple and gives us
// per-row error tolerance if a single label is malformed.
export async function writeKnownEntities(payload) {
  const entries = Object.entries(payload?.entries || {});
  if (!entries.length) return 0;
  let upserted = 0;
  for (const [address, meta] of entries) {
    if (!address || !meta?.label) continue;
    await query(
      `INSERT INTO known_entities (address, label, type, verified, source, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (address) DO UPDATE SET
         label      = EXCLUDED.label,
         type       = EXCLUDED.type,
         verified   = EXCLUDED.verified,
         source     = EXCLUDED.source,
         updated_at = NOW()`,
      [address, meta.label, meta.type ?? "unknown", !!meta.verified, meta.source ?? null],
    );
    upserted++;
  }
  return upserted;
}
