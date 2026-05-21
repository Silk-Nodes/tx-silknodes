"use client";

import { useEffect, useState } from "react";
import {
  labelForType,
  normalizeStatus,
  type GovParams,
  type Proposal,
} from "@/lib/governance";

export type VoteOption = "YES" | "NO" | "ABSTAIN" | "NO_WITH_VETO" | "DID_NOT_VOTE";

export interface ValidatorVote {
  consensusAddress: string;
  operatorAddress: string;
  selfDelegateAddress: string;
  moniker: string;
  avatarUrl: string | null;
  website: string | null;
  bondedStakeTX: number;
  status: number;
  jailed: boolean;
  voteOption: VoteOption;
  votedAt: string | null;
  weight: number;
}

export interface DelegatorVote {
  voterAddress: string;
  voteOption: VoteOption;
  votedAt: string;
  weight: number;
}

export interface VelocityPoint {
  t: string;
  yes: number;
  no: number;
  veto: number;
  abstain: number;
}

export interface ProposalDetailData {
  proposal: Proposal;
  params: GovParams;
  validators: ValidatorVote[];
  delegatorVotes: DelegatorVote[];
  velocity: VelocityPoint[];
  meta: {
    validatorCount: number;
    votedCount: number;
    delegatorVoteCount: number;
  };
}

export interface UseProposalDetailState {
  data: ProposalDetailData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

// Poll every 30s while page is open. Lower than the list view because the
// detail page is where users sit when they care about real-time movement.
const POLL_MS = 30_000;

export function useProposalDetail(id: number | null): UseProposalDetailState {
  const [data, setData] = useState<ProposalDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (id === null || !Number.isFinite(id)) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch(`/api/governance/${id}?t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        const raw = await res.json();
        if (cancelled) return;
        const p = raw.proposal;
        const proposal: Proposal = {
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
        };
        setData({
          proposal,
          params: raw.params,
          validators: raw.validators,
          delegatorVotes: raw.delegatorVotes,
          velocity: raw.velocity,
          meta: raw.meta,
        });
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    const interval = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [id, tick]);

  return { data, loading, error, refetch: () => setTick((n) => n + 1) };
}
