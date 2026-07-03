// Shared client for the public Coreum indexer (Hasura).
//
// The endpoint sits behind several backends whose metadata is not perfectly
// in sync: an identical query intermittently comes back with a
// "field 'message'/'block' not found in query_root" validation error from a
// stale replica. Each request is stateless, so a retry with a short backoff
// lands on a fresh backend and succeeds. This helper centralizes that retry
// so every passport route is resilient to the flakiness.

export const HASURA_URL = "https://hasura.mainnet-1.coreum.dev/v1/graphql";

export async function hasuraQuery<T>(
  query: string,
  variables: Record<string, unknown>,
  attempts = 4,
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
      if (attempt < attempts - 1) await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
    }
  }
  throw lastErr;
}
