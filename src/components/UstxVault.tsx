"use client";

// The USTX vault half of /earn: an estimator on the left, the vault's live
// state below. Every figure comes from /api/ustx-vault, which reads the
// contract.
//
// What the dollar figure is, exactly: each day the contract credits
// amount * rate / 365 dollars' worth of TX at that day's oracle price, and
// the TX is paid when the lock ends. So the headline is the reward's value
// as it accrues, and the TX count is that figure at today's price. What the
// TX is worth on payout day depends on the price then, which the copy says.
//
// Checked on 2026-11-18 against all 23 open positions: the formula matches
// the contract's own daily rewards and projected totals to 1 part in a
// million. Payout at the end of a lock and nothing for an early exit were
// both observed: 7 of 7 early exits on mainnet paid 0, and the testnet
// copies of this contract pay the reward in TX when a lock is settled.

import { useEffect, useState } from "react";
import Link from "next/link";
import type { VaultState } from "@/lib/ustx-vault";
import AmountInput from "@/components/AmountInput";
import { amountOf, vaultReward } from "@/lib/earn-math";

const REFRESH_MS = 5 * 60_000;
const PRESETS: [number, string][] = [[100, "100"], [1_000, "1K"], [5_000, "5K"], [20_000, "20K"]];

export function useUstxVault(): { vault: VaultState | null; error: string | null } {
  const [vault, setVault] = useState<VaultState | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/ustx-vault", { cache: "no-store" });
        const j = await res.json();
        if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
        if (alive) { setVault(j as VaultState); setError(null); }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return { vault, error };
}

const num = (n: number, d = 0) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const usd = (n: number) => (n >= 1000 ? `$${num(n)}` : n >= 0.01 ? `$${n.toFixed(2)}` : "< $0.01");
const day = (iso: string | number) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

const label: React.CSSProperties = { fontSize: "0.58rem", color: "var(--text-light)", textTransform: "uppercase", letterSpacing: "0.05em" };
const chip = (on: boolean): React.CSSProperties => ({
  padding: "6px 12px", borderRadius: 999, fontSize: "0.68rem", fontFamily: "var(--font-mono)", cursor: "pointer",
  border: `1px solid ${on ? "var(--text-accent)" : "var(--glass-border)"}`,
  background: "transparent", color: on ? "var(--text-accent)" : "var(--text-dark)",
  fontWeight: on ? 700 : 400, whiteSpace: "nowrap",
});
const pill = (color: string): React.CSSProperties => ({
  padding: "4px 10px", borderRadius: 999, fontSize: "0.64rem", fontFamily: "var(--font-mono)", fontWeight: 700,
  color, border: `1px solid ${color}`, whiteSpace: "nowrap",
});

// Stat cards under the estimator. Four across, two on a tablet, one on a
// phone, so no card is ever a lone orphan in its row.
const CSS = `
  .vault-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-top: 16px; }
  @media (max-width: 1024px) { .vault-stats { grid-template-columns: repeat(2, 1fr); } }
  @media (max-width: 520px) { .vault-stats { grid-template-columns: 1fr; } }
`;

function StatCard({ k, v, children }: { k: string; v: string; children: React.ReactNode }) {
  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <div style={label}>{k}</div>
      <div style={{ fontSize: "1.5rem", fontWeight: 800, lineHeight: 1.1, fontFamily: "var(--font-mono)", color: "var(--text-dark)" }}>{v}</div>
      <div style={{ fontSize: "0.68rem", lineHeight: 1.5, color: "var(--text-medium)" }}>{children}</div>
    </div>
  );
}

export default function UstxVault({ vault, error }: { vault: VaultState | null; error: string | null }) {
  const [raw, setRaw] = useState("1000");
  const [days, setDays] = useState(90);
  const [boosted, setBoosted] = useState(true);

  if (!vault) {
    return (
      <div className="panel" style={{ minHeight: 160, display: "flex", alignItems: "center", color: "var(--text-medium)", fontSize: "0.85rem" }}>
        {error ? `${error} Nothing is shown in its place. Try again in a few minutes.` : "Reading the vault contract..."}
      </div>
    );
  }

  const amount = amountOf(raw);
  const term = vault.terms.find((t) => t.days === days) ?? vault.terms[vault.terms.length - 1];
  const pct = boosted ? term.boostedPct : term.basePct;
  const earn = (p: number, d: number) => vaultReward(amount, p, d);
  const rewardUsd = earn(pct, term.days);
  const rewardTx = vault.oraclePrice > 0 ? rewardUsd / vault.oraclePrice : 0;
  const problem =
    amount <= 0 ? "Enter an amount to lock."
      : amount < vault.minStake ? `The vault takes ${num(vault.minStake)} USTX or more.`
        : amount > vault.maxPerWallet ? `One wallet can lock up to ${num(vault.maxPerWallet)} USTX.`
          : null;
  const share = vault.ustxSupply ? (vault.lockedUstx / vault.ustxSupply) * 100 : null;
  const who = boosted ? "verified wallet" : "unverified wallet";
  // The ladder: what this amount earns on every term at both rates, so the
  // cost of a shorter lock or an unverified wallet is visible before choosing.
  const ladderMax = Math.max(...vault.terms.map((t) => earn(t.boostedPct, t.days)), 1e-9);
  const used = vault.terms.filter((t) => t.ustx > 0).sort((a, b) => b.ustx - a.ustx);
  const funded = vault.rewardPoolTx >= vault.earnedTx && vault.rewardPoolTx > 0;
  const readAt = new Date(vault.checkedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

  return (
    <>
      <style>{CSS}</style>
      {vault.stale && (
        <div role="status" style={{ marginBottom: 12, padding: "10px 14px", borderRadius: 10, border: "1px solid var(--warn-text)", color: "var(--warn-text)", fontSize: "0.74rem" }}>
          The vault contract cannot be reached right now. These figures are from the last successful read, {day(vault.checkedAt)} at {readAt} UTC.
        </div>
      )}
      <div className="grid-12" style={{ alignItems: "stretch" }}>
        {/* Left: the estimate's inputs */}
        <div className="col-5" style={{ display: "flex" }}>
          <div className="panel" style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 20 }}>
            <div>
              <div style={label}>USTX to lock</div>
              <div style={{ marginTop: 8 }}>
                <AmountInput value={raw} onChange={setRaw} unit="USTX" ariaLabel="USTX to lock" />
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                {PRESETS.map(([v, l]) => (
                  <button key={v} type="button" aria-pressed={amount === v} style={chip(amount === v)} onClick={() => setRaw(String(v))}>{l}</button>
                ))}
              </div>
            </div>

            <div>
              <div style={label}>Lock for</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                {vault.terms.map((t) => (
                  <button key={t.days} type="button" aria-pressed={term.days === t.days} style={chip(term.days === t.days)} onClick={() => setDays(t.days)}>{t.days} days</button>
                ))}
              </div>
              <div style={{ ...label, marginTop: 16 }}>Your wallet is</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                <button type="button" aria-pressed={boosted} style={chip(boosted)} onClick={() => setBoosted(true)}>Verified</button>
                <button type="button" aria-pressed={!boosted} style={chip(!boosted)} onClick={() => setBoosted(false)}>Not verified</button>
              </div>
            </div>

            <div style={{ fontSize: "0.62rem", lineHeight: 1.6, color: "var(--text-light)", paddingTop: 14, borderTop: "1px solid var(--glass-border)" }}>
              Rates and limits ({num(vault.minStake)} to {num(vault.maxPerWallet)} USTX per wallet) are the contract&apos;s own. Verified wallets are the ones TX has added
              to its allowlist. The reward builds up in TX each day at that day&apos;s oracle price and is paid when the lock ends, so its dollar value on that day moves
              with the TX price. Every early exit up to 18 Nov 2026 returned the USTX and paid no reward.
            </div>
          </div>
        </div>

        {/* Right: the result and the rate ladder */}
        <div className="col-7" style={{ display: "flex" }}>
          <div className="panel" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <div style={label}>Reward earned over {term.days} days, {who}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
              {problem ? (
                <span style={{ fontSize: "1.1rem", color: "var(--text-medium)", padding: "14px 0" }}>{problem}</span>
              ) : (
                <>
                  <span style={{ fontSize: "3rem", fontWeight: 800, lineHeight: 1, letterSpacing: "-0.02em", fontFamily: "var(--font-mono)", color: "var(--text-accent)", textShadow: "0 0 28px rgba(177,252,3,0.28)" }}>
                    +{usd(rewardUsd)}
                  </span>
                  <span style={{ fontSize: "1rem", color: "var(--text-medium)" }}>≈ {num(rewardTx)} TX at today&apos;s price</span>
                </>
              )}
            </div>
            {!problem && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                <span style={pill("var(--text-accent)")}>{pct.toFixed(2)}% a year</span>
                <span style={pill("var(--text-medium)")}>paid {day(Date.now() + term.days * 86_400_000)} if you start today</span>
              </div>
            )}

            <div style={{ marginTop: 20, flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-around", gap: 12, opacity: problem ? 0.35 : 1 }}>
              {vault.terms.map((t) => (
                <div key={t.days} style={{ display: "grid", gridTemplateColumns: "64px 1fr", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: "0.72rem", fontFamily: "var(--font-mono)", color: "var(--text-dark)", fontWeight: t.days === term.days ? 700 : 400 }}>{t.days} days</span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    {([[true, t.boostedPct], [false, t.basePct]] as const).map(([b, p]) => {
                      const on = t.days === term.days && b === boosted;
                      return (
                        <button
                          key={String(b)}
                          type="button"
                          aria-pressed={on}
                          aria-label={`${t.days} days, ${b ? "verified" : "not verified"}, ${p.toFixed(2)}%`}
                          onClick={() => { setDays(t.days); setBoosted(b); }}
                          style={{ display: "flex", alignItems: "center", gap: 10, padding: 0, border: 0, background: "transparent", cursor: "pointer", minWidth: 0 }}
                        >
                          <span style={{
                            height: 14, borderRadius: 7, boxSizing: "border-box", minWidth: 6, opacity: on ? 1 : 0.55,
                            width: `calc((100% - 150px) * ${earn(p, t.days) / ladderMax})`,
                            // Solid is verified, outlined is not: the pair reads without colour.
                            background: b ? "var(--text-accent)" : on ? "var(--accent-olive-light)" : "transparent",
                            border: b ? "none" : "1.5px solid var(--text-accent)",
                            boxShadow: on ? "0 0 14px rgba(177,252,3,0.25)" : "none",
                          }} />
                          <span style={{ fontSize: "0.7rem", fontFamily: "var(--font-mono)", color: on ? "var(--text-dark)" : "var(--text-medium)", fontWeight: on ? 700 : 400, whiteSpace: "nowrap" }}>
                            {usd(earn(p, t.days))} at {p.toFixed(2)}%
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 14, marginTop: 14, fontSize: "0.6rem", fontFamily: "var(--font-mono)", color: "var(--text-light)" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 14, height: 8, borderRadius: 4, background: "var(--text-accent)" }} /> verified</span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 14, height: 8, borderRadius: 4, boxSizing: "border-box", border: "1.5px solid var(--text-accent)" }} /> not verified</span>
            </div>
          </div>
        </div>
      </div>

      {/* The vault itself, separate from the estimate above */}
      <div className="vault-stats">
        <StatCard k="USTX locked" v={num(vault.lockedUstx, 2)}>
          {share === null ? "In the vault now." : `${share.toFixed(0)}% of all USTX on TX.`}{vault.paused ? " The vault is paused by its owner." : ""}
        </StatCard>
        <StatCard k="Wallets" v={num(vault.wallets)}>
          {num(vault.positions)} open positions, {vault.lockedUstx > 0 ? `${((vault.boostedUstx / vault.lockedUstx) * 100).toFixed(0)}%` : "none"} of the USTX at the verified rate.
        </StatCard>
        <StatCard k="Most chosen lock" v={used.length ? `${used[0].days} days` : "..."}>
          {used.length > 0 && (
            <>
              <span style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", background: "var(--glass-border)", margin: "2px 0 6px" }}>
                {used.map((t, i) => <span key={t.days} style={{ width: `${(t.ustx / vault.lockedUstx) * 100}%`, background: i === 0 ? "var(--text-accent)" : "var(--calc-restake)", opacity: i > 1 ? 0.5 : 1 }} />)}
              </span>
              {used.map((t) => `${t.days} days ${((t.ustx / vault.lockedUstx) * 100).toFixed(0)}%`).join(", ")}.
            </>
          )}
        </StatCard>
        <StatCard k="Rewards earned so far" v={`${num(vault.earnedTx)} TX`}>
          {funded ? `${num(vault.rewardPoolTx)} TX held in the vault to pay it.` : "The reward pool is not funded yet."}
          {vault.nextMaturity ? ` First payout due ${day(vault.nextMaturity)}.` : ""}
        </StatCard>
      </div>

      <div style={{ display: "flex", gap: "6px 18px", flexWrap: "wrap", alignItems: "baseline", marginTop: 12, marginBottom: 16, padding: "0 4px", fontSize: "0.64rem", color: "var(--text-medium)" }}>
        {vault.maturities.slice(0, 4).map((m) => (
          <span key={m.month}>Locks ending {monthLabel(m.month)}: <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-dark)", fontWeight: 700 }}>{num(m.ustx)} USTX</span></span>
        ))}
        <span>Oracle price ${vault.oraclePrice.toFixed(6)} for {day(vault.oracleDay)}, read {readAt} UTC</span>
        <Link href="/stablecoins" className="link" style={{ marginLeft: "auto" }}>About USTX</Link>
      </div>
    </>
  );
}
