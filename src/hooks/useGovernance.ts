"use client";

import { useEffect, useState } from "react";
import {
  labelForType,
  normalizeStatus,
  type GovParams,
  type Proposal,
} from "@/lib/governance";

interface ApiProposal {
  id: number;
  title: string;
  description: string;
  rawStatus: string;
  rawType: string;
  content: Record<string, unknown> | null;
  proposer: string | null;
  submitTime: string | null;
  votingStartTime: string | null;
  votingEndTime: string | null;
  tally: {
    yes: number;
    no: number;
    abstain: number;
    noWithVeto: number;
    totalVoted: number;
    bondedSnapshot: number;
  };
}

interface UseGovernanceState {
  proposals: Proposal[];
  params: GovParams | null;
  loading: boolean;
  error: string | null;
}

const POLL_INTERVAL_MS = 60_000;

export function useGovernance(): UseGovernanceState {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [params, setParams] = useState<GovParams | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch(`/api/governance?t=${Date.now()}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        const items: Proposal[] = (data.proposals as ApiProposal[]).map((p) => ({
          id: p.id,
          title: p.title,
          description: p.description,
          rawStatus: p.rawStatus,
          status: normalizeStatus(p.rawStatus),
          rawType: p.rawType,
          type: labelForType(p.rawType),
          content: p.content,
          proposer: p.proposer,
          submitTime: p.submitTime ?? "",
          votingStartTime: p.votingStartTime,
          votingEndTime: p.votingEndTime,
          tally: p.tally,
        }));
        setProposals(items);
        setParams(data.params as GovParams);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return { proposals, params, loading, error };
}
