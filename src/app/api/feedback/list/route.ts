// GET /api/feedback/list
//
// Public list of feature requests, ordered by votes (default) or by
// newest. Hidden rows are excluded server-side — moderation never has
// to deal with already-rendered spam reappearing.
//
// Returns vote_count and (when the request bears a voter cookie) the
// has_voted boolean per row so the UI can render the upvote button in
// its correct state without a second round-trip.

import { NextResponse } from "next/server";
import { Op, QueryTypes } from "sequelize";
import { sequelize } from "@/lib/db";
import { FeatureRequest } from "@/lib/db/models";
import { getOrSetVoterId } from "@/lib/feedback/voter-id";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ALLOWED_STATUSES = new Set(["open", "planned", "in_progress", "shipped", "declined"]);
const ALLOWED_SORTS = new Set(["votes", "newest"]);

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const statusFilter = url.searchParams.get("status");
    const sortParam = url.searchParams.get("sort") || "votes";
    const sort = ALLOWED_SORTS.has(sortParam) ? sortParam : "votes";

    const where: Record<string, unknown> = { hidden: false };
    if (statusFilter && ALLOWED_STATUSES.has(statusFilter)) {
      where.status = statusFilter;
    }

    // Read-only: don't mint a cookie if there isn't one yet. The voter
    // ID is only created when someone actually votes or submits.
    const voterId = req.headers.get("cookie")?.match(/(?:^|; )txfb_v=([^;]+)/)?.[1] ?? null;

    const order: [string, "ASC" | "DESC"][] = sort === "votes"
      ? [["vote_count", "DESC"], ["created_at", "DESC"]]
      : [["created_at", "DESC"]];

    const rows = await FeatureRequest.findAll({
      where,
      order,
      attributes: ["id", "title", "description", "status", "vote_count", "created_at"],
      raw: true,
    });

    // If we have a voter cookie, fetch which of the listed requests
    // they've already voted on. One round-trip via IN.
    let votedSet = new Set<number>();
    if (voterId && rows.length > 0) {
      const voted = await sequelize.query<{ request_id: string }>(
        `SELECT request_id FROM feature_request_votes
         WHERE voter_id = :voterId
           AND request_id IN (:ids)`,
        {
          replacements: { voterId, ids: rows.map((r) => Number(r.id)) },
          type: QueryTypes.SELECT,
        },
      );
      votedSet = new Set(voted.map((v) => Number(v.request_id)));
    }

    const items = rows.map((r) => ({
      id: Number(r.id),
      title: r.title,
      description: r.description,
      status: r.status,
      voteCount: r.vote_count,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      hasVoted: votedSet.has(Number(r.id)),
    }));

    return NextResponse.json(
      { items, total: items.length },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: message },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
