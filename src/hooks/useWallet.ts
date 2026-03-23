"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { WalletState, Delegation } from "@/lib/types";
import {
  connectWallet,
  disconnectWallet,
  refreshWalletData,
  claimAllRewards,
  delegateTokens,
  redelegateTokens,
  undelegateTokens,
  getAvailableWallets,
} from "@/lib/wallet";

const INITIAL_STATE: WalletState = {
  connected: false,
  address: "",
  balance: 0,
  stakedAmount: 0,
  rewards: 0,
  delegations: [],
  unbondingDelegations: [],
  walletType: "",
};

export function useWallet() {
  const [wallet, setWallet] = useState<WalletState>(INITIAL_STATE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txPending, setTxPending] = useState(false);
  const [txResult, setTxResult] = useState<{ hash: string; type: string } | null>(null);
  const autoReconnectAttempted = useRef(false);

  // Dismiss error after 8 seconds
  useEffect(() => {
    if (error) {
      const t = setTimeout(() => setError(null), 8000);
      return () => clearTimeout(t);
    }
  }, [error]);

  // Dismiss tx result after 10 seconds
  useEffect(() => {
    if (txResult) {
      const t = setTimeout(() => setTxResult(null), 10000);
      return () => clearTimeout(t);
    }
  }, [txResult]);

  const connect = useCallback(async (walletType: "keplr" | "leap" | "cosmostation" = "keplr") => {
    setLoading(true);
    setError(null);
    try {
      const state = await connectWallet(walletType);
      setWallet(state);
    } catch (err: any) {
      const msg = err.message || "Failed to connect wallet";
      setError(msg);
      console.error("Wallet connection error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setWallet(disconnectWallet());
    setError(null);
    setTxResult(null);
  }, []);

  // Refresh wallet data without reconnecting
  const refresh = useCallback(async () => {
    if (!wallet.connected || !wallet.address) return;
    try {
      const data = await refreshWalletData(wallet.address);
      setWallet((prev) => ({ ...prev, ...data }));
    } catch (err) {
      console.error("Failed to refresh wallet:", err);
    }
  }, [wallet.connected, wallet.address]);

  // Claim all rewards
  const claimRewards = useCallback(async () => {
    if (!wallet.connected || wallet.delegations.length === 0) return;
    setTxPending(true);
    setError(null);
    try {
      const hash = await claimAllRewards(wallet.delegations, wallet.walletType || "keplr");
      setTxResult({ hash, type: "claim" });
      // Refresh after a short delay for chain to process
      setTimeout(() => refresh(), 3000);
    } catch (err: any) {
      setError(err.message || "Failed to claim rewards");
    } finally {
      setTxPending(false);
    }
  }, [wallet.connected, wallet.delegations, wallet.walletType, refresh]);

  // Delegate to validator
  const delegate = useCallback(async (validatorAddress: string, amount: number) => {
    if (!wallet.connected) return;
    setTxPending(true);
    setError(null);
    try {
      const hash = await delegateTokens(validatorAddress, amount, wallet.walletType || "keplr");
      setTxResult({ hash, type: "delegate" });
      setTimeout(() => refresh(), 3000);
    } catch (err: any) {
      setError(err.message || "Failed to delegate");
    } finally {
      setTxPending(false);
    }
  }, [wallet.connected, wallet.walletType, refresh]);

  // Redelegate
  const redelegate = useCallback(async (srcValidator: string, dstValidator: string, amount: number) => {
    if (!wallet.connected) return;
    setTxPending(true);
    setError(null);
    try {
      const hash = await redelegateTokens(srcValidator, dstValidator, amount, wallet.walletType || "keplr");
      setTxResult({ hash, type: "redelegate" });
      setTimeout(() => refresh(), 3000);
    } catch (err: any) {
      setError(err.message || "Failed to redelegate");
    } finally {
      setTxPending(false);
    }
  }, [wallet.connected, wallet.walletType, refresh]);

  // Undelegate from validator
  const undelegate = useCallback(async (validatorAddress: string, amount: number) => {
    if (!wallet.connected) return;
    setTxPending(true);
    setError(null);
    try {
      const hash = await undelegateTokens(validatorAddress, amount, wallet.walletType || "keplr");
      setTxResult({ hash, type: "undelegate" });
      setTimeout(() => refresh(), 3000);
    } catch (err: any) {
      setError(err.message || "Failed to undelegate");
    } finally {
      setTxPending(false);
    }
  }, [wallet.connected, wallet.walletType, refresh]);

  // Auto-reconnect on page load
  useEffect(() => {
    if (autoReconnectAttempted.current) return;
    autoReconnectAttempted.current = true;

    try {
      const wasConnected = localStorage.getItem("tx-wallet-connected");
      const savedType = localStorage.getItem("tx-wallet-type") as "keplr" | "leap" | "cosmostation" | null;
      if (wasConnected === "true" && savedType) {
        const wallets = getAvailableWallets();
        if ((savedType === "keplr" && wallets.keplr) || (savedType === "leap" && wallets.leap) || (savedType === "cosmostation" && wallets.cosmostation)) {
          connect(savedType);
        }
      }
    } catch {}
  }, [connect]);

  // Listen for Keplr/Leap account changes
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleAccountChange = () => {
      if (wallet.connected && wallet.walletType) {
        connect(wallet.walletType);
      }
    };

    window.addEventListener("keplr_keystorechange", handleAccountChange);
    window.addEventListener("leap_keystorechange", handleAccountChange);
    window.addEventListener("cosmostation_keystorechange", handleAccountChange);

    return () => {
      window.removeEventListener("keplr_keystorechange", handleAccountChange);
      window.removeEventListener("leap_keystorechange", handleAccountChange);
      window.removeEventListener("cosmostation_keystorechange", handleAccountChange);
    };
  }, [wallet.connected, wallet.walletType, connect]);

  return {
    wallet,
    loading,
    error,
    txPending,
    txResult,
    connect,
    disconnect,
    refresh,
    claimRewards,
    delegate,
    redelegate,
    undelegate,
    clearError: () => setError(null),
    clearTxResult: () => setTxResult(null),
    availableWallets: typeof window !== "undefined" ? getAvailableWallets() : { keplr: false, leap: false, cosmostation: false },
  };
}
