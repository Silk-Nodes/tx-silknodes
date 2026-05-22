"use client";

import { useEffect, useState } from "react";

export interface OverrideEnrichment {
  voterAddress: string;
  voteOption: string;
  votedAt: string;
  bondedTotalTX: number;
  delegations: {
    operatorAddress: string;
    delegatedTX: number;
  }[];
}

interface State {
  overrides: OverrideEnrichment[] | null;
  loading: boolean;
  error: string | null;
}

// Lazy-loaded hook for the overrides drawer/panel. Doesn't fire until
// `enabled` becomes true (i.e. user expands the accordion). Once fetched,
// the result is kept in component state for the rest of the session so
// re-opening the accordion is instant.
export function useProposalOverrides(id: number, enabled: boolean): State {
  const [state, setState] = useState<State>({ overrides: null, loading: false, error: null });

  useEffect(() => {
    if (!enabled || !Number.isFinite(id)) return;
    if (state.overrides !== null) return; // already fetched
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    (async () => {
      try {
        const res = await fetch(`/api/governance/${id}/overrides`, { cache: "no-store" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        const json = await res.json();
        if (cancelled) return;
        setState({ overrides: json.overrides ?? [], loading: false, error: null });
      } catch (e) {
        if (!cancelled) setState({ overrides: [], loading: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, enabled]);

  return state;
}
