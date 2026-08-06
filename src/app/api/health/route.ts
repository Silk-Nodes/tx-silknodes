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

export async function GET(req: Request) {
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

    // Row counts and table names are an operator diagnostic, not public data.
    // Served openly they hand anyone a free map of the schema, which is exactly
    // the reconnaissance step you want to make expensive. Gated behind a shared
    // secret so our own monitoring keeps working; without it this is a plain
    // liveness probe, which is all a health check owes the public.
    const token = process.env.HEALTH_TOKEN;
    const authorized = Boolean(token) && req.headers.get("x-health-token") === token;

    return NextResponse.json(
      {
        ok: true,
        at: new Date().toISOString(),
        ...(authorized
          ? {
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
            }
          : {}),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err: unknown) {
    // The raw message can carry a connection string, credentials or internal
    // hostnames, so it goes to the log and never to the caller.
    console.error("[health] check failed:", err);
    return NextResponse.json(
      { ok: false, at: new Date().toISOString() },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
