"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { TokenData, StakingData, NetworkStatus, ValidatorInfo, ValidatorSetEntry } from "@/lib/types";
import { fetchTokenData, fetchStakingData, fetchNetworkStatus, fetchAllValidators, fetchValidatorSet, fetchChainSnapshot } from "@/lib/api";

const REFRESH_INTERVAL = 60_000; // 60 seconds

interface UseTokenDataReturn {
  tokenData: TokenData | null;
  stakingData: StakingData | null;
  networkStatus: NetworkStatus | null;
  validators: ValidatorInfo[];
  /** The validator table's rows. Null until the first load settles. */
  validatorSet: ValidatorSetEntry[] | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  lastUpdated: Date | null;
}

export function useTokenData(): UseTokenDataReturn {
  const [tokenData, setTokenData] = useState<TokenData | null>(null);
  const [stakingData, setStakingData] = useState<StakingData | null>(null);
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus | null>(null);
  const [validators, setValidators] = useState<ValidatorInfo[]>([]);
  const [validatorSet, setValidatorSet] = useState<ValidatorSetEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    try {
      setError(null);

      // Staking data and both validator lists come from the server snapshot,
      // read once a minute for every visitor. When it is down, read the chain
      // from the browser as before, so an outage stays visible as an outage
      // rather than turning into zeros.
      const chain = async () => {
        const snap = await fetchChainSnapshot();
        if (snap) return snap;
        const [stakingData, validators, validatorSet] = await Promise.all([
          fetchStakingData(),
          fetchAllValidators(),
          fetchValidatorSet().catch(() => [] as ValidatorSetEntry[]),
        ]);
        return { stakingData, validators, validatorSet };
      };

      const [tokenRes, chainRes, networkRes] = await Promise.allSettled([
        fetchTokenData(),
        chain(),
        fetchNetworkStatus(),
      ]);
      const stakingRes = chainRes.status === "fulfilled"
        ? { status: "fulfilled" as const, value: chainRes.value.stakingData }
        : chainRes;
      const validatorRes = chainRes.status === "fulfilled"
        ? { status: "fulfilled" as const, value: chainRes.value.validators }
        : chainRes;

      // Only update state if component is still mounted
      if (!mountedRef.current) return;

      const newTokenData = tokenRes.status === "fulfilled" ? tokenRes.value : null;
      const newStakingData = stakingRes.status === "fulfilled" ? stakingRes.value : null;

      // A refresh that lost the price keeps the last good one instead of
      // blanking the card.
      if (newTokenData) {
        setTokenData((prev) =>
          newTokenData.price > 0 || !prev ? newTokenData : { ...newTokenData, price: prev.price, priceChange24h: prev.priceChange24h, marketCap: prev.marketCap, volume24h: prev.volume24h },
        );
      }
      if (newStakingData) setStakingData(newStakingData);
      if (networkRes.status === "fulfilled") setNetworkStatus(networkRes.value);
      if (validatorRes.status === "fulfilled") setValidators(validatorRes.value);
      // Keep the last good table on a failed refresh; settle to [] only if
      // there never was one, so the table can stop showing a loader.
      if (chainRes.status === "fulfilled" && chainRes.value.validatorSet.length) setValidatorSet(chainRes.value.validatorSet);
      else setValidatorSet((prev) => prev ?? []);

      setLastUpdated(new Date());
    } catch (err: any) {
      if (mountedRef.current) setError(err.message || "Failed to fetch data");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchData();
    const interval = setInterval(fetchData, REFRESH_INTERVAL);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchData]);

  return {
    tokenData,
    stakingData,
    networkStatus,
    validators,
    validatorSet,
    loading,
    error,
    refresh: fetchData,
    lastUpdated,
  };
}
