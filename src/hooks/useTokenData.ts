"use client";

import { useState, useEffect, useCallback } from "react";
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

  const fetchData = useCallback(async () => {
    try {
      setError(null);

      const [tokenRes, stakingRes, networkRes] = await Promise.allSettled([
        fetchTokenData(),
        fetchStakingData(),
        fetchNetworkStatus(),
      ]);

      const newTokenData = tokenRes.status === "fulfilled" ? tokenRes.value : null;
      const newStakingData = stakingRes.status === "fulfilled" ? stakingRes.value : null;

      if (newTokenData) setTokenData(newTokenData);
      if (newStakingData) setStakingData(newStakingData);
      if (networkRes.status === "fulfilled") setNetworkStatus(networkRes.value);

      // Fetch validators with price for income calculation
      const price = newTokenData?.price || 0;
      const validatorRes = await fetchAllValidators(price);
      setValidators(validatorRes);

      setLastUpdated(new Date());
    } catch (err: any) {
      setError(err.message || "Failed to fetch data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, REFRESH_INTERVAL);
    return () => clearInterval(interval);
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
