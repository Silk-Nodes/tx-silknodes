// Shared client for the public Coreum indexer (Hasura).
//
// The endpoint sits behind several backends whose metadata is not perfectly
// in sync: an identical query intermittently comes back with a
// "field 'message'/'block' not found in query_root" validation error from a
// stale replica. Each request is stateless, so a retry with a short backoff
// lands on a fresh backend and succeeds. This helper centralizes that retry
// so every passport route is resilient to the flakiness.

export const HASURA_URL = "https://hasura.mainnet-1.coreum.dev/v1/graphql";

// A stale replica returns this exact validation error for a field that
// really does exist; it means "you hit a bad backend", so it is always
// worth retrying rather than surfacing.
function isStaleReplicaError(e: unknown): boolean {
  return e instanceof Error && /not found in type: 'query_root'/.test(e.message);
}

export async function hasuraQuery<T>(
  query: string,
  variables: Record<string, unknown>,
  attempts = 8,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch(HASURA_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`hasura HTTP ${res.status}`);
      const json = await res.json();
      if (json.errors) throw new Error(`hasura errors: ${JSON.stringify(json.errors)}`);
      return json.data as T;
    } catch (e) {
      lastErr = e;
      if (attempt < attempts - 1) {
        // Short backoff with jitter. Stale-replica errors clear fast, so
        // stay quick; back off a little harder on genuine network/HTTP errors.
        const base = isStaleReplicaError(e) ? 80 : 200 * (attempt + 1);
        await new Promise((r) => setTimeout(r, base + Math.floor(60 * (attempt % 3))));
      }
    }
  }
  throw lastErr;
}
