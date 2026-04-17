"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { categorizeExcludedAddress, fetchAddressStake } from "@/lib/pse-calculator";
import type { ExcludedCategory } from "@/lib/pse-calculator";

interface Props {
  addresses: string[];
}

interface AddressDetail {
  address: string;
  category: ExcludedCategory;
  stake: number;
  loading: boolean;
}

const formatNumber = (n: number) => {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return Math.round(n).toLocaleString();
};

const truncateAddr = (addr: string, head = 10, tail = 8) =>
  addr.length > head + tail + 3 ? `${addr.slice(0, head)}…${addr.slice(-tail)}` : addr;

const CATEGORY_LABELS: Record<ExcludedCategory, { label: string; emoji: string; color: string }> = {
  module:     { label: "PSE Module Account",      emoji: "🏛️", color: "var(--tx-neon)" },
  foundation: { label: "Foundation Staking Pool", emoji: "🏦", color: "#f0b95a" },
  other:      { label: "Others",                  emoji: "📜", color: "#7ec4ff" },
};

export default function ExcludedAddressesPanel({ addresses }: Props) {
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<AddressDetail[]>([]);
  const [drawerAddr, setDrawerAddr] = useState<AddressDetail | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Initialize categories immediately, fetch stakes lazily when expanded
  useEffect(() => {
    if (addresses.length === 0) return;
    setDetails(prev => {
      if (prev.length === addresses.length) return prev;
      return addresses.map(a => ({
        address: a,
        category: categorizeExcludedAddress(a),
        stake: 0,
        loading: false,
      }));
    });
  }, [addresses]);

  // Lazy-load stakes the first time the panel is expanded
  useEffect(() => {
    if (!open || details.length === 0) return;
    const needsLoad = details.some(d => !d.loading && d.stake === 0);
    if (!needsLoad) return;

    let cancelled = false;
    setDetails(prev => prev.map(d => ({ ...d, loading: true })));

    (async () => {
      // Batch in groups of 5 to avoid hammering the LCD
      const batchSize = 5;
      const results: Record<string, number> = {};
      for (let i = 0; i < addresses.length; i += batchSize) {
        const batch = addresses.slice(i, i + batchSize);
        const stakes = await Promise.all(batch.map(a => fetchAddressStake(a)));
        batch.forEach((a, idx) => { results[a] = stakes[idx]; });
        if (cancelled) return;
        // Progressive update so the UI fills in as data arrives
        setDetails(prev => prev.map(d => ({
          ...d,
          stake: results[d.address] ?? d.stake,
          loading: results[d.address] === undefined,
        })));
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const grouped = useMemo(() => {
    const groups: Record<ExcludedCategory, AddressDetail[]> = {
      module: [], foundation: [], other: [],
    };
    for (const d of details) groups[d.category].push(d);
    // Sort each group by stake desc
    for (const key of Object.keys(groups) as ExcludedCategory[]) {
      groups[key].sort((a, b) => b.stake - a.stake);
    }
    return groups;
  }, [details]);

  const totalStake = useMemo(() => details.reduce((s, d) => s + d.stake, 0), [details]);

  const copyAddress = useCallback((addr: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(addr);
      setCopied(addr);
      setTimeout(() => setCopied(null), 1500);
    }
  }, []);

  // Close drawer on Escape
  useEffect(() => {
    if (!drawerAddr) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawerAddr(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerAddr]);

  if (addresses.length === 0) return null;

  return (
    <>
      <div className="excluded-addresses-panel" style={{
        marginTop: 16,
        background: "var(--glass-bg)",
        border: "1px solid var(--glass-border)",
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
      }}>
        {/* Collapsible header */}
        <button
          onClick={() => setOpen(o => !o)}
          style={{
            width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "14px 18px", background: "transparent", border: "none", cursor: "pointer",
            fontFamily: "inherit", color: "inherit", textAlign: "left",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: "1rem" }}>📋</span>
            <div>
              <div style={{ fontSize: "0.82rem", fontWeight: 600 }}>
                {addresses.length} addresses excluded from PSE
              </div>
              <div style={{ fontSize: "0.62rem", color: "var(--text-light)", marginTop: 2 }}>
                Foundation, smart contracts and module accounts that do not receive community PSE
              </div>
            </div>
          </div>
          <span style={{
            fontSize: "0.7rem", color: "var(--text-light)",
            transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s",
            display: "inline-block",
          }}>▶</span>
        </button>

        {/* Expanded list */}
        {open && (
          <div style={{ borderTop: "1px solid var(--glass-border)", padding: "8px 0 16px" }}>
            {(Object.keys(grouped) as ExcludedCategory[]).map(category => {
              const items = grouped[category];
              if (items.length === 0) return null;
              const meta = CATEGORY_LABELS[category];
              return (
                <div key={category} style={{ marginTop: 12 }}>
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "4px 18px 6px",
                    fontSize: "0.62rem", fontWeight: 700,
                    textTransform: "uppercase", letterSpacing: "0.06em",
                    color: meta.color,
                  }}>
                    <span>{meta.emoji}</span>
                    <span>{meta.label}</span>
                    <span style={{ color: "var(--text-light)", fontWeight: 400 }}>· {items.length}</span>
                  </div>
                  {items.map((d) => (
                    <button
                      key={d.address}
                      onClick={() => setDrawerAddr(d)}
                      style={{
                        width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "8px 18px", background: "transparent", border: "none",
                        borderTop: "1px solid rgba(0,0,0,0.04)",
                        cursor: "pointer", textAlign: "left", fontFamily: "inherit",
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = "rgba(0,0,0,0.03)"}
                      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                    >
                      <span style={{
                        fontFamily: "var(--font-mono)", fontSize: "0.7rem",
                        color: "var(--text-medium)",
                      }}>
                        {truncateAddr(d.address)}
                      </span>
                      <span style={{
                        fontFamily: "var(--font-mono)", fontSize: "0.7rem",
                        color: d.stake > 0 ? "var(--text-dark)" : "var(--text-light)",
                      }}>
                        {d.loading ? "…" : d.stake > 0 ? `${formatNumber(d.stake)} TX` : "—"}
                      </span>
                    </button>
                  ))}
                </div>
              );
            })}

            <div style={{
              marginTop: 14, padding: "10px 18px 0",
              borderTop: "1px solid var(--glass-border)",
              display: "flex", justifyContent: "space-between",
              fontSize: "0.65rem", color: "var(--text-light)",
            }}>
              <span>Total excluded stake</span>
              <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--text-dark)" }}>
                {totalStake > 0 ? `${formatNumber(totalStake)} TX` : "Loading…"}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Side drawer */}
      {drawerAddr && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setDrawerAddr(null)}
            style={{
              position: "fixed", inset: 0, zIndex: 9998,
              background: "rgba(0,0,0,0.35)", backdropFilter: "blur(2px)",
            }}
          />
          {/* Drawer panel */}
          <div
            style={{
              position: "fixed", top: 0, right: 0, bottom: 0,
              width: "min(420px, 92vw)", zIndex: 9999,
              background: "#fff", boxShadow: "-12px 0 40px rgba(0,0,0,0.18)",
              padding: "24px 26px", overflowY: "auto",
              animation: "slideInRight 0.18s ease-out",
            }}
          >
            <style>{`
              @keyframes slideInRight {
                from { transform: translateX(100%); }
                to { transform: translateX(0); }
              }
            `}</style>

            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: "1.3rem" }}>{CATEGORY_LABELS[drawerAddr.category].emoji}</span>
                <div>
                  <div style={{ fontSize: "0.62rem", textTransform: "uppercase", color: CATEGORY_LABELS[drawerAddr.category].color, fontWeight: 700, letterSpacing: "0.05em" }}>
                    {CATEGORY_LABELS[drawerAddr.category].label}
                  </div>
                  <div style={{ fontSize: "0.7rem", color: "var(--text-light)", marginTop: 2 }}>
                    Excluded from PSE community rewards
                  </div>
                </div>
              </div>
              <button
                onClick={() => setDrawerAddr(null)}
                aria-label="Close"
                style={{
                  background: "none", border: "none", fontSize: "1.4rem",
                  color: "var(--text-light)", cursor: "pointer", padding: 0, lineHeight: 1,
                }}
              >×</button>
            </div>

            {/* Address block with copy button */}
            <div style={{
              padding: "14px 16px", borderRadius: "var(--radius-sm)",
              background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
              marginBottom: 16,
            }}>
              <div style={{ fontSize: "0.6rem", textTransform: "uppercase", color: "var(--text-light)", letterSpacing: "0.06em", marginBottom: 6 }}>
                Address
              </div>
              <div style={{
                fontFamily: "var(--font-mono)", fontSize: "0.74rem",
                wordBreak: "break-all", color: "var(--text-dark)", lineHeight: 1.5,
              }}>
                {drawerAddr.address}
              </div>
              <button
                onClick={() => copyAddress(drawerAddr.address)}
                style={{
                  marginTop: 10, padding: "6px 12px", borderRadius: "var(--radius-pill)",
                  border: "1px solid var(--glass-border)", background: "rgba(255,255,255,0.5)",
                  cursor: "pointer", fontSize: "0.68rem", fontWeight: 600,
                  color: copied === drawerAddr.address ? "var(--accent-olive)" : "var(--text-medium)",
                }}
              >
                {copied === drawerAddr.address ? "✓ Copied" : "Copy address"}
              </button>
            </div>

            {/* Stake stat */}
            <div style={{
              padding: "14px 16px", borderRadius: "var(--radius-sm)",
              background: "var(--tx-dark-green)", marginBottom: 16,
            }}>
              <div style={{ fontSize: "0.6rem", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", letterSpacing: "0.06em", marginBottom: 4 }}>
                Delegated stake
              </div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "1.4rem", fontWeight: 700, color: "var(--tx-neon)" }}>
                {drawerAddr.loading ? "Loading…" : drawerAddr.stake > 0 ? `${formatNumber(drawerAddr.stake)} TX` : "0 TX"}
              </div>
              <div style={{ fontSize: "0.6rem", color: "rgba(255,255,255,0.45)", marginTop: 4 }}>
                Excluded from the PSE eligible bonded pool
              </div>
            </div>

            {/* Why excluded */}
            <div style={{
              padding: "12px 14px", borderRadius: "var(--radius-sm)",
              background: "rgba(255,180,0,0.06)", border: "1px solid rgba(255,180,0,0.15)",
              marginBottom: 16,
            }}>
              <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#c4a96a", marginBottom: 4 }}>
                Why is this address excluded?
              </div>
              <div style={{ fontSize: "0.66rem", color: "var(--text-medium)", lineHeight: 1.6 }}>
                The TX chain&apos;s on-chain PSE params (<code style={{ fontSize: "0.62rem" }}>tx/pse/v1/params</code>) explicitly skip this address when computing community PSE rewards.
                {drawerAddr.category === "module" && " It belongs to the PSE module account, which holds the pre-minted PSE pool on behalf of the protocol."}
                {drawerAddr.category === "foundation" && (
                  <>
                    {" "}It is a Foundation staking pool address, excluded from PSE distribution by governance{" "}
                    <a
                      href="https://www.mintscan.io/coreum/proposals/40"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "var(--accent-olive)", fontWeight: 600, textDecoration: "underline" }}
                    >
                      proposal #40
                    </a>
                    . The Foundation created a pool of addresses to be used for staking, and these are not eligible for community PSE rewards.
                  </>
                )}
                {drawerAddr.category === "other" && " It is a smart contract, module account, or other address designated by governance as ineligible for community PSE rewards."}
              </div>
            </div>

            {/* External link CTA */}
            <a
              href={`https://www.mintscan.io/coreum/address/${drawerAddr.address}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                width: "100%", padding: "12px", borderRadius: "var(--radius-pill)",
                background: "var(--tx-dark-green)", color: "var(--tx-neon)",
                textDecoration: "none", fontWeight: 600, fontSize: "0.78rem",
                border: "1px solid rgba(177,252,3,0.25)",
              }}
            >
              Open on Mintscan ↗
            </a>
            <div style={{ fontSize: "0.58rem", color: "var(--text-light)", textAlign: "center", marginTop: 8 }}>
              Opens in a new tab
            </div>
          </div>
        </>
      )}
    </>
  );
}
