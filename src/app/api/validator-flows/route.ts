// GET /api/validator-flows?days=30
//
// Per-validator stake flow over a rolling window: how much stake each
// validator gained and lost, split by how it moved.
//
// Response:
//   {
//     updatedAt: ISO string,   // MAX(inserted_at), collector-health proxy
//     days: number,            // the window actually applied
//     flows: {
//       [operatorAddress]: {
//         moniker, delegatedIn, redelegatedIn, undelegatedOut,
//         redelegatedOut, net
//       }
//     }
//   }
//
// Two things worth knowing about the numbers:
//
//   1. Redelegations are counted on BOTH sides. A redelegation credits the
//      destination (redelegatedIn) and debits the source (redelegatedOut),
//      because staking_events stores the source in source_validator. That is
//      what makes "who is winning stake from whom" answerable at all.
//
//   2. No minimum-amount floor. /api/staking-feed filters to events
//      >= 5000 TX because it drives a human-readable activity feed, but
//      totals need every row or they quietly undercount. Do not copy that
//      MIN_AMOUNT_TX constant here.
//
// net = (delegatedIn + redelegatedIn) - (undelegatedOut + redelegatedOut)

import { NextResponse } from "next/server";
import { QueryTypes } from "sequelize";
import { sequelize } from "@/lib/db";
import { StakingEvent } from "@/lib/db/models";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;

type FlowRow = {
  validator: string;
  moniker: string | null;
  delegated_in: string;
  redelegated_in: string;
  undelegated_out: string;
  redelegated_out: string;
};

// Conditional aggregation in one pass, then a UNION ALL leg for the
// redelegation-out side (keyed on source_validator rather than validator).
// The outer GROUP BY folds a validator's two legs into one row.
const SQL = `
  SELECT
    t.v                              AS validator,
    v.moniker                        AS moniker,
    COALESCE(SUM(t.delegated_in), 0)    AS delegated_in,
    COALESCE(SUM(t.redelegated_in), 0)  AS redelegated_in,
    COALESCE(SUM(t.undelegated_out), 0) AS undelegated_out,
    COALESCE(SUM(t.redelegated_out), 0) AS redelegated_out
  FROM (
    SELECT
      validator AS v,
      COALESCE(SUM(amount) FILTER (WHERE type = 'delegate'), 0)   AS delegated_in,
      COALESCE(SUM(amount) FILTER (WHERE type = 'redelegate'), 0) AS redelegated_in,
      COALESCE(SUM(amount) FILTER (WHERE type = 'undelegate'), 0) AS undelegated_out,
      0                                                           AS redelegated_out
    FROM staking_events
    WHERE timestamp >= NOW() - (:days || ' days')::interval
    GROUP BY validator

    UNION ALL

    SELECT
      source_validator AS v,
      0, 0, 0,
      COALESCE(SUM(amount), 0) AS redelegated_out
    FROM staking_events
    WHERE type = 'redelegate'
      AND source_validator IS NOT NULL
      AND timestamp >= NOW() - (:days || ' days')::interval
    GROUP BY source_validator
  ) t
  LEFT JOIN validators v ON v.operator_address = t.v
  GROUP BY t.v, v.moniker
`;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = Number(url.searchParams.get("days"));
  const days =
    Number.isFinite(parsed) && parsed > 0
      ? Math.min(Math.floor(parsed), MAX_DAYS)
      : DEFAULT_DAYS;

  try {
    const rows = await sequelize.query<FlowRow>(SQL, {
      replacements: { days },
      type: QueryTypes.SELECT,
    });

    const flows: Record<
      string,
      {
        moniker: string;
        delegatedIn: number;
        redelegatedIn: number;
        undelegatedOut: number;
        redelegatedOut: number;
        net: number;
      }
    > = {};

    for (const r of rows) {
      const delegatedIn = Number(r.delegated_in);
      const redelegatedIn = Number(r.redelegated_in);
      const undelegatedOut = Number(r.undelegated_out);
      const redelegatedOut = Number(r.redelegated_out);
      flows[r.validator] = {
        moniker: r.moniker ?? "",
        delegatedIn,
        redelegatedIn,
        undelegatedOut,
        redelegatedOut,
        net: delegatedIn + redelegatedIn - (undelegatedOut + redelegatedOut),
      };
    }

    const latest = await StakingEvent.max<Date, StakingEvent>("inserted_at");

    return NextResponse.json({
      updatedAt: latest ? new Date(latest).toISOString() : "",
      days,
      flows,
    });
  } catch (err) {
    console.error("[validator-flows] query failed", err);
    return NextResponse.json(
      { error: "failed to load validator flows" },
      { status: 500 },
    );
  }
}
