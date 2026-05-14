// POST /api/feedback/submit
//
// Receives a new feature request. Spam prevention is layered:
//   1. hCaptcha token verified server-side
//   2. Honeypot field — if filled, silently 204 (don't tell bots they failed)
//   3. Rate limit by IP: max 3 submits / 24h
//   4. CHECK constraints on the table enforce title/description length
//
// Body shape:
//   { title: string, description: string, hcaptchaToken?: string, website?: string (honeypot) }

import { NextResponse } from "next/server";
import { Op } from "sequelize";
import { FeatureRequest } from "@/lib/db/models";
import { applyVoterCookie, getOrSetVoterId, getClientIp } from "@/lib/feedback/voter-id";
import { verifyHcaptcha } from "@/lib/feedback/hcaptcha";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_SUBMITS_PER_IP_PER_DAY = 3;
const MIN_TITLE_LEN = 10;
const MAX_TITLE_LEN = 120;
const MIN_DESC_LEN = 20;
const MAX_DESC_LEN = 2000;

interface SubmitBody {
  title?: string;
  description?: string;
  hcaptchaToken?: string;
  website?: string; // honeypot — must be empty
}

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const { voterId, isFresh } = getOrSetVoterId(req);

    let body: SubmitBody;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid-json" }, { status: 400 });
    }

    // Honeypot: a hidden form field named `website`. Real users leave it
    // empty; many bots fill every input. Silently 204 — telling the bot
    // it was rejected just helps it learn our defenses.
    if (typeof body.website === "string" && body.website.trim().length > 0) {
      return new NextResponse(null, { status: 204 });
    }

    const title = (body.title ?? "").trim();
    const description = (body.description ?? "").trim();

    if (title.length < MIN_TITLE_LEN || title.length > MAX_TITLE_LEN) {
      return NextResponse.json(
        { error: `title must be ${MIN_TITLE_LEN}-${MAX_TITLE_LEN} characters` },
        { status: 400 },
      );
    }
    if (description.length < MIN_DESC_LEN || description.length > MAX_DESC_LEN) {
      return NextResponse.json(
        { error: `description must be ${MIN_DESC_LEN}-${MAX_DESC_LEN} characters` },
        { status: 400 },
      );
    }

    // hCaptcha — when secret isn't configured this is a no-op (returns ok)
    const captcha = await verifyHcaptcha(body.hcaptchaToken || null, ip);
    if (!captcha.ok) {
      return NextResponse.json(
        { error: "captcha-failed", reason: captcha.reason },
        { status: 400 },
      );
    }

    // Rate limit per IP. Skip when there's no IP (test/dev) so the form
    // still works locally.
    if (ip) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recentCount = await FeatureRequest.count({
        where: { submitter_ip: ip, created_at: { [Op.gte]: since } },
      });
      if (recentCount >= MAX_SUBMITS_PER_IP_PER_DAY) {
        return NextResponse.json(
          { error: "rate-limited", message: `You can submit up to ${MAX_SUBMITS_PER_IP_PER_DAY} ideas per day.` },
          { status: 429 },
        );
      }
    }

    const row = await FeatureRequest.create({
      title,
      description,
      submitter_id: voterId,
      submitter_ip: ip,
      status: "open",
    });

    const response = NextResponse.json(
      {
        id: Number(row.id),
        title: row.title,
        description: row.description,
        status: row.status,
        voteCount: row.vote_count,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
        hasVoted: false,
      },
      { status: 201, headers: { "cache-control": "no-store" } },
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
