// Per-IP rate limiting for the public API.
//
// Every /api route is unauthenticated and always will be: the dashboard is a
// public good and other TX projects are welcome to read from it. So the goal
// is not to keep people out, it is to stop one caller from turning our server
// into a burst of traffic against infrastructure we do not own (the public
// Coreum LCD endpoints and the Hasura indexer).
//
// Limits are deliberately generous. A well-behaved integrator that caches for
// 60s will never see one. A per-visitor polling loop will.
//
// This is the second line of defence, not the first. The response cache is
// what actually protects upstream, because it makes repeat traffic free
// regardless of who sends it. This layer bounds the cost of cache MISSES,
// which is the case an attacker can still force by varying query parameters.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Requests allowed per IP per window.
const WINDOW_MS = 60_000;
const DEFAULT_LIMIT = 120; // 2/s sustained, far above any real browsing session
const EXPENSIVE_LIMIT = 12; // routes that fan out to the LCD per request

// Routes whose cost is dominated by upstream calls rather than our own DB.
// A cache miss here is expensive enough to be worth its own budget.
const EXPENSIVE = [
  /^\/api\/governance\/\d+\/overrides/,
  /^\/api\/validator\//,
  // Not upstream-heavy but multi-megabyte, so it is a bandwidth lever rather
  // than an amplification one. Same tight budget, different reason.
  /^\/api\/whale-data/,
];

type Bucket = { count: number; resets: number };
const buckets = new Map<string, Bucket>();

// Without this the map grows one entry per distinct IP forever, which is
// itself a memory-exhaustion lever. Expired buckets are swept opportunistically
// rather than on a timer, so there is nothing to leak if the process is idle.
function sweep(now: number) {
  if (buckets.size < 5000) return;
  for (const [k, b] of buckets) if (b.resets <= now) buckets.delete(k);
}

/**
 * The real client IP.
 *
 * The app sits behind Caddy, so the socket address is always the proxy. Reading
 * it instead of the forwarded header would put every visitor in ONE bucket and
 * rate limit the entire internet as a single client. That failure is silent and
 * looks like the site randomly 429ing under normal load, so it is worth being
 * explicit about.
 *
 * Only the first entry of X-Forwarded-For is trusted, since a client can append
 * arbitrary values to that header and everything after the first hop is
 * attacker-controlled.
 */
function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // The write routes do their own per-IP limiting with captcha and honeypot
  // checks, which are stricter and context-aware. Leave them alone.
  if (path.startsWith("/api/feedback/") || path === "/api/flows-submit-entity") {
    return NextResponse.next();
  }

  const limit = EXPENSIVE.some((re) => re.test(path)) ? EXPENSIVE_LIMIT : DEFAULT_LIMIT;
  const now = Date.now();
  const key = `${clientIp(req)}:${limit}`;

  sweep(now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resets <= now) {
    buckets.set(key, { count: 1, resets: now + WINDOW_MS });
    return NextResponse.next();
  }

  bucket.count++;
  if (bucket.count > limit) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resets - now) / 1000));
    return NextResponse.json(
      { error: "rate limited", retryAfter },
      {
        status: 429,
        headers: {
          "retry-after": String(retryAfter),
          "cache-control": "no-store",
        },
      },
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
