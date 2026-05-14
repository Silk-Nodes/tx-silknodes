import { randomUUID } from "node:crypto";
import type { NextResponse } from "next/server";

// One-year cookie that opaquely identifies a browser for vote-uniqueness
// purposes. Cleared = revote, that's fine for v1 — vote counts are signal,
// not gospel. Server uses this same cookie to skip ID-issuing on read
// endpoints and to enforce one-vote-per-browser on the vote endpoint.
const COOKIE_NAME = "txfb_v";
const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 365;

export interface VoterContext {
  voterId: string;
  isFresh: boolean; // true when we just minted this id (caller must persist via response.cookies)
}

export function getOrSetVoterId(req: Request): VoterContext {
  const cookieHeader = req.headers.get("cookie") || "";
  const existing = cookieHeader.match(/(?:^|; )txfb_v=([^;]+)/)?.[1];
  if (existing) {
    return { voterId: existing, isFresh: false };
  }
  return { voterId: randomUUID(), isFresh: true };
}

// Apply the voter-id cookie to a NextResponse. Centralised here so all
// three routes (list/submit/vote) use the same options and so we use the
// canonical Next.js API instead of hand-rolling a Set-Cookie header
// (which doesn't always serialise correctly in some App Router edge cases).
export function applyVoterCookie<T>(res: NextResponse<T>, voterId: string): NextResponse<T> {
  const isProd = process.env.NODE_ENV === "production";
  res.cookies.set({
    name: COOKIE_NAME,
    value: voterId,
    path: "/",
    maxAge: COOKIE_MAX_AGE_SEC,
    sameSite: "lax",
    httpOnly: true,
    secure: isProd,
  });
  return res;
}

// Extract a best-effort client IP from common proxy headers. We're
// behind Caddy → systemd; x-forwarded-for is set by Caddy. Stored for
// abuse forensics only — never returned in API responses.
export function getClientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return null;
}
