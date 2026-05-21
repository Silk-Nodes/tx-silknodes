"use client";

import { useEffect, useState } from "react";

// Returns the connected wallet's current delegations from the Cosmos LCD
// (REST) endpoint. Hasura's action_delegation passthrough is flaky against
// the chain's RPC, so we hit the LCD directly. It's CORS-friendly from
// the public Coreum node.
//
// Returns operator addresses (corevaloper1...) - that's what ValidatorVoteTable
// uses for highlighting, and what Cosmos staking semantically keys on.

const LCD = "https://full-node.mainnet-1.coreum.dev:1317";
const UCORE_PER_TX = 1_000_000;

interface DelegationResponseRaw {
  delegation: {
    delegator_address: string;
    validator_address: string; // operator address
    shares: string;
  };
  balance: { denom: string; amount: string };
}

export interface UserDelegation {
  operatorAddress: string;
  delegatedTX: number;
}

export interface UseUserDelegationsState {
  delegations: UserDelegation[];
  loading: boolean;
  error: string | null;
}

export function useUserDelegations(address: string | null): UseUserDelegationsState {
  const [delegations, setDelegations] = useState<UserDelegation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) {
      setDelegations([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    const load = async () => {
      try {
        // pagination.limit=200 covers every realistic delegator. The LCD
        // tops out at the staking module's max, well above 200.
        const url = `${LCD}/cosmos/staking/v1beta1/delegations/${address}?pagination.limit=200`;
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        const items: UserDelegation[] = (json.delegation_responses as DelegationResponseRaw[] ?? []).map((d) => ({
          operatorAddress: d.delegation.validator_address,
          delegatedTX: Number(d.balance.amount) / UCORE_PER_TX,
        }));
        setDelegations(items);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [address]);

  return { delegations, loading, error };
}
