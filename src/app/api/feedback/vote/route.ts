// POST /api/feedback/vote
//
// Toggle a vote on a feature request. Body: { requestId: number }.
// Behaviour:
//   - If voter cookie hasn't voted on this request → insert vote, increment vote_count
//   - If voter cookie has already voted          → delete vote, decrement vote_count
// Both branches run in a transaction so vote_count and the votes table
// can't drift.
//
// Rate limit by IP: 30 votes / 24h. Generous — a normal user upvoting
// through the list won't hit it; abuse will.

import { NextResponse } from "next/server";
import { Op } from "sequelize";
import { sequelize } from "@/lib/db";
import { FeatureRequest, FeatureRequestVote } from "@/lib/db/models";
import { getOrSetVoterId, getClientIp } from "@/lib/feedback/voter-id";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_VOTES_PER_IP_PER_DAY = 30;

interface VoteBody {
  requestId?: number;
}

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const { voterId, setCookieHeader } = getOrSetVoterId(req);

    let body: VoteBody;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid-json" }, { status: 400 });
    }

    const requestId = Number(body.requestId);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      return NextResponse.json({ error: "requestId required" }, { status: 400 });
    }

    if (ip) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recent = await FeatureRequestVote.count({
        where: { voter_ip: ip, created_at: { [Op.gte]: since } },
      });
      if (recent >= MAX_VOTES_PER_IP_PER_DAY) {
        return NextResponse.json(
          { error: "rate-limited", message: `Too many votes today.` },
          { status: 429 },
        );
      }
    }

    // Transaction so vote_count and feature_request_votes can't drift.
    // Lock the FeatureRequest row to serialize concurrent votes on the
    // same request (would otherwise risk lost updates on the counter).
    const result = await sequelize.transaction(async (t) => {
      const fr = await FeatureRequest.findOne({
        where: { id: requestId, hidden: false },
        lock: t.LOCK.UPDATE,
        transaction: t,
      });
      if (!fr) return { notFound: true as const };

      const existing = await FeatureRequestVote.findOne({
        where: { request_id: requestId, voter_id: voterId },
        transaction: t,
      });

      if (existing) {
        await existing.destroy({ transaction: t });
        await fr.decrement("vote_count", { by: 1, transaction: t });
        await fr.reload({ transaction: t });
        return { hasVoted: false, voteCount: fr.vote_count };
      }
      await FeatureRequestVote.create(
        { request_id: requestId, voter_id: voterId, voter_ip: ip },
        { transaction: t },
      );
      await fr.increment("vote_count", { by: 1, transaction: t });
      await fr.reload({ transaction: t });
      return { hasVoted: true, voteCount: fr.vote_count };
    });

    if ("notFound" in result) {
      return NextResponse.json({ error: "not-found" }, { status: 404 });
    }

    const headers: Record<string, string> = { "cache-control": "no-store" };
    if (setCookieHeader) headers["set-cookie"] = setCookieHeader;
    return NextResponse.json(result, { headers });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: message },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
