// Shared client for the public Coreum indexer (Hasura).
//
// The endpoint sits behind several backends whose metadata is not perfectly
// in sync: an identical query intermittently comes back with a
// "field 'message'/'block' not found in query_root" validation error from a
// stale replica. Each request is stateless, so a retry with a short backoff
// lands on a fresh backend and succeeds. This helper centralizes that retry.
//
// It is also, at times, just slow or unresponsive: a message query can hang
// for many seconds. So every attempt has its own timeout, and the whole call
// gives up after a total deadline rather than retrying forever. Callers treat
// a thrown error as "this slice is unavailable" and degrade, so a bad indexer
// moment never freezes the page.

export const HASURA_URL = "https://hasura.mainnet-1.coreum.dev/v1/graphql";

const ATTEMPT_TIMEOUT_MS = 4500; // abort a single hung request
const TOTAL_DEADLINE_MS = 8000; // stop retrying after this, all-in

// A stale replica returns this exact validation error for a field that
// really does exist; it means "you hit a bad backend", so it is always
// worth retrying rather than surfacing.
function isStaleReplicaError(e: unknown): boolean {
  return e instanceof Error && /not found in type: 'query_root'/.test(e.message);
}

export async function hasuraQuery<T>(
  query: string,
  variables: Record<string, unknown>,
  attempts = 5,
): Promise<T> {
  const start = Date.now();
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (Date.now() - start > TOTAL_DEADLINE_MS) break;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ATTEMPT_TIMEOUT_MS);
    try {
      const res = await fetch(HASURA_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
        cache: "no-store",
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`hasura HTTP ${res.status}`);
      const json = await res.json();
      if (json.errors) throw new Error(`hasura errors: ${JSON.stringify(json.errors)}`);
      return json.data as T;
    } catch (e) {
      lastErr = e;
      if (attempt < attempts - 1 && Date.now() - start <= TOTAL_DEADLINE_MS) {
        // Short backoff with jitter. Stale-replica errors clear fast, so
        // stay quick; back off a little harder on genuine network/HTTP errors.
        const base = isStaleReplicaError(e) ? 80 : 200 * (attempt + 1);
        await new Promise((r) => setTimeout(r, base + Math.floor(60 * (attempt % 3))));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}
