"use client";

// Per-validator detail page body, rendered inside the validators tab when
// the URL is /validators/corevaloper1... (HomePage detects the pathname,
// same pattern as the proposal detail view).
//
// Everything comes from /api/validator/[address] in a single request. The
// sections that no other TX explorer can show are the redelegation
// counterparties (who this validator won stake from and lost it to) and the
// delegator concentration, both of which depend on data we index ourselves.

import { useEffect, useState } from "react";
import Link from "next/link";

const FLOW_DAYS = 30;

interface Counterparty { address: string; moniker: string; amount: number }
interface TopDelegator { address: string; amount: number; pct: number }

interface ValidatorDetail {
  validator: {
    operatorAddress: string; consensusAddress: string; selfDelegateAddress: string;
    moniker: string; identity: string; website: string; securityContact: string; details: string;
    tokens: number; votingPowerPct: number;
    commissionRate: number; commissionMaxRate: number; commissionMaxChangeRate: number;
    commissionUpdatedAt: string; minSelfDelegation: number; jailed: boolean; status: string;
  };
  uptime: {
    missedBlocks: number | null; signedBlocksWindow: number | null;
    uptimePct: number | null; tombstoned: boolean | null; jailedUntil: string | null;
  };
  selfBond: { amount: number; pct: number };
  delegators: {
    count: number; truncated: boolean; top: TopDelegator[];
    concentration: { top1Pct: number; top5Pct: number; top10Pct: number };
  };
  flow30d: {
    delegatedIn: number; redelegatedIn: number; undelegatedOut: number; redelegatedOut: number;
    net: number; topSources: Counterparty[]; topDestinations: Counterparty[];
  };
  governance: { votedCount: number; votes: { proposalId: number; vote: string }[] };
  history: { date: string; tokens: string; delegatorCount: number | null }[];
  events: {
    txHash: string; height: number; timestamp: string;
    type: "delegate" | "undelegate" | "redelegate";
    delegator: string; amount: string; sourceValidator: string | null; outgoing: boolean;
  }[];
  eventMinTx: number;
}

// Relative time, matching how the rest of the app labels recent activity.
function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${Math.max(m, 0)}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmt(n: number): string {
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}
function fmtFlow(n: number): string {
  const s = n > 0 ? "+" : n < 0 ? "-" : "";
  return `${s}${fmt(Math.abs(n))}`;
}
const short = (a: string) => (a ? `${a.slice(0, 12)}...${a.slice(-6)}` : "");

// Class rather than inline colour so each theme resolves its own AA-safe
// value (the shared accent tokens only reach 2.7-4.3:1 at this text size).
const VOTE_CLASS: Record<string, string> = {
  YES: "vote-yes",
  NO: "vote-no",
  ABSTAIN: "vote-abstain",
  NO_WITH_VETO: "vote-veto",
};

export default function ValidatorDetailView({ address }: { address: string }) {
  const [data, setData] = useState<ValidatorDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(`/api/validator/${address}`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 404 ? "Validator not found" : `HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(String(e.message || e)); setLoading(false); } });
    return () => { cancelled = true; };
  }, [address]);

  if (loading) {
    return <div style={{ padding: 48, textAlign: "center", opacity: 0.5 }}>Loading validator...</div>;
  }
  if (error || !data) {
    return (
      <div style={{ padding: 48, textAlign: "center" }}>
        <div style={{ marginBottom: 12 }}>{error || "Could not load this validator."}</div>
        <Link href="/validators" className="link">Back to all validators</Link>
      </div>
    );
  }

  const { validator: v, uptime, selfBond, delegators, flow30d, governance, history } = data;
  const active = v.status === "BOND_STATUS_BONDED" && !v.jailed;

  const stat = (label: string, value: string, sub?: string, color?: string) => (
    <div className="chart-card" style={{ padding: "14px 16px" }}>
      <div style={{ fontSize: "0.6rem", letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.45, marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "1.35rem", fontWeight: 700, color: color || "var(--text-dark)" }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: "0.6rem", opacity: 0.4, marginTop: 2 }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ padding: "0 4px 32px" }}>
      <div style={{ marginBottom: 14 }}>
        <Link href="/validators" className="link" style={{ fontSize: "0.75rem", opacity: 0.6 }}>
          &larr; All validators
        </Link>
      </div>

      {/* ── identity ─────────────────────────────────────────────── */}
      <div className="section-head" style={{ alignItems: "flex-start" }}>
        <div>
          <h1 className="page-title" style={{ marginBottom: 4 }}>{v.moniker}</h1>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{
              fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
              padding: "3px 8px", borderRadius: 6,
              background: active ? "rgba(177,252,3,0.14)" : "rgba(180,74,62,0.12)",
              color: active ? "var(--accent-olive)" : "#b44a3e",
            }}>
              {v.jailed ? "Jailed" : active ? "Active" : "Inactive"}
            </span>
            {uptime.tombstoned && (
              <span style={{ fontSize: "0.6rem", fontWeight: 700, color: "#b44a3e" }}>TOMBSTONED</span>
            )}
            {v.website && (
              <a href={v.website} target="_blank" rel="noopener noreferrer" className="link" style={{ fontSize: "0.7rem" }}>
                {v.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
              </a>
            )}
          </div>
        </div>
      </div>

      {v.details && (
        <p style={{ fontSize: "0.82rem", opacity: 0.65, lineHeight: 1.6, maxWidth: 760, marginBottom: 18 }}>
          {v.details}
        </p>
      )}

      {/* ── headline stats ───────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 22 }}>
        {stat("Voting Power", `${fmt(v.tokens)} TX`, `${v.votingPowerPct.toFixed(2)}% of bonded`)}
        {stat("Commission", `${(v.commissionRate * 100).toFixed(1)}%`, `max ${(v.commissionMaxRate * 100).toFixed(0)}% · max change ${(v.commissionMaxChangeRate * 100).toFixed(0)}%/day`)}
        {stat(
          "Uptime",
          uptime.uptimePct !== null ? `${uptime.uptimePct.toFixed(2)}%` : "n/a",
          uptime.missedBlocks !== null && uptime.signedBlocksWindow
            ? `${uptime.missedBlocks.toLocaleString()} missed of ${uptime.signedBlocksWindow.toLocaleString()}`
            : "no signing data",
          uptime.uptimePct !== null && uptime.uptimePct < 95 ? "#b44a3e" : undefined,
        )}
        {stat("Self Bonded", `${fmt(selfBond.amount)} TX`, `${selfBond.pct.toFixed(2)}% of own stake`)}
        {stat("Delegators", delegators.count.toLocaleString(), delegators.truncated ? "top 500 shown" : "wallets")}
        {stat(
          `${FLOW_DAYS}d Net Flow`,
          `${fmtFlow(flow30d.net)} TX`,
          flow30d.net > 0 ? "gaining stake" : flow30d.net < 0 ? "losing stake" : "flat",
          flow30d.net > 0 ? "var(--accent-olive)" : flow30d.net < 0 ? "#b44a3e" : undefined,
        )}
      </div>

      {/* ── flow breakdown + counterparties ──────────────────────── */}
      <h2 className="section-sub" style={{ marginBottom: 8 }}>Stake flow, last {FLOW_DAYS} days</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginBottom: 10 }}>
        <div className="chart-card" style={{ padding: "14px 16px" }}>
          {[
            ["Delegated in", flow30d.delegatedIn, true],
            ["Redelegated in", flow30d.redelegatedIn, true],
            ["Undelegated out", flow30d.undelegatedOut, false],
            ["Redelegated out", flow30d.redelegatedOut, false],
          ].map(([label, amt, positive]) => (
            <div key={label as string} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: "0.78rem" }}>
              <span style={{ opacity: 0.6 }}>{label as string}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: positive ? "var(--accent-olive)" : "#b44a3e" }}>
                {positive ? "+" : "-"}{fmt(amt as number)} TX
              </span>
            </div>
          ))}
          <div style={{ borderTop: "1px solid var(--glass-border)", marginTop: 6, paddingTop: 6, display: "flex", justifyContent: "space-between", fontSize: "0.82rem", fontWeight: 700 }}>
            <span>Net</span>
            <span style={{ fontFamily: "var(--font-mono)", color: flow30d.net >= 0 ? "var(--accent-olive)" : "#b44a3e" }}>
              {fmtFlow(flow30d.net)} TX
            </span>
          </div>
        </div>

        {/* Redelegation counterparties: only computable because we store
            the source validator on every redelegation event. */}
        <div className="chart-card" style={{ padding: "14px 16px" }}>
          <div style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.08em", opacity: 0.45, marginBottom: 8 }}>
            Won stake from
          </div>
          {flow30d.topSources.length === 0 ? (
            <div style={{ fontSize: "0.72rem", opacity: 0.35 }}>No redelegations in</div>
          ) : flow30d.topSources.map((s) => (
            <div key={s.address} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: "0.75rem" }}>
              <Link href={`/validators/${s.address}`} className="link" style={{ opacity: 0.8 }}>
                {s.moniker || short(s.address)}
              </Link>
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--accent-olive)" }}>+{fmt(s.amount)}</span>
            </div>
          ))}
        </div>

        <div className="chart-card" style={{ padding: "14px 16px" }}>
          <div style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.08em", opacity: 0.45, marginBottom: 8 }}>
            Lost stake to
          </div>
          {flow30d.topDestinations.length === 0 ? (
            <div style={{ fontSize: "0.72rem", opacity: 0.35 }}>No redelegations out</div>
          ) : flow30d.topDestinations.map((s) => (
            <div key={s.address} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: "0.75rem" }}>
              <Link href={`/validators/${s.address}`} className="link" style={{ opacity: 0.8 }}>
                {s.moniker || short(s.address)}
              </Link>
              <span style={{ fontFamily: "var(--font-mono)", color: "#b44a3e" }}>-{fmt(s.amount)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── delegators ───────────────────────────────────────────── */}
      <h2 className="section-sub" style={{ margin: "22px 0 8px" }}>
        Delegators
        <span style={{ fontWeight: 400, opacity: 0.5 }}>
          {" "}&middot; top 1 holds {delegators.concentration.top1Pct.toFixed(1)}%,
          top 10 hold {delegators.concentration.top10Pct.toFixed(1)}%
        </span>
      </h2>
      <div style={{ overflowX: "auto" }}>
        <table className="data-table" style={{ minWidth: 480, width: "100%" }}>
          <thead>
            <tr><th style={{ textAlign: "left" }}>#</th><th style={{ textAlign: "left" }}>Wallet</th><th>Staked</th><th>Share</th></tr>
          </thead>
          <tbody>
            {delegators.top.map((d, i) => (
              <tr key={d.address}>
                <td style={{ opacity: 0.4, fontSize: "0.72rem" }}>{i + 1}</td>
                <td>
                  <Link href={`/passport/${d.address}`} className="link" style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem" }}>
                    {short(d.address)}
                  </Link>
                </td>
                <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.78rem" }}>{fmt(d.amount)} TX</td>
                <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.78rem", opacity: 0.6 }}>{d.pct.toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── stake events ─────────────────────────────────────────── */}
      <h2 className="section-sub" style={{ margin: "22px 0 8px" }}>
        Stake events
        <span style={{ fontWeight: 400, opacity: 0.5 }}>
          {" "}&middot; moves of {fmt(data.eventMinTx)} TX or more
        </span>
      </h2>
      {data.events.length === 0 ? (
        <div style={{ fontSize: "0.78rem", opacity: 0.4 }}>
          No stake moves above {fmt(data.eventMinTx)} TX recorded for this validator.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="data-table" style={{ minWidth: 620, width: "100%" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Type</th>
                <th style={{ textAlign: "left" }}>Wallet</th>
                <th>Amount</th>
                <th>Height</th>
                <th style={{ textAlign: "right" }}>When</th>
              </tr>
            </thead>
            <tbody>
              {data.events.map((e) => {
                // A redelegation is a gain for the destination and a loss for
                // the source, so the same row means opposite things depending
                // on which side of it this validator sits.
                const inbound = e.type === "delegate" || (e.type === "redelegate" && !e.outgoing);
                const label =
                  e.type === "delegate" ? "Delegated"
                    : e.type === "undelegate" ? "Undelegated"
                      : e.outgoing ? "Redelegated out" : "Redelegated in";
                const color = inbound ? "var(--accent-olive)" : "#b44a3e";
                return (
                  <tr key={`${e.txHash}-${e.height}-${e.delegator}`}>
                    <td>
                      <span style={{
                        fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.04em",
                        textTransform: "uppercase", padding: "2px 7px", borderRadius: 5,
                        color, background: inbound ? "rgba(177,252,3,0.12)" : "rgba(180,74,62,0.10)",
                      }}>
                        {label}
                      </span>
                    </td>
                    <td>
                      <Link href={`/passport/${e.delegator}`} className="link" style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem" }}>
                        {short(e.delegator)}
                      </Link>
                    </td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.78rem", fontWeight: 600, color }}>
                      {inbound ? "+" : "-"}{fmt(Number(e.amount))} TX
                    </td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", opacity: 0.5 }}>
                      {e.height.toLocaleString()}
                    </td>
                    <td style={{ textAlign: "right", fontSize: "0.7rem", opacity: 0.5, whiteSpace: "nowrap" }}>
                      {ago(e.timestamp)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── governance record ────────────────────────────────────── */}
      <h2 className="section-sub" style={{ margin: "22px 0 8px" }}>
        Governance
        <span style={{ fontWeight: 400, opacity: 0.5 }}> &middot; voted on {governance.votedCount} proposals</span>
      </h2>
      {governance.votes.length === 0 ? (
        <div style={{ fontSize: "0.78rem", opacity: 0.4 }}>No recorded votes.</div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {governance.votes.map((g) => (
            <Link
              key={g.proposalId}
              href={`/governance/${g.proposalId}`}
              className={`link ${VOTE_CLASS[g.vote] || ""}`}
              style={{
                fontSize: "0.68rem", fontFamily: "var(--font-mono)",
                padding: "4px 8px", borderRadius: 6, border: "1px solid var(--glass-border)",
              }}
              title={`Proposal #${g.proposalId}: ${g.vote}`}
            >
              #{g.proposalId} {g.vote === "NO_WITH_VETO" ? "VETO" : g.vote}
            </Link>
          ))}
        </div>
      )}

      {/* ── history ──────────────────────────────────────────────── */}
      <h2 className="section-sub" style={{ margin: "22px 0 8px" }}>History</h2>
      {history.length < 2 ? (
        // Snapshots only started recently and cannot be backfilled from
        // chain state, so say so plainly instead of drawing an empty chart.
        <div style={{ fontSize: "0.75rem", opacity: 0.45 }}>
          Daily snapshots started {history[0]?.date ?? "recently"}. Voting power and delegator history
          will appear here as data accumulates.
        </div>
      ) : (
        <div style={{ fontSize: "0.75rem", opacity: 0.6 }}>
          {history.length} daily snapshots since {history[0].date}.
        </div>
      )}

      {/* ── addresses ────────────────────────────────────────────── */}
      <div style={{ marginTop: 26, fontSize: "0.62rem", opacity: 0.35, lineHeight: 1.8, wordBreak: "break-all" }}>
        <div>Operator: {v.operatorAddress}</div>
        {v.selfDelegateAddress && <div>Self-delegate: {v.selfDelegateAddress}</div>}
        <div>Min self delegation: {fmt(v.minSelfDelegation)} TX</div>
        {v.commissionUpdatedAt && <div>Commission last changed: {v.commissionUpdatedAt.slice(0, 10)}</div>}
      </div>
    </div>
  );
}
