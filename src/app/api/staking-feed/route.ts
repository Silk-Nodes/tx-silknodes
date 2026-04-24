// GET /api/staking-feed
//
// Replaces the public/analytics/staking-events.json file that the
// frontend fetches today. Returns the same wire shape the existing
// useStakingFeed hook expects so migration is a one-line URL swap —
// no UI changes required.
//
// Response:
//   {
//     updatedAt: ISO string,      // MAX(inserted_at) from staking_events;
//                                 // proxy for collector-health (matches the
//                                 // old file's "last collector write")
//     validators: { [op]: moniker },
//     events: StakingEvent[]      // camelCased, ordered newest-first
//   }
//
// Defaults match the VM collector's historical JSON shape: events with
// amount >= 5000 TX over the last 6 months, capped at 10 000 rows.
// Both are overridable via query params for future tooling without
// changing the schema.

import { NextResponse } from "next/server";
import { Op } from "sequelize";
import {
  PendingUndelegation,
  StakingEvent,
  Validator,
} from "@/lib/db/models";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Minimum amount in TX to surface in the feed. Matches the VM collector's
// MIN_AMOUNT_TX constant so the DB-backed feed shows the same rows the
// JSON-backed feed did.
const MIN_AMOUNT_TX = 5000;
// 6-month window — bumped from ~3-month in the legacy JSON now that the
// DB isn't constrained by file size.
const DEFAULT_SINCE_DAYS = 180;
// 10 000 rows. Covers ~55 rows/day comfortably. UI paginates internally.
const DEFAULT_LIMIT = 10_000;
const MAX_LIMIT = 50_000; // hard ceiling so a bad query can't DoS the API

type ApiStakingEvent = {
  type: "delegate" | "undelegate" | "redelegate";
  timestamp: string;
  height: number;
  delegator: string;
  validator: string;
  sourceValidator?: string;
  amount: number;
  txHash: string;
};

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const sinceDays = clampPositiveInt(
      url.searchParams.get("sinceDays"),
      DEFAULT_SINCE_DAYS,
      1,
      3650,
    );
    const limit = clampPositiveInt(
      url.searchParams.get("limit"),
      DEFAULT_LIMIT,
      1,
      MAX_LIMIT,
    );

    const sinceMs = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
    const sinceDate = new Date(sinceMs);

    // Fire the queries in parallel. Postgres handles the fanout fine
    // and we halve total latency vs sequential awaits.
    //
    // The two "heartbeat" aggregates feed updatedAt — we pick the
    // latest of them so the stale-feed banner tracks "collector alive"
    // rather than "latest on-chain event". A quiet chain period (no
    // staking events for >60 min) used to be misread as a stuck
    // pipeline; pending_undelegations is refreshed every 15 min
    // regardless of chain activity, so its updated_at is a reliable
    // liveness signal.
    const [rows, validatorRows, latestInsertRow, latestPendingRow] =
      await Promise.all([
        StakingEvent.findAll({
          where: {
            amount: { [Op.gte]: MIN_AMOUNT_TX },
            timestamp: { [Op.gte]: sinceDate },
          },
          order: [["timestamp", "DESC"]],
          limit,
          raw: true,
        }),
        Validator.findAll({ raw: true }),
        StakingEvent.max<Date, StakingEvent>("inserted_at"),
        PendingUndelegation.max<Date, PendingUndelegation>("updated_at"),
      ]);

    // Map DB row shape -> the JS shape the frontend already uses.
    // NUMERIC columns arrive as strings (Sequelize preserves precision);
    // our amounts are in TX (< 2^53) so Number() is safe.
    const events: ApiStakingEvent[] = rows.map((r) => {
      const e: ApiStakingEvent = {
        type: r.type as ApiStakingEvent["type"],
        timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : String(r.timestamp),
        height: Number(r.height),
        delegator: r.delegator,
        validator: r.validator,
        amount: Number(r.amount),
        txHash: r.tx_hash,
      };
      if (r.source_validator) e.sourceValidator = r.source_validator;
      return e;
    });

    const validators: Record<string, string> = {};
    for (const v of validatorRows) validators[v.operator_address] = v.moniker;

    // updatedAt = the freshest "collector is alive" signal we have.
    // MAX(staking_events.inserted_at) reflects actual chain activity;
    // MAX(pending_undelegations.updated_at) reflects the 15-min
    // collector refresh cycle and keeps updatedAt moving even during
    // quiet chain periods. Fall back to "now" on a fresh deploy with
    // both tables empty.
    const heartbeat = [latestInsertRow, latestPendingRow].filter(
      (d): d is Date => d instanceof Date,
    );
    const updatedAt =
      heartbeat.length > 0
        ? new Date(Math.max(...heartbeat.map((d) => d.getTime()))).toISOString()
        : new Date().toISOString();

    return NextResponse.json(
      { updatedAt, validators, events },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: message, at: new Date().toISOString() },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

/** Parse ?param=N as a positive integer, clamped to [min, max]. */
function clampPositiveInt(
  raw: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw == null) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}
