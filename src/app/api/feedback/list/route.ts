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
import { applyVoterCookie, getOrSetVoterId } from "@/lib/feedback/voter-id";

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

    // Mint the voter cookie on first list load so subsequent votes
    // already have a stable ID to dedupe against. Without this, the very
    // first vote click set the cookie + counted a vote in the same
    // request, but then the response could race with the optimistic UI
    // and the user's cookie would only stick from the second click on,
    // making it look like votes weren't unique.
    const { voterId, isFresh } = getOrSetVoterId(req);

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

    const response = NextResponse.json(
      { items, total: items.length },
      { headers: { "cache-control": "no-store" } },
    );
    if (isFresh) applyVoterCookie(response, voterId);
    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: message },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
