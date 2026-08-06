// In-process cache with single-flight for API route handlers.
//
// Why this is a security control and not just a speed-up
// ------------------------------------------------------
// Every read route fans out to infrastructure we do NOT own: the public Coreum
// LCD endpoints and the Hasura indexer. Before this, each inbound request
// produced that fan-out live, so anyone could turn one cheap HTTP call into a
// large burst of upstream traffic from our IP. The worst case is
// /api/governance/[id]/overrides, which enriches every delegator vote on a
// proposal and issues ~475 LCD calls in a single request.
//
// The realistic damage there is not our server falling over. It is the public
// nodes rate limiting or banning US, which takes the whole dashboard down and
// looks like an outage with no obvious cause.
//
// HTTP cache headers alone cannot fix this. There is no CDN in front of the
// app, and a hostile client simply ignores them. The dedupe has to happen
// server-side, in this process, which is what this does.
//
// Two separate guarantees:
//
//   1. TTL. A completed result is reused until it expires, so repeat traffic
//      costs nothing upstream.
//   2. Single-flight. Concurrent misses for the same key share ONE in-flight
//      promise. Without this, 50 simultaneous requests to a cold key would
//      each start their own fan-out (50 x 475 upstream calls). This is the
//      property that actually stops a stampede; the TTL alone does not.
//
// Deliberately in-memory. A shared cache would be a new dependency and a new
// failure mode, and one process per deploy is the whole topology today. The
// cost is that a restart starts cold, which is fine.

type Entry = { expires: number; value: unknown };

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

// Bounds memory if a route is ever keyed by user-supplied input. Entries are
// small (JSON payloads), but an unbounded Map keyed by a query parameter is a
// memory-exhaustion lever, so the map is capped and evicts oldest-first.
const MAX_ENTRIES = 500;

function evictIfNeeded() {
  if (store.size <= MAX_ENTRIES) return;
  // Map preserves insertion order, so the first key is the oldest write.
  const oldest = store.keys().next().value;
  if (oldest !== undefined) store.delete(oldest);
}

/**
 * Run `fn` at most once per `ttlMs` per `key`, sharing concurrent calls.
 *
 * A rejection is never cached: the next caller retries. Caching failures would
 * turn a transient upstream blip into a fixed-length outage.
 */
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const run = (async () => {
    try {
      const value = await fn();
      store.set(key, { expires: Date.now() + ttlMs, value });
      evictIfNeeded();
      return value;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, run);
  return run as Promise<T>;
}

/**
 * Cache-Control for a cached read route.
 *
 * `s-maxage` is what a shared cache in front of us would honour, and
 * `stale-while-revalidate` lets one stale response go out while the refresh
 * runs rather than making a user wait. Neither is load-bearing on its own:
 * the server-side cache above is what a hostile client cannot opt out of.
 */
export function cacheHeaders(ttlSeconds: number): Record<string, string> {
  return {
    "cache-control": `public, s-maxage=${ttlSeconds}, stale-while-revalidate=${ttlSeconds * 5}`,
  };
}

/**
 * Wrap a GET handler so identical requests share one execution.
 *
 * The cache key is the full URL (path plus query), so different query
 * parameters stay separate while repeat traffic for the same one is free.
 * Handlers taking no arguments are keyed by `name` alone.
 *
 * Only successful responses (2xx) are cached. Caching an error would pin a
 * transient upstream failure in place for the whole TTL, turning a blip into
 * an outage.
 */
export function withCache(
  name: string,
  ttlSeconds: number,
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    let key = name;
    try {
      const u = new URL(req.url);
      key = `${name}${u.search}`;
    } catch {
      // No usable URL (handler takes no args): the bare name is the key.
    }

    const snapshot = await cached(key, ttlSeconds * 1000, async () => {
      const res = await handler(req);
      if (!res.ok) return null; // signal: do not cache
      return { body: await res.text(), status: res.status };
    });

    if (!snapshot) {
      // Uncacheable (error) result: run it for real so the caller still gets
      // the true status and body rather than a stale or empty response.
      return handler(req);
    }

    return new Response(snapshot.body, {
      status: snapshot.status,
      headers: { "content-type": "application/json", ...cacheHeaders(ttlSeconds) },
    });
  };
}
