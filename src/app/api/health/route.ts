// /api/health — smoke-test endpoint for the DB migration Phase 2.
//
// Reports row counts for every table the collectors write to. Used:
//   - Locally to confirm the Next.js server can reach Postgres and the
//     Sequelize models match the SQL schema.
//   - In production as a minimal "is the DB reachable?" probe.
//
// Response shape:
//   {
//     ok: true,
//     tables: {
//       staking_events: 929,
//       validators: 103,
//       ...
//     },
//     at: "2026-04-24T10:30:00.000Z"
//   }
// or, on failure:
//   { ok: false, error: "...", at: "..." }
//
// The route runs per-request and is cheap (9 small COUNT queries) but
// we still disable Next.js caching so a failing DB connection isn't
// masked by a stale 200 response.

import { NextResponse } from "next/server";
import {
  DailyMetric,
  KnownEntity,
  PendingUndelegation,
  PseScore,
  StakingEvent,
  TopDelegator,
  TopDelegatorHistory,
  Validator,
  WhaleChanges,
} from "@/lib/db/models";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    // Parallelise — Postgres handles 9 concurrent SELECT count(*) fine
    // and we halve the round-trip budget vs. sequential queries.
    const [
      stakingEvents,
      validators,
      topDelegators,
      topDelegatorsHistory,
      whaleChanges,
      pendingUndelegations,
      dailyMetrics,
      knownEntities,
      pseScore,
    ] = await Promise.all([
      StakingEvent.count(),
      Validator.count(),
      TopDelegator.count(),
      TopDelegatorHistory.count(),
      WhaleChanges.count(),
      PendingUndelegation.count(),
      DailyMetric.count(),
      KnownEntity.count(),
      PseScore.count(),
    ]);

    return NextResponse.json(
      {
        ok: true,
        tables: {
          staking_events: stakingEvents,
          validators,
          top_delegators: topDelegators,
          top_delegators_history: topDelegatorsHistory,
          whale_changes: whaleChanges,
          pending_undelegations: pendingUndelegations,
          daily_metrics: dailyMetrics,
          known_entities: knownEntities,
          pse_score: pseScore,
        },
        at: new Date().toISOString(),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: message, at: new Date().toISOString() },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
