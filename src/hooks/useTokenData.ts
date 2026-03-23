"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { TokenData, StakingData, NetworkStatus, ValidatorInfo } from "@/lib/types";
import { fetchTokenData, fetchStakingData, fetchNetworkStatus, fetchAllValidators } from "@/lib/api";

const REFRESH_INTERVAL = 60_000; // 60 seconds

interface UseTokenDataReturn {
  tokenData: TokenData | null;
  stakingData: StakingData | null;
  networkStatus: NetworkStatus | null;
  validators: ValidatorInfo[];
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    try {
      setError(null);

      // Fetch ALL data in parallel (not sequentially)
      const [tokenRes, stakingRes, networkRes, validatorRes] = await Promise.allSettled([
        fetchTokenData(),
        fetchStakingData(),
        fetchNetworkStatus(),
        fetchAllValidators(),
      ]);

      // Only update state if component is still mounted
      if (!mountedRef.current) return;

      const newTokenData = tokenRes.status === "fulfilled" ? tokenRes.value : null;
      const newStakingData = stakingRes.status === "fulfilled" ? stakingRes.value : null;

      if (newTokenData) setTokenData(newTokenData);
      if (newStakingData) setStakingData(newStakingData);
      if (networkRes.status === "fulfilled") setNetworkStatus(networkRes.value);
      if (validatorRes.status === "fulfilled") setValidators(validatorRes.value);

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
    loading,
    error,
    refresh: fetchData,
    lastUpdated,
  };
}
