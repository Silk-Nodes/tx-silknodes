import { randomUUID } from "node:crypto";

// One-year cookie that opaquely identifies a browser for vote-uniqueness
// purposes. Cleared = revote, that's fine for v1 — vote counts are signal,
// not gospel. Server uses this same cookie to skip ID-issuing on read
// endpoints and to enforce one-vote-per-browser on the vote endpoint.
const COOKIE_NAME = "txfb_v";
const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 365;

export interface VoterContext {
  voterId: string;
  setCookieHeader: string | null; // null when the cookie already existed
}

export function getOrSetVoterId(req: Request): VoterContext {
  const cookieHeader = req.headers.get("cookie") || "";
  const existing = cookieHeader.match(/(?:^|; )txfb_v=([^;]+)/)?.[1];
  if (existing) {
    return { voterId: existing, setCookieHeader: null };
  }
  const fresh = randomUUID();
  // SameSite=Lax: voting is a state-change-on-same-origin action, no
  // need for third-party context. HttpOnly: voter ID is server-side
  // logic only — no client JS needs to read it. Secure on prod (the
  // browser still sends over https; localhost dev gets non-Secure).
  const isProd = process.env.NODE_ENV === "production";
  const parts = [
    `${COOKIE_NAME}=${fresh}`,
    "Path=/",
    `Max-Age=${COOKIE_MAX_AGE_SEC}`,
    "SameSite=Lax",
    "HttpOnly",
  ];
  if (isProd) parts.push("Secure");
  return { voterId: fresh, setCookieHeader: parts.join("; ") };
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
