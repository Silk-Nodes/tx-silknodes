"use client";

import { useState, useEffect, useMemo } from "react";
import Tooltip from "@/components/Tooltip";

interface ValidatorEntry {
  operatorAddress: string;
  moniker: string;
  tokens: number;
  commission: number;
  identity: string;
  website: string;
  details: string;
  status: string;
}

interface ChainEconomics {
  annualProvisions: number;
  communityTax: number;
  totalBonded: number;
  inflation: number;
  txPrice: number;
}

type SortField = "moniker" | "tokens" | "commission" | "monthlyIncome" | "delegatorApr";
type SortDir = "asc" | "desc";

const LCD = "https://full-node.mainnet-1.coreum.dev:1317";
const SILK_OPERATOR = "corevaloper1kepnaw38rymdvq5sstnnytdqqkpd0xxwc5eqjk";

export default function ValidatorList({ wallet, setActiveTab, setShowWalletModal }: { wallet?: any; setActiveTab?: (tab: string) => void; setShowWalletModal?: (show: boolean) => void }) {
  const [validators, setValidators] = useState<ValidatorEntry[]>([]);
  const [economics, setEconomics] = useState<ChainEconomics | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState<SortField>("tokens");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [commissionFilter, setCommissionFilter] = useState<string>("all");
  const PER_PAGE = 15;

  useEffect(() => {
    async function fetchAll() {
      try {
        const allVals: ValidatorEntry[] = [];
        let paginationKey = "";
        let hasMore = true;

        while (hasMore) {
          const keyParam = paginationKey
            ? `&pagination.key=${encodeURIComponent(paginationKey)}`
            : "";
          const resp = await fetch(
            `${LCD}/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=100${keyParam}`
          );
          const result = await resp.json();
          const pg = (result.validators || []).map((v: any) => ({
            operatorAddress: v.operator_address,
            moniker: v.description?.moniker || "Unknown",
            tokens: parseInt(v.tokens || "0") / 1e6,
            commission: parseFloat(v.commission?.commission_rates?.rate || "0"),
            identity: v.description?.identity || "",
            website: v.description?.website || "",
            details: v.description?.details || "",
            status: v.status,
          }));
          allVals.push(...pg);
          paginationKey = result.pagination?.next_key || "";
          hasMore = !!paginationKey;
        }

        setValidators(allVals);

        const [provRes, distRes, poolRes, priceRes] = await Promise.all([
          fetch(`${LCD}/cosmos/mint/v1beta1/annual_provisions`),
          fetch(`${LCD}/cosmos/distribution/v1beta1/params`),
          fetch(`${LCD}/cosmos/staking/v1beta1/pool`),
          fetch("https://api.coingecko.com/api/v3/simple/price?ids=tx&vs_currencies=usd"),
        ]);

        const prov = await provRes.json();
        const dist = await distRes.json();
        const pool = await poolRes.json();
        const price = await priceRes.json();

        const annualProvisions = parseFloat(prov.annual_provisions || "0") / 1e6;
        const communityTax = parseFloat(dist.params?.community_tax || "0.05");
        const totalBonded = parseInt(pool.pool?.bonded_tokens || "0") / 1e6;

        const inflRes = await fetch(`${LCD}/cosmos/mint/v1beta1/inflation`);
        const infl = await inflRes.json();

        setEconomics({
          annualProvisions,
          communityTax,
          totalBonded,
          inflation: parseFloat(infl.inflation || "0"),
          txPrice: price.tx?.usd || 0,
        });
      } catch (err) {
        console.error("Failed to fetch validators:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchAll();
  }, []);

  const validatorsWithIncome = useMemo(() => {
    if (!economics) return validators.map((v) => ({ ...v, monthlyIncome: 0, delegatorApr: 0, votingPowerPct: 0, monthlyIncomeUsd: 0 }));

    const { annualProvisions, communityTax, totalBonded, txPrice } = economics;
    const totalRewardsAnnual = annualProvisions * (1 - communityTax);

    return validators.map((v) => {
      const votingPowerShare = totalBonded > 0 ? v.tokens / totalBonded : 0;
      const validatorAnnualRewards = totalRewardsAnnual * votingPowerShare;
      const commissionIncome = validatorAnnualRewards * v.commission;
      const monthlyIncome = commissionIncome / 12;
      const delegatorRewards = validatorAnnualRewards * (1 - v.commission);
      const delegatorApr = v.tokens > 0 ? (delegatorRewards / v.tokens) * 100 : 0;

      return {
        ...v,
        monthlyIncome,
        monthlyIncomeUsd: monthlyIncome * txPrice,
        delegatorApr,
        votingPowerPct: votingPowerShare * 100,
      };
    });
  }, [validators, economics]);

  // Find Silk node data
  const silkNode = validatorsWithIncome.find((v) => v.operatorAddress === SILK_OPERATOR);
  const maxTokens = validatorsWithIncome.length > 0 ? Math.max(...validatorsWithIncome.map((v) => v.tokens)) : 1;

  // Network stats
  const avgCommission = validatorsWithIncome.length > 0
    ? validatorsWithIncome.reduce((s, v) => s + v.commission, 0) / validatorsWithIncome.length
    : 0;

  const sortedValidators = useMemo(() => {
    let filtered = validatorsWithIncome;
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter((v) => v.moniker.toLowerCase().includes(q));
    }
    if (commissionFilter === "low") filtered = filtered.filter((v) => v.commission <= 0.05);
    else if (commissionFilter === "mid") filtered = filtered.filter((v) => v.commission > 0.05 && v.commission <= 0.10);
    else if (commissionFilter === "high") filtered = filtered.filter((v) => v.commission > 0.10);

    return [...filtered].sort((a, b) => {
      const aVal = a[sortField] ?? 0;
      const bVal = b[sortField] ?? 0;
      if (typeof aVal === "string" && typeof bVal === "string") return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      return sortDir === "asc" ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });
  }, [validatorsWithIncome, sortField, sortDir, search, commissionFilter]);

  const totalPages = Math.ceil(sortedValidators.length / PER_PAGE);
  const paginatedValidators = sortedValidators.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("desc"); }
  };

  const fmt = (n: number): string => {
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
    return n.toFixed(0);
  };

  const fmtUsd = (n: number): string => n >= 1000 ? `$${(n / 1000).toFixed(1)}K` : `$${n.toFixed(0)}`;
  const sortIcon = (field: SortField) => sortField !== field ? "" : sortDir === "asc" ? " ▲" : " ▼";

  return (
    <div style={{ position: "relative", minHeight: loading ? 500 : undefined }}>
      {/* Blurred overlay while loading */}
      {loading && (
        <>
          <div style={{
            position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
            zIndex: 10, backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
            background: "rgba(237,233,224,0.4)",
            borderRadius: 12,
          }} />
          <div style={{
            position: "absolute", top: "50%", left: "50%",
            transform: "translate(-50%, -50%)", zIndex: 11,
            textAlign: "center",
          }}>
            <div style={{
              width: 40, height: 40, border: "3px solid rgba(177,252,3,0.2)",
              borderTop: "3px solid var(--tx-neon)", borderRadius: "50%",
              animation: "spin 1s linear infinite",
              margin: "0 auto 14px",
            }} />
            <div style={{
              fontSize: "1.1rem", fontWeight: 700, color: "var(--tx-dark-green)",
              letterSpacing: "0.08em",
            }}>
              Loading validator set...
            </div>
            <div style={{ fontSize: "0.68rem", opacity: 0.45, marginTop: 6 }}>
              Fetching {">"}100 active validators from TX mainnet
            </div>
          </div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </>
      )}
      {/* Hero Stats Row */}
      <div className="responsive-grid-4" style={{ gap: 12, marginBottom: 16 }}>
        <div style={{
          padding: "14px 16px", borderRadius: 12,
          background: "rgba(255,255,255,0.4)", border: "1px solid rgba(0,0,0,0.04)",
        }}>
          <div style={{ fontSize: "0.6rem", opacity: 0.4, textTransform: "uppercase", letterSpacing: "0.04em" }}>Active Validators</div>
          <div style={{ fontSize: "1.8rem", fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--tx-dark-green)", marginTop: 4 }}>
            {validators.length}
          </div>
        </div>
        <div style={{
          padding: "14px 16px", borderRadius: 12,
          background: "rgba(255,255,255,0.4)", border: "1px solid rgba(0,0,0,0.04)",
        }}>
          <div style={{ fontSize: "0.6rem", opacity: 0.4, textTransform: "uppercase", letterSpacing: "0.04em" }}>Total Bonded</div>
          <div style={{ fontSize: "1.8rem", fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--tx-dark-green)", marginTop: 4 }}>
            {fmt(economics?.totalBonded || 0)}
          </div>
          <div style={{ fontSize: "0.55rem", opacity: 0.35, marginTop: 2 }}>
            {economics?.txPrice ? `~${fmtUsd((economics.totalBonded || 0) * economics.txPrice)}` : ""}
          </div>
        </div>
        <div style={{
          padding: "14px 16px", borderRadius: 12,
          background: "rgba(255,255,255,0.4)", border: "1px solid rgba(0,0,0,0.04)",
        }}>
          <div style={{ fontSize: "0.6rem", opacity: 0.4, textTransform: "uppercase", letterSpacing: "0.04em" }}>Avg Commission</div>
          <div style={{ fontSize: "1.8rem", fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--tx-dark-green)", marginTop: 4 }}>
            {(avgCommission * 100).toFixed(1)}%
          </div>
        </div>
        <div style={{
          padding: "14px 16px", borderRadius: 12,
          background: "rgba(255,255,255,0.4)", border: "1px solid rgba(0,0,0,0.04)",
        }}>
          <div style={{ fontSize: "0.6rem", opacity: 0.4, textTransform: "uppercase", letterSpacing: "0.04em" }}>Base APR</div>
          <div style={{ fontSize: "1.8rem", fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--accent-olive)", marginTop: 4 }}>
            {validatorsWithIncome.length > 0 ? validatorsWithIncome[0].delegatorApr.toFixed(1) : "---"}%
          </div>
          <Tooltip text="PSE rewards are added on top of base APR" position="bottom" />
        </div>
      </div>

      {/* Silk Nodes Spotlight */}
      {silkNode && (
        <div style={{
          marginBottom: 16, padding: "16px 20px", borderRadius: 12,
          background: "var(--tx-dark-green)", color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          flexWrap: "wrap", gap: 12,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <img
              src="/silk-nodes-logo.png"
              alt="Silk Nodes"
              style={{
                width: 42, height: 42, borderRadius: 10,
                objectFit: "contain", filter: "invert(1)",
              }}
            />
            <div>
              <div style={{ fontWeight: 700, fontSize: "1rem" }}>
                Silk Nodes
                <span style={{
                  marginLeft: 8, padding: "2px 8px", borderRadius: 10,
                  background: "rgba(177,252,3,0.15)", color: "var(--tx-neon)",
                  fontSize: "0.55rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em",
                }}>Recommended</span>
              </div>
              <div style={{ fontSize: "0.65rem", opacity: 0.5, marginTop: 2 }}>
                Professional validator · Infrastructure provider
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "0.55rem", opacity: 0.4 }}>Commission</div>
              <div style={{ fontSize: "1.1rem", fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--tx-neon)" }}>
                {(silkNode.commission * 100).toFixed(1)}%
              </div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "0.55rem", opacity: 0.4 }}>Delegator APR</div>
              <div style={{ fontSize: "1.1rem", fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--tx-neon-light)" }}>
                {silkNode.delegatorApr.toFixed(2)}%
              </div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "0.55rem", opacity: 0.4 }}>Voting Power</div>
              <div style={{ fontSize: "1.1rem", fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--tx-neon-light)" }}>
                {fmt(silkNode.tokens)}
              </div>
            </div>
            <button
              onClick={() => {
                if (wallet?.connected && setActiveTab) {
                  setActiveTab("portfolio");
                } else if (setShowWalletModal) {
                  setShowWalletModal(true);
                }
              }}
              style={{
                padding: "8px 20px", borderRadius: 8, border: "none",
                background: "var(--tx-neon)", color: "var(--tx-dark-green)",
                fontWeight: 700, fontSize: "0.75rem", cursor: "pointer",
              }}
            >
              {wallet?.connected ? "Stake with us" : "Connect Wallet to Stake"}
            </button>
          </div>
        </div>
      )}

      {/* Search + Filters */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <div className="field-input" style={{ flex: 1 }}>
          <span className="field-addon">Search</span>
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Validator name..."
          />
          <span className="field-addon">{sortedValidators.length}/{validators.length}</span>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {[
            { key: "all", label: "All" },
            { key: "low", label: "≤5%" },
            { key: "mid", label: "5-10%" },
            { key: "high", label: ">10%" },
          ].map((f) => (
            <button
              key={f.key}
              className={`filter-chip ${commissionFilter === f.key ? "active" : ""}`}
              onClick={() => { setCommissionFilter(f.key); setPage(1); }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto" }}>
        <table className="validator-table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>#</th>
              <th onClick={() => handleSort("moniker")} style={{ minWidth: 160 }}>Validator{sortIcon("moniker")}</th>
              <th onClick={() => handleSort("tokens")} style={{ minWidth: 200 }}>Voting Power{sortIcon("tokens")}</th>
              <th onClick={() => handleSort("commission")}>Commission{sortIcon("commission")}</th>
              <th onClick={() => handleSort("delegatorApr")}>Your APR{sortIcon("delegatorApr")}</th>
              <th onClick={() => handleSort("monthlyIncome")}>Validator Income{sortIcon("monthlyIncome")}</th>
            </tr>
          </thead>
          <tbody>
            {paginatedValidators.map((v, i) => {
              const globalIndex = (page - 1) * PER_PAGE + i;
              const isSilk = v.operatorAddress === SILK_OPERATOR;
              const powerBarWidth = maxTokens > 0 ? (v.tokens / maxTokens) * 100 : 0;
              return (
                <tr key={v.operatorAddress} className={isSilk ? "silk-row" : ""}>
                  <td style={{ color: "var(--ink-muted)", textAlign: "center", fontSize: "0.75rem" }}>{globalIndex + 1}</td>
                  <td>
                    <div style={{ fontWeight: isSilk ? 700 : 500, fontSize: "0.85rem" }}>
                      {v.moniker}
                      {isSilk && <span className="silk-badge">Our Node</span>}
                    </div>
                    {v.website && (
                      <div style={{ fontSize: "0.6rem", opacity: 0.3, marginTop: 1 }}>
                        {v.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                      </div>
                    )}
                  </td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.85rem", fontWeight: 600, minWidth: 52 }}>
                        {fmt(v.tokens)}
                      </div>
                      <div style={{
                        flex: 1, height: 6, borderRadius: 3,
                        background: "rgba(0,0,0,0.04)",
                        overflow: "hidden",
                      }}>
                        <div style={{
                          height: "100%", borderRadius: 3,
                          width: `${powerBarWidth}%`,
                          background: isSilk
                            ? "var(--tx-neon)"
                            : powerBarWidth > 5
                            ? "var(--accent-olive)"
                            : "var(--tx-subtle)",
                          transition: "width 0.3s",
                        }} />
                      </div>
                    </div>
                    <div style={{ fontSize: "0.6rem", opacity: 0.35, fontFamily: "var(--font-mono)", marginTop: 2 }}>
                      {v.votingPowerPct.toFixed(2)}%
                    </div>
                  </td>
                  <td>
                    <span style={{
                      fontFamily: "var(--font-mono)", fontSize: "0.85rem", fontWeight: 600,
                      padding: "2px 8px", borderRadius: 6,
                      background: v.commission <= 0.05
                        ? "rgba(177,252,3,0.1)"
                        : v.commission >= 0.1
                        ? "rgba(180,74,62,0.08)"
                        : "transparent",
                      color: v.commission <= 0.05
                        ? "var(--accent-olive)"
                        : v.commission >= 0.1
                        ? "#b44a3e"
                        : "var(--text-dark)",
                    }}>
                      {(v.commission * 100).toFixed(1)}%
                    </span>
                  </td>
                  <td>
                    <div style={{
                      fontFamily: "var(--font-mono)", fontSize: "0.9rem", fontWeight: 700,
                      color: "var(--accent-olive)",
                    }}>
                      {v.delegatorApr.toFixed(2)}%
                    </div>
                    <div style={{ fontSize: "0.55rem", opacity: 0.3, marginTop: 1 }}>+ PSE</div>
                  </td>
                  <td>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.82rem", fontWeight: 500 }}>
                      {fmt(v.monthlyIncome)} TX
                    </div>
                    <div style={{ fontSize: "0.6rem", color: "var(--accent-olive)", opacity: 0.7, marginTop: 1 }}>
                      ~{fmtUsd(v.monthlyIncomeUsd)}/mo
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="pagination">
          <span className="pagination-info">Page {page}/{totalPages} ({sortedValidators.length} validators)</span>
          <div style={{ display: "flex", gap: 4 }}>
            <button className="page-btn" disabled={page <= 1} onClick={() => setPage(1)}>First</button>
            <button className="page-btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</button>
            <button className="page-btn" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next →</button>
            <button className="page-btn" disabled={page >= totalPages} onClick={() => setPage(totalPages)}>Last</button>
          </div>
        </div>
      )}

      {/* Bottom note */}
      <div style={{ marginTop: 12, fontSize: "0.6rem", opacity: 0.3, textAlign: "center" }}>
        APR shown is base staking APR only. PSE rewards are additional and depend on your stake duration and network participation.
        Validator Income = commission earned from delegator rewards.
      </div>
    </div>
  );
}
