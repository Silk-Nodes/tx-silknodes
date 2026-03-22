"use client";

import { useState } from "react";
import type { ValidatorInfo } from "@/lib/types";
import { SILK_NODES_VALIDATOR } from "@/lib/chain-config";

interface ValidatorsPageProps {
  validators: ValidatorInfo[];
  loading: boolean;
  txPrice: number;
  inflation: number;
}

function formatNumber(num: number): string {
  if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(1)}K`;
  return num.toLocaleString();
}

function formatUSD(num: number): string {
  if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(1)}K`;
  if (num >= 1) return `$${num.toFixed(0)}`;
  return `$${num.toFixed(2)}`;
}

export default function ValidatorsPage({
  validators,
  loading,
  txPrice,
  inflation,
}: ValidatorsPageProps) {
  const [sortBy, setSortBy] = useState<"tokens" | "commission" | "income">("tokens");
  const [search, setSearch] = useState("");

  const sorted = [...validators]
    .filter((v) => v.moniker.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === "commission") return a.commission - b.commission;
      if (sortBy === "income") return (b.estimatedMonthlyIncomeUSD || 0) - (a.estimatedMonthlyIncomeUSD || 0);
      return b.tokens - a.tokens;
    });

  const totalBonded = validators.reduce((s, v) => s + v.tokens, 0);

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <span className="label" style={{ display: "block", marginBottom: 4 }}>
            ACTIVE VALIDATOR SET
          </span>
          <span className="value-large mono">
            {loading ? "---" : validators.length} Validators
          </span>
        </div>
        <div style={{ textAlign: "right" }}>
          <span className="label" style={{ display: "block", marginBottom: 4 }}>
            TOTAL BONDED
          </span>
          <span className="value-large mono">
            {loading ? "---" : formatNumber(totalBonded)} TX
          </span>
        </div>
      </div>

      {/* Disclaimer */}
      <div
        style={{
          padding: "12px 16px",
          background: "rgba(191, 255, 0, 0.03)",
          border: "1px solid rgba(191, 255, 0, 0.1)",
          borderRadius: 2,
          marginBottom: 16,
        }}
      >
        <span className="text-body">
          Est. monthly income = validator&apos;s share of bonded tokens &times; annual staking provisions &times; commission rate &divide; 12.
          Inflation is currently <span className="color-accent">{inflation.toFixed(4)}%</span> &mdash; this rate adjusts dynamically based on the 67% bonding goal.
          Income figures are estimates and will change as inflation, staking ratio, and TX price fluctuate.
        </span>
      </div>

      {/* Search & Sort */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <div className="input-group" style={{ flex: 1, marginBottom: 0 }}>
          <div className="input-addon label">SEARCH</div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Validator name..."
            style={{ fontSize: 12 }}
          />
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {(["tokens", "commission", "income"] as const).map((key) => (
            <button
              key={key}
              className={`btn ${sortBy === key ? "primary" : ""}`}
              style={{ width: "auto", marginTop: 0, padding: "0 12px", height: 40, fontSize: 9 }}
              onClick={() => setSortBy(key)}
            >
              {key === "tokens" ? "VOTING PWR" : key === "commission" ? "COMMISSION" : "INCOME"}
            </button>
          ))}
        </div>
      </div>

      {/* Validator Table */}
      <div style={{ overflowX: "auto" }}>
        <table className="data-table label" style={{ minWidth: 800 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", width: 40 }}>#</th>
              <th style={{ textAlign: "left" }}>Validator</th>
              <th>Voting Power</th>
              <th>% of Total</th>
              <th>Commission</th>
              <th>Est. Monthly Income</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", padding: 40 }}>
                  <span className="label">LOADING VALIDATOR SET...</span>
                </td>
              </tr>
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", padding: 40 }}>
                  <span className="label">NO VALIDATORS FOUND</span>
                </td>
              </tr>
            ) : (
              sorted.map((val, idx) => {
                const isSilk = val.operatorAddress === SILK_NODES_VALIDATOR;
                return (
                  <tr
                    key={val.operatorAddress}
                    style={{
                      background: isSilk ? "rgba(191, 255, 0, 0.06)" : undefined,
                      borderLeft: isSilk ? "2px solid var(--accent)" : undefined,
                    }}
                  >
                    <td style={{ textAlign: "left" }}>
                      <span className="mono" style={{ fontSize: 11 }}>
                        {idx + 1}
                      </span>
                    </td>
                    <td style={{ textAlign: "left" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {isSilk && <span className="dot orange" />}
                        <span
                          className="mono"
                          style={{
                            fontSize: 12,
                            fontWeight: isSilk ? 700 : 400,
                            color: isSilk ? "var(--accent)" : "#fff",
                          }}
                        >
                          {val.moniker}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="mono" style={{ fontSize: 11 }}>
                        {formatNumber(val.tokens)} TX
                      </span>
                    </td>
                    <td>
                      <span className="mono" style={{ fontSize: 11 }}>
                        {val.tokensPct.toFixed(2)}%
                      </span>
                    </td>
                    <td>
                      <span
                        className="mono"
                        style={{
                          fontSize: 11,
                          color: val.commission <= 5 ? "var(--accent)" : val.commission >= 20 ? "#ff6b6b" : "#fff",
                        }}
                      >
                        {val.commission.toFixed(0)}%
                      </span>
                    </td>
                    <td>
                      <span className="mono" style={{ fontSize: 11 }}>
                        {txPrice > 0 && val.estimatedMonthlyIncomeUSD !== undefined
                          ? formatUSD(val.estimatedMonthlyIncomeUSD)
                          : "---"}
                      </span>
                    </td>
                    <td>
                      {isSilk ? (
                        <button
                          className="btn primary"
                          style={{
                            width: "auto",
                            marginTop: 0,
                            padding: "0 12px",
                            height: 28,
                            fontSize: 9,
                          }}
                          onClick={() =>
                            window.open(
                              "https://wallet.keplr.app/chains/coreum?modal=validator&chain=coreum-mainnet-1&validator_address=" +
                                val.operatorAddress,
                              "_blank"
                            )
                          }
                        >
                          DELEGATE
                        </button>
                      ) : (
                        <button
                          className="btn"
                          style={{
                            width: "auto",
                            marginTop: 0,
                            padding: "0 8px",
                            height: 28,
                            fontSize: 9,
                            opacity: 0.5,
                          }}
                          onClick={() =>
                            window.open(
                              `https://www.mintscan.io/coreum/validators/${val.operatorAddress}`,
                              "_blank"
                            )
                          }
                        >
                          VIEW
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
