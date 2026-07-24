"use client";

// Per-validator detail page, rendered inside the validators tab when the URL
// is /validators/corevaloper1... (HomePage detects the pathname, same pattern
// as the proposal detail view).
//
// Layout: a sticky left "card" carries the identity + headline stats + the
// delegate CTA (always visible while scrolling), and a right panel holds the
// on-chain data under tabs, defaulting to Delegators. All tab panels stay in
// the DOM (hidden, not unmounted) so crawlers still read every section.
//
// The parts no other TX explorer can show: redelegation counterparties (who
// this validator won stake from and lost it to) and delegator concentration,
// both from data we index ourselves.

import { useEffect, useState } from "react";
import Link from "next/link";
import { SILK_NODES_VALIDATOR } from "@/lib/chain-config";

const FLOW_DAYS = 30;

interface Counterparty { address: string; moniker: string; amount: number }
interface TopDelegator { address: string; amount: number; pct: number }

interface ValidatorDetail {
  validator: {
    operatorAddress: string; consensusAddress: string; selfDelegateAddress: string;
    moniker: string; identity: string; website: string; securityContact: string; details: string;
    tokens: number; votingPowerPct: number;
    rank: number | null; validatorCount: number | null; delegatorApr: number | null;
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

type TabId = "delegators" | "flow" | "governance" | "events" | "history";

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

const VOTE_CLASS: Record<string, string> = {
  YES: "vote-yes", NO: "vote-no", ABSTAIN: "vote-abstain", NO_WITH_VETO: "vote-veto",
};

// A labelled address with click-to-copy. Full value stays in the DOM (so it's
// selectable), display is middle-truncated so the row doesn't wrap on mobile.
function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }).catch(() => {});
  };
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: "0.66rem", lineHeight: 1.7 }}>
      <span style={{ opacity: 0.4, minWidth: 82, textTransform: "uppercase", letterSpacing: "0.04em", fontSize: "0.56rem" }}>
        {label}
      </span>
      <button type="button" onClick={copy} title={`Copy ${value}`} className="link-plain"
        style={{ fontFamily: "var(--font-mono)", fontSize: "0.66rem", cursor: "pointer", background: "none", border: "none", padding: 0, textAlign: "left" }}>
        {short(value)} <span style={{ opacity: 0.5 }}>{copied ? "copied" : "copy"}</span>
      </button>
    </div>
  );
}

function StatRow({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="vd-stat">
      <span className="vd-stat-label">{label}</span>
      <span style={{ textAlign: "right" }}>
        <span className="vd-stat-value" style={color ? { color } : undefined}>{value}</span>
        {sub && <div className="vd-stat-sub">{sub}</div>}
      </span>
    </div>
  );
}

export default function ValidatorDetailView({ address }: { address: string }) {
  const [data, setData] = useState<ValidatorDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<TabId>("delegators");

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

  const { validator: v, uptime, selfBond, delegators, flow30d, governance, history, events } = data;
  const active = v.status === "BOND_STATUS_BONDED" && !v.jailed;
  const isSilk = v.operatorAddress === SILK_NODES_VALIDATOR;
  const keplrUrl =
    "https://wallet.keplr.app/chains/coreum?modal=validator&chain=coreum-mainnet-1&validator_address=" +
    v.operatorAddress;

  // Concentration strip: top-1 / next-4 / next-5 / everyone else.
  const c = delegators.concentration;
  const conc = [
    { pct: c.top1Pct, color: "var(--tx-neon)" },
    { pct: Math.max(c.top5Pct - c.top1Pct, 0), color: "var(--link-color)" },
    { pct: Math.max(c.top10Pct - c.top5Pct, 0), color: "#7d8a55" },
    { pct: Math.max(100 - c.top10Pct, 0), color: "rgba(120,138,85,0.25)" },
  ];

  const TABS: { id: TabId; label: string; count?: number }[] = [
    { id: "delegators", label: "Delegators", count: delegators.count },
    { id: "flow", label: "Stake Flow" },
    { id: "governance", label: "Governance", count: governance.votedCount },
    { id: "events", label: "Events", count: events.length },
    { id: "history", label: "History" },
  ];

  return (
    <div style={{ padding: "0 4px 32px" }}>
      <div style={{ marginBottom: 14 }}>
        <Link href="/validators" className="link" style={{ fontSize: "0.75rem", opacity: 0.7 }}>
          &larr; All validators
        </Link>
      </div>

      <div className="vd-layout">
        {/* ── LEFT: sticky validator card ─────────────────────────── */}
        <aside className="vd-rail">
          <div className="vd-card">
            <h1 className="page-title" style={{ fontSize: "1.6rem", marginBottom: 6 }}>{v.moniker}</h1>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
              <span style={{
                fontSize: "0.58rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
                padding: "3px 8px", borderRadius: 6,
                background: active ? "rgba(177,252,3,0.14)" : "rgba(180,74,62,0.12)",
                color: active ? "var(--link-color)" : "#b44a3e",
              }}>
                {v.jailed ? "Jailed" : active ? "Active" : "Inactive"}
              </span>
              {uptime.tombstoned && <span style={{ fontSize: "0.58rem", fontWeight: 700, color: "#b44a3e" }}>TOMBSTONED</span>}
              {v.rank && <span style={{ fontSize: "0.62rem", opacity: 0.6, fontFamily: "var(--font-mono)" }}>Rank #{v.rank}{v.validatorCount ? ` of ${v.validatorCount}` : ""}</span>}
            </div>

            <button
              onClick={() => window.open(keplrUrl, "_blank")}
              className={`btn ${isSilk ? "primary" : ""}`}
              style={{ width: "100%", marginTop: 0, marginBottom: 14, height: 40, fontSize: "0.78rem", fontWeight: 700 }}
            >
              Delegate{isSilk ? " to Silk Nodes" : ""}
            </button>

            <StatRow label="Voting Power" value={`${fmt(v.tokens)} TX`} sub={`${v.votingPowerPct.toFixed(2)}% of bonded`} />
            <StatRow label="Delegator APR" value={v.delegatorApr !== null ? `${v.delegatorApr.toFixed(2)}%` : "n/a"} sub="+ PSE on top" color="var(--link-color)" />
            <StatRow label="Commission" value={`${(v.commissionRate * 100).toFixed(1)}%`} sub={`max ${(v.commissionMaxRate * 100).toFixed(0)}% · ${(v.commissionMaxChangeRate * 100).toFixed(0)}%/day`} />
            <StatRow
              label="Uptime"
              value={uptime.uptimePct !== null ? `${uptime.uptimePct.toFixed(2)}%` : "n/a"}
              sub={uptime.missedBlocks !== null && uptime.signedBlocksWindow ? `${uptime.missedBlocks.toLocaleString()} missed / ${uptime.signedBlocksWindow.toLocaleString()}` : undefined}
              color={uptime.uptimePct !== null && uptime.uptimePct < 95 ? "#b44a3e" : undefined}
            />
            <StatRow label="Self Bonded" value={`${fmt(selfBond.amount)} TX`} sub={`${selfBond.pct.toFixed(2)}% of stake`} />
            <StatRow label="Delegators" value={delegators.count.toLocaleString()} sub={delegators.truncated ? "top 500 shown" : "wallets"} />
            <StatRow
              label={`${FLOW_DAYS}d Net Flow`}
              value={`${fmtFlow(flow30d.net)} TX`}
              sub={flow30d.net > 0 ? "gaining" : flow30d.net < 0 ? "losing" : "flat"}
              color={flow30d.net > 0 ? "var(--link-color)" : flow30d.net < 0 ? "#b44a3e" : undefined}
            />

            {v.website && (
              <a href={v.website} target="_blank" rel="noopener noreferrer" className="link" style={{ display: "block", marginTop: 12, fontSize: "0.7rem" }}>
                {v.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
              </a>
            )}

            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--glass-border)" }}>
              <CopyRow label="Operator" value={v.operatorAddress} />
              {v.selfDelegateAddress && <CopyRow label="Self-del" value={v.selfDelegateAddress} />}
              {v.commissionUpdatedAt && (
                <div style={{ display: "flex", gap: 8, fontSize: "0.6rem", opacity: 0.45, marginTop: 4 }}>
                  <span style={{ minWidth: 82, textTransform: "uppercase", letterSpacing: "0.04em", fontSize: "0.56rem" }}>Comm. set</span>
                  <span style={{ fontFamily: "var(--font-mono)" }}>{v.commissionUpdatedAt.slice(0, 10)}</span>
                </div>
              )}
            </div>
          </div>

          {v.details && (
            <p style={{ fontSize: "0.72rem", opacity: 0.6, lineHeight: 1.6, marginTop: 12, padding: "0 2px" }}>
              {v.details}
            </p>
          )}
        </aside>

        {/* ── RIGHT: tabbed data ──────────────────────────────────── */}
        <div className="vd-main">
          <div className="vd-tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id}
                className={`vd-tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
                {t.label}
                {t.count !== undefined && <span className="vd-tab-count"> {t.count}</span>}
              </button>
            ))}
          </div>

          {/* Delegators */}
          <section role="tabpanel" hidden={tab !== "delegators"}>
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.62rem", opacity: 0.55, marginBottom: 5 }}>
                <span>Concentration</span>
                <span>top 1: {c.top1Pct.toFixed(1)}% · top 10: {c.top10Pct.toFixed(1)}%</span>
              </div>
              <div className="vd-conc-bar">
                {conc.map((s, i) => <div key={i} className="vd-conc-seg" style={{ width: `${s.pct}%`, background: s.color }} />)}
              </div>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="data-table" style={{ minWidth: 460, width: "100%" }}>
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
          </section>

          {/* Stake Flow */}
          <section role="tabpanel" hidden={tab !== "flow"}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
              <div className="chart-card" style={{ padding: "14px 16px" }}>
                {[
                  ["Delegated in", flow30d.delegatedIn, true],
                  ["Redelegated in", flow30d.redelegatedIn, true],
                  ["Undelegated out", flow30d.undelegatedOut, false],
                  ["Redelegated out", flow30d.redelegatedOut, false],
                ].map(([label, amt, positive]) => (
                  <div key={label as string} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: "0.78rem" }}>
                    <span style={{ opacity: 0.6 }}>{label as string}</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: positive ? "var(--link-color)" : "#b44a3e" }}>
                      {positive ? "+" : "-"}{fmt(amt as number)} TX
                    </span>
                  </div>
                ))}
                <div style={{ borderTop: "1px solid var(--glass-border)", marginTop: 6, paddingTop: 6, display: "flex", justifyContent: "space-between", fontSize: "0.82rem", fontWeight: 700 }}>
                  <span>Net</span>
                  <span style={{ fontFamily: "var(--font-mono)", color: flow30d.net >= 0 ? "var(--link-color)" : "#b44a3e" }}>{fmtFlow(flow30d.net)} TX</span>
                </div>
              </div>
              <div className="chart-card" style={{ padding: "14px 16px" }}>
                <div style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.08em", opacity: 0.45, marginBottom: 8 }}>Won stake from</div>
                {flow30d.topSources.length === 0 ? <div style={{ fontSize: "0.72rem", opacity: 0.35 }}>No redelegations in</div> :
                  flow30d.topSources.map((s) => (
                    <div key={s.address} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: "0.75rem" }}>
                      <Link href={`/validators/${s.address}`} className="link" style={{ opacity: 0.85 }}>{s.moniker || short(s.address)}</Link>
                      <span style={{ fontFamily: "var(--font-mono)", color: "var(--link-color)" }}>+{fmt(s.amount)}</span>
                    </div>
                  ))}
              </div>
              <div className="chart-card" style={{ padding: "14px 16px" }}>
                <div style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.08em", opacity: 0.45, marginBottom: 8 }}>Lost stake to</div>
                {flow30d.topDestinations.length === 0 ? <div style={{ fontSize: "0.72rem", opacity: 0.35 }}>No redelegations out</div> :
                  flow30d.topDestinations.map((s) => (
                    <div key={s.address} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: "0.75rem" }}>
                      <Link href={`/validators/${s.address}`} className="link" style={{ opacity: 0.85 }}>{s.moniker || short(s.address)}</Link>
                      <span style={{ fontFamily: "var(--font-mono)", color: "#b44a3e" }}>-{fmt(s.amount)}</span>
                    </div>
                  ))}
              </div>
            </div>
          </section>

          {/* Governance */}
          <section role="tabpanel" hidden={tab !== "governance"}>
            {governance.votes.length === 0 ? (
              <div style={{ fontSize: "0.78rem", opacity: 0.4 }}>No recorded votes.</div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {governance.votes.map((g) => (
                  <Link key={g.proposalId} href={`/governance/${g.proposalId}`} className={`link ${VOTE_CLASS[g.vote] || ""}`}
                    style={{ fontSize: "0.68rem", fontFamily: "var(--font-mono)", padding: "4px 8px", borderRadius: 6, border: "1px solid var(--glass-border)" }}
                    title={`Proposal #${g.proposalId}: ${g.vote}`}>
                    #{g.proposalId} {g.vote === "NO_WITH_VETO" ? "VETO" : g.vote}
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* Events */}
          <section role="tabpanel" hidden={tab !== "events"}>
            <div style={{ fontSize: "0.62rem", opacity: 0.45, marginBottom: 8 }}>Moves of {fmt(data.eventMinTx)} TX or more</div>
            {events.length === 0 ? (
              <div style={{ fontSize: "0.78rem", opacity: 0.4 }}>No stake moves above {fmt(data.eventMinTx)} TX recorded.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="data-table" style={{ minWidth: 600, width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left" }}>Type</th><th style={{ textAlign: "left" }}>Wallet</th>
                      <th>Amount</th><th>Height</th><th style={{ textAlign: "right" }}>When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((e) => {
                      const inbound = e.type === "delegate" || (e.type === "redelegate" && !e.outgoing);
                      const label = e.type === "delegate" ? "Delegated" : e.type === "undelegate" ? "Undelegated" : e.outgoing ? "Redelegated out" : "Redelegated in";
                      const color = inbound ? "var(--link-color)" : "#b44a3e";
                      return (
                        <tr key={`${e.txHash}-${e.height}-${e.delegator}`}>
                          <td>
                            <span style={{ fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", padding: "2px 7px", borderRadius: 5, color, background: inbound ? "rgba(177,252,3,0.12)" : "rgba(180,74,62,0.10)" }}>{label}</span>
                          </td>
                          <td>
                            <Link href={`/passport/${e.delegator}`} className="link" style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem" }}>{short(e.delegator)}</Link>
                          </td>
                          <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.78rem", fontWeight: 600, color }}>{inbound ? "+" : "-"}{fmt(Number(e.amount))} TX</td>
                          <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", opacity: 0.5 }}>{e.height.toLocaleString()}</td>
                          <td style={{ textAlign: "right", fontSize: "0.7rem", opacity: 0.5, whiteSpace: "nowrap" }}>{ago(e.timestamp)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* History */}
          <section role="tabpanel" hidden={tab !== "history"}>
            {history.length < 2 ? (
              <div style={{ fontSize: "0.75rem", opacity: 0.45 }}>
                Daily snapshots started {history[0]?.date ?? "recently"}. Voting power and delegator history
                will appear here as data accumulates.
              </div>
            ) : (
              <div style={{ fontSize: "0.75rem", opacity: 0.6 }}>{history.length} daily snapshots since {history[0].date}.</div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
