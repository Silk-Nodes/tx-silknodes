"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { SILK_LCD } from "@/lib/chain-config";

export interface SmartToken {
  denom: string;
  issuer: string;
  symbol: string;
  subunit: string;
  precision: number;
  description: string;
  globally_frozen: boolean;
  features: string[];
  burn_rate: string;
  send_commission_rate: string;
  supply: number;
  admin: string;
  issuedAt?: number; // estimated from position
}

export interface RWAStats {
  totalTokens: number;
  totalIssuers: number;
  compliantTokens: number;
  totalSupplyUnits: number; // aggregate supply across all tokens
  featureCounts: Record<string, number>;
  recentTokens: SmartToken[]; // last 10 issued
  topByFeatures: SmartToken[]; // most compliant
}

export interface RWAData {
  tokens: SmartToken[];
  stats: RWAStats;
  loading: boolean;
  error: string | null;
}

// Features that indicate RWA compliance
const RWA_FEATURES = ["whitelisting", "freezing", "clawback", "burning", "minting"];

function parseSupply(amount: string, precision: number): number {
  return parseInt(amount) / Math.pow(10, precision);
}

export function useRWATokens(): RWAData & { refresh: () => void } {
  const [tokens, setTokens] = useState<SmartToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  const fetchTokens = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Step 1: Get all denoms from bank supply (paginated)
      const allDenoms: { denom: string; amount: string }[] = [];
      let nextKey: string | null = null;

      do {
        const paginationParam = nextKey ? `&pagination.key=${encodeURIComponent(nextKey)}` : "";
        const url: string = `${SILK_LCD}/cosmos/bank/v1beta1/supply?pagination.limit=500${paginationParam}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Supply fetch failed: ${res.status}`);
        const data = await res.json();
        allDenoms.push(...(data.supply || []));
        nextKey = data.pagination?.next_key || null;
      } while (nextKey);

      // Step 2: Filter for Smart Token denoms (pattern: subunit-core1...)
      const smartDenoms = allDenoms.filter(
        (d) => d.denom.match(/^[a-zA-Z0-9]+-core1[a-z0-9]+$/) && d.denom !== "ucore"
      );

      // Step 3: Fetch token details for each (batch with concurrency limit)
      const BATCH_SIZE = 15;
      const smartTokens: SmartToken[] = [];

      for (let i = 0; i < smartDenoms.length; i += BATCH_SIZE) {
        const batch = smartDenoms.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map(async (d) => {
            const res = await fetch(`${SILK_LCD}/coreum/asset/ft/v1/tokens/${d.denom}`);
            if (!res.ok) return null;
            const data = await res.json();
            const token = data.token;
            return {
              denom: token.denom,
              issuer: token.issuer,
              symbol: token.symbol || token.subunit?.toUpperCase() || "???",
              subunit: token.subunit,
              precision: token.precision || 0,
              description: token.description || "",
              globally_frozen: token.globally_frozen || false,
              features: token.features || [],
              burn_rate: token.burn_rate || "0",
              send_commission_rate: token.send_commission_rate || "0",
              supply: parseSupply(d.amount, token.precision || 0),
              admin: token.admin || token.issuer,
            } as SmartToken;
          })
        );
        for (const r of results) {
          if (r.status === "fulfilled" && r.value) smartTokens.push(r.value);
        }
      }

      // Sort by number of RWA features (most compliant first)
      smartTokens.sort((a, b) => {
        const aScore = a.features.filter((f) => RWA_FEATURES.includes(f)).length;
        const bScore = b.features.filter((f) => RWA_FEATURES.includes(f)).length;
        return bScore - aScore;
      });

      setTokens(smartTokens);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch tokens");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!fetchedRef.current) {
      fetchedRef.current = true;
      fetchTokens();
    }
  }, [fetchTokens]);

  // Compute stats
  const COMPLIANCE = ["whitelisting", "freezing", "clawback"];
  const featureCounts: Record<string, number> = {};
  let totalSupplyUnits = 0;
  for (const t of tokens) {
    totalSupplyUnits += t.supply;
    for (const f of t.features) {
      featureCounts[f] = (featureCounts[f] || 0) + 1;
    }
  }

  const compliantTokens = tokens.filter((t) =>
    COMPLIANCE.some((f) => t.features.includes(f))
  );

  const stats: RWAStats = {
    totalTokens: tokens.length,
    totalIssuers: new Set(tokens.map((t) => t.issuer)).size,
    compliantTokens: compliantTokens.length,
    totalSupplyUnits,
    featureCounts,
    recentTokens: [...tokens].reverse().slice(0, 10),
    topByFeatures: [...tokens].sort((a, b) => b.features.length - a.features.length).slice(0, 5),
  };

  return {
    tokens,
    stats,
    loading,
    error,
    refresh: fetchTokens,
  };
}
