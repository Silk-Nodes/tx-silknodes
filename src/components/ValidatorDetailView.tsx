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
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid } from "recharts";
import Tooltip from "@/components/Tooltip";
import { SILK_NODES_VALIDATOR } from "@/lib/chain-config";

const FLOW_DAYS = 30;

interface Counterparty { address: string; moniker: string; amount: number }
interface TopDelegator { address: string; amount: number; pct: number }

interface ValidatorDetail {
  validator: {
    operatorAddress: string; consensusAddress: string; selfDelegateAddress: string;
    moniker: string; identity: string; avatarUrl: string; website: string; securityContact: string; details: string;
    tokens: number; votingPowerPct: number;
    rank: number | null; validatorCount: number | null; delegatorApr: number | null;
    commissionRate: number; commissionMaxRate: number; commissionMaxChangeRate: number;
    commissionUpdatedAt: string; minSelfDelegation: number; jailed: boolean; status: string;
  };
  benchmarks: {
    avgCommission: number | null; avgDelegatorApr: number | null;
    commissionVsAvg: number | null; aprVsAvg: number | null;
  };
  rewards: {
    outstandingPoolTx: number; commissionAccruedTx: number; estMonthlyCommissionTx: number | null;
  };
  unbonding: { amountTx: number; walletCount: number };
  delegatorFlow30d: { joined: number; reduced: number };
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

// Vote colours from the app's theme tokens (all theme-aware, all readable):
// yes -> accent, no/veto -> danger, abstain -> muted. Inline rather than the
// .gov-mini-label classes, whose --accent-orange "no" is tuned for a tinted
// chip and only reaches 1.5:1 as plain text on the cream background.
const VOTE_COLOR: Record<string, string> = {
  YES: "var(--text-accent)",
  NO: "var(--danger)",
  ABSTAIN: "var(--text-light)",
  NO_WITH_VETO: "var(--danger)",
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

// Compact area chart for the History tab. Colours use the app's --text-accent
// via SVG var() so it flips with the theme. Formatter controls the axis/tooltip.
function MiniHistoryChart({
  title, data, format,
}: {
  title: string;
  data: { date: string; value: number }[];
  format: (n: number) => string;
}) {
  const gid = `vd-hist-${title.replace(/\s+/g, "")}`;
  return (
    <div className="vd-card vd-hist-card" style={{ padding: "12px 14px" }}>
      <div style={{ fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.06em", opacity: 0.55, marginBottom: 8 }}>
        {title}
        <span style={{ float: "right", fontFamily: "var(--font-mono)", opacity: 0.8 }}>{format(data[data.length - 1].value)}</span>
      </div>
      <div className="vd-hist-chart" style={{ width: "100%", height: 150 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--text-accent)" stopOpacity={0.28} />
                <stop offset="100%" stopColor="var(--text-accent)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="4 4" stroke="var(--glass-border)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(d: string) => { const dt = new Date(d + "T00:00:00"); return `${dt.getMonth() + 1}/${dt.getDate()}`; }}
              tick={{ fill: "var(--text-light)", fontSize: 9, fontFamily: "var(--font-mono)" }}
              axisLine={false} tickLine={false} minTickGap={24} dy={4}
            />
            <YAxis
              tickFormatter={format}
              tick={{ fill: "var(--text-light)", fontSize: 9, fontFamily: "var(--font-mono)" }}
              axisLine={false} tickLine={false} width={46} tickCount={3} domain={["auto", "auto"]}
            />
            <RTooltip
              contentStyle={{ background: "var(--glass-bg)", border: "1px solid var(--glass-border)", borderRadius: 8, fontSize: 11 }}
              labelFormatter={(d: string) => d}
              formatter={(v: number) => [format(v), title]}
            />
            <Area type="monotone" dataKey="value" stroke="var(--text-accent)" strokeWidth={2}
              fill={`url(#${gid})`} dot={{ r: 2 }} animationDuration={500} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
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

// One cell of the metrics band atop the data column (label over value over sub).
function StatCell({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="vd-statcell">
      <span className="vd-stat-label">{label}</span>
      <div className="vd-stat-value" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="vd-stat-sub">{sub}</div>}
    </div>
  );
}

interface WalletLike { connected: boolean; address: string }
interface ValidatorDetailProps {
  address: string;
  wallet?: WalletLike;
  delegate?: (validatorAddress: string, amount: number) => void | Promise<unknown>;
  txPending?: boolean;
  txResult?: { hash: string; type: string } | null;
  onConnectPrompt?: () => void;
}

// Proposal id -> title, for the governance tab. The bare "#44 YES" chips left
// most of the panel empty; joining titles turns it into a readable record.
interface GovMeta { title: string }

export default function ValidatorDetailView({
  address, wallet, delegate, txPending, txResult, onConnectPrompt,
}: ValidatorDetailProps) {
  const [data, setData] = useState<ValidatorDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<TabId>("delegators");
  const [showDelegate, setShowDelegate] = useState(false);
  const [amount, setAmount] = useState("");
  const [govMeta, setGovMeta] = useState<Record<number, GovMeta>>({});
  const [totalProposals, setTotalProposals] = useState(0);

  // Titles for the governance tab. One call, reused across every vote row.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/governance", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d?.proposals) return;
        const map: Record<number, GovMeta> = {};
        for (const p of d.proposals) map[p.id] = { title: p.title || `Proposal #${p.id}` };
        setGovMeta(map);
        setTotalProposals(d.proposals.length);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

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
  const bench = data.benchmarks;
  const rew = data.rewards;
  const active = v.status === "BOND_STATUS_BONDED" && !v.jailed;
  // Trust: tombstoned is a permanent double-sign slash; its absence plus a
  // not-jailed state is the honest "clean record" signal we can prove.
  const cleanRecord = uptime.tombstoned === false && !v.jailed;
  const isSilk = v.operatorAddress === SILK_NODES_VALIDATOR;
  // In-app delegation to THIS validator via the dashboard's own wallet flow,
  // no external Keplr web page. delegate() is threaded down from the page's
  // single wallet instance (the hook is per-instance local state).
  const connected = Boolean(wallet?.connected);
  const submitDelegate = () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0 || !delegate) return;
    delegate(v.operatorAddress, amt);
  };
  const justDelegated = txResult?.type === "delegate";

  // Concentration strip: top-1 / next-4 / next-5 / everyone else.
  const c = delegators.concentration;
  const conc = [
    { pct: c.top1Pct, color: "var(--tx-neon)" },
    { pct: Math.max(c.top5Pct - c.top1Pct, 0), color: "var(--text-accent)" },
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
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              {v.avatarUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={v.avatarUrl} alt="" width={38} height={38}
                  style={{ borderRadius: 9, flexShrink: 0, objectFit: "cover" }}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
              )}
              <h1 className="page-title" style={{ fontSize: "1.5rem", margin: 0, lineHeight: 1.1 }}>
                {v.moniker}
                {v.avatarUrl && (
                  <Tooltip text="Identity verified on Keybase">
                    <span style={{ color: "var(--text-accent)", marginLeft: 6, fontSize: "0.85rem", cursor: "help" }}>&#10003;</span>
                  </Tooltip>
                )}
              </h1>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
              <span style={{
                fontSize: "0.58rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
                padding: "3px 8px", borderRadius: 6,
                background: active ? "rgba(177,252,3,0.14)" : "rgba(180,74,62,0.12)",
                color: active ? "var(--text-accent)" : "var(--danger)",
              }}>
                {v.jailed ? "Jailed" : active ? "Active" : "Inactive"}
              </span>
              {uptime.tombstoned && <span style={{ fontSize: "0.58rem", fontWeight: 700, color: "var(--danger)" }}>TOMBSTONED</span>}
              {v.rank && <span style={{ fontSize: "0.62rem", opacity: 0.6, fontFamily: "var(--font-mono)" }}>Rank #{v.rank}{v.validatorCount ? ` of ${v.validatorCount}` : ""}</span>}
              {cleanRecord && (
                <span title="Never tombstoned (double-sign slashed) and not jailed" style={{
                  fontSize: "0.58rem", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase",
                  padding: "3px 8px", borderRadius: 6, background: "rgba(177,252,3,0.12)", color: "var(--text-accent)",
                }}>
                  No slashing
                </span>
              )}
            </div>

            {/* Delegate via the dashboard's own wallet flow. */}
            <div style={{ marginBottom: 14 }}>
              {!connected ? (
                <button
                  onClick={() => onConnectPrompt?.()}
                  className={`btn ${isSilk ? "primary" : ""}`}
                  style={{ width: "100%", marginTop: 0, height: 40, fontSize: "0.78rem", fontWeight: 700 }}
                >
                  Connect wallet to delegate
                </button>
              ) : justDelegated ? (
                <div style={{ textAlign: "center", fontSize: "0.75rem", color: "var(--text-accent)", padding: "10px 0", fontWeight: 600 }}>
                  Delegation submitted
                </div>
              ) : !showDelegate ? (
                <button
                  onClick={() => setShowDelegate(true)}
                  className={`btn ${isSilk ? "primary" : ""}`}
                  style={{ width: "100%", marginTop: 0, height: 40, fontSize: "0.78rem", fontWeight: 700 }}
                >
                  Delegate{isSilk ? " to Silk Nodes" : ""}
                </button>
              ) : (
                <div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      type="number" inputMode="decimal" min="0" placeholder="Amount"
                      value={amount} onChange={(e) => setAmount(e.target.value)}
                      autoFocus
                      style={{
                        flex: 1, minWidth: 0, height: 40, padding: "0 10px", fontSize: "0.8rem",
                        fontFamily: "var(--font-mono)", borderRadius: 8,
                        border: "1px solid var(--glass-border)", background: "var(--glass-bg)", color: "var(--text-dark)",
                      }}
                    />
                    <button
                      onClick={submitDelegate}
                      disabled={txPending || !amount}
                      className="btn primary"
                      style={{ marginTop: 0, height: 40, padding: "0 16px", fontSize: "0.75rem", fontWeight: 700, opacity: txPending || !amount ? 0.6 : 1 }}
                    >
                      {txPending ? "..." : "Confirm"}
                    </button>
                  </div>
                  <button
                    onClick={() => { setShowDelegate(false); setAmount(""); }}
                    className="link-plain"
                    style={{ background: "none", border: "none", fontSize: "0.62rem", opacity: 0.5, cursor: "pointer", marginTop: 6, padding: 0 }}
                  >
                    cancel
                  </button>
                  <span style={{ fontSize: "0.6rem", opacity: 0.4, marginLeft: 10 }}>TX will be staked to {v.moniker}</span>
                </div>
              )}
            </div>

            {/* Left card keeps only the "why delegate" numbers next to the CTA;
                the operational metrics live in the band atop the data column so
                this card stays compact and shorter than the data (normal sticky
                sidebar), instead of towering over the thin tabs. */}
            <StatRow label="Voting Power" value={`${fmt(v.tokens)} TX`} sub={`${v.votingPowerPct.toFixed(2)}% of bonded`} />
            <StatRow
              label="Delegator APR"
              value={v.delegatorApr !== null ? `${v.delegatorApr.toFixed(2)}%` : "n/a"}
              sub={bench.avgDelegatorApr !== null ? `+ PSE · avg ${bench.avgDelegatorApr.toFixed(2)}%` : "+ PSE on top"}
              color="var(--text-accent)"
            />
            <StatRow
              label="Commission"
              value={`${(v.commissionRate * 100).toFixed(1)}%`}
              sub={bench.avgCommission !== null
                ? `avg ${bench.avgCommission.toFixed(1)}% · max ${(v.commissionMaxRate * 100).toFixed(0)}%`
                : `max ${(v.commissionMaxRate * 100).toFixed(0)}% · ${(v.commissionMaxChangeRate * 100).toFixed(0)}%/day`}
            />

            {v.website && (
              <div style={{ marginTop: 12 }}>
                {/* inline-block so the hover underline hugs the text instead
                    of stretching the full card width. */}
                <a href={v.website} target="_blank" rel="noopener noreferrer" className="link" style={{ display: "inline-block", fontSize: "0.7rem" }}>
                  {v.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                </a>
              </div>
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
        </aside>

        {/* ── RIGHT: tabbed data ──────────────────────────────────── */}
        <div className="vd-main">
          {/* Metrics band: the operational stats moved out of the identity card.
              Makes the data column the taller one so the rail is a normal short
              sidebar, and reads as a compact dashboard header. */}
          <div className="vd-statband">
            <StatCell
              label="Uptime"
              value={uptime.uptimePct !== null ? `${uptime.uptimePct.toFixed(2)}%` : "n/a"}
              sub={uptime.missedBlocks !== null && uptime.signedBlocksWindow ? `${uptime.missedBlocks.toLocaleString()} missed / ${uptime.signedBlocksWindow.toLocaleString()}` : undefined}
              color={uptime.uptimePct !== null && uptime.uptimePct < 95 ? "var(--danger)" : undefined}
            />
            <StatCell label="Self Bonded" value={`${fmt(selfBond.amount)} TX`} sub={`${selfBond.pct.toFixed(2)}% of stake`} />
            <StatCell label="Delegators" value={delegators.count.toLocaleString()} sub={delegators.truncated ? "top 500 shown" : "wallets"} />
            <StatCell
              label={`${FLOW_DAYS}d Net Flow`}
              value={`${fmtFlow(flow30d.net)} TX`}
              sub={flow30d.net > 0 ? "gaining" : flow30d.net < 0 ? "losing" : "flat"}
              color={flow30d.net > 0 ? "var(--text-accent)" : flow30d.net < 0 ? "var(--danger)" : undefined}
            />
          </div>
          {/* Description lives here, not in the sticky card, so the card stays
              short enough to stay pinned through a long delegator list. Wrapped
              in a bordered card so it reads as an intentional panel. */}
          {v.details && (
            <div className="vd-card" style={{ padding: "12px 16px", marginBottom: 14 }}>
              <p style={{ fontSize: "0.8rem", opacity: 0.78, lineHeight: 1.6, margin: 0 }}>
                {v.details}
              </p>
            </div>
          )}

          {/* Operator economics: kept in the data column, not the sticky card,
              so the card stays lean. Label + value only; the explanation lives
              in a hover tooltip to keep the strip minimal. */}
          <div className="vd-card" style={{ padding: "12px 16px", marginBottom: 14, display: "flex", flexWrap: "wrap", gap: "10px 32px" }}>
            {[
              ["Reward pool", `${fmt(rew.outstandingPoolTx)} TX`, "Undistributed rewards accruing to this validator's delegators plus its commission."],
              rew.estMonthlyCommissionTx !== null ? ["Commission income", `~${fmt(rew.estMonthlyCommissionTx)} TX/mo`, "Estimated monthly commission the operator earns, from its share of staking rewards."] : null,
              ["Unclaimed commission", `${fmt(rew.commissionAccruedTx)} TX`, "Commission earned but not yet withdrawn by the operator."],
            ].filter(Boolean).map((row) => {
              const [label, value, note] = row as string[];
              return (
                <Tooltip key={label} text={note}>
                  <div style={{ cursor: "help" }}>
                    <div style={{ fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "0.06em", opacity: 0.5, borderBottom: "1px dotted var(--glass-border)", display: "inline-block", paddingBottom: 1 }}>{label}</div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: "1rem", fontWeight: 700, marginTop: 3 }}>{value}</div>
                  </div>
                </Tooltip>
              );
            })}
          </div>
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
            {/* People + currently-leaving, complementing the TX flow below. */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 24px", fontSize: "0.74rem", marginBottom: 12 }}>
              <span>
                <strong style={{ color: "var(--text-accent)" }}>{data.delegatorFlow30d.joined}</strong> wallets added
                {" · "}
                <strong style={{ color: "var(--danger)" }}>{data.delegatorFlow30d.reduced}</strong> reduced
                <span style={{ opacity: 0.5 }}> (30d)</span>
              </span>
              <span style={{ opacity: data.unbonding.amountTx > 0 ? 1 : 0.55 }}>
                {data.unbonding.amountTx > 0
                  ? <>Currently unbonding: <strong style={{ color: "var(--danger)" }}>{fmt(data.unbonding.amountTx)} TX</strong> from {data.unbonding.walletCount} wallet{data.unbonding.walletCount === 1 ? "" : "s"}</>
                  : <>No stake currently unbonding</>}
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
              <div className="vd-card" style={{ padding: "14px 16px" }}>
                {[
                  ["Delegated in", flow30d.delegatedIn, true],
                  ["Redelegated in", flow30d.redelegatedIn, true],
                  ["Undelegated out", flow30d.undelegatedOut, false],
                  ["Redelegated out", flow30d.redelegatedOut, false],
                ].map(([label, amt, positive]) => (
                  <div key={label as string} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: "0.78rem" }}>
                    <span style={{ opacity: 0.6 }}>{label as string}</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: positive ? "var(--text-accent)" : "var(--danger)" }}>
                      {positive ? "+" : "-"}{fmt(amt as number)} TX
                    </span>
                  </div>
                ))}
                <div style={{ borderTop: "1px solid var(--glass-border)", marginTop: 6, paddingTop: 6, display: "flex", justifyContent: "space-between", fontSize: "0.82rem", fontWeight: 700 }}>
                  <span>Net</span>
                  <span style={{ fontFamily: "var(--font-mono)", color: flow30d.net >= 0 ? "var(--text-accent)" : "var(--danger)" }}>{fmtFlow(flow30d.net)} TX</span>
                </div>
              </div>
              <div className="vd-card" style={{ padding: "14px 16px" }}>
                <div style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.08em", opacity: 0.45, marginBottom: 8 }}>Won stake from</div>
                {flow30d.topSources.length === 0 ? <div style={{ fontSize: "0.72rem", opacity: 0.35 }}>No redelegations in</div> :
                  flow30d.topSources.map((s) => (
                    <div key={s.address} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: "0.75rem" }}>
                      <Link href={`/validators/${s.address}`} className="link" style={{ opacity: 0.85 }}>{s.moniker || short(s.address)}</Link>
                      <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-accent)" }}>+{fmt(s.amount)}</span>
                    </div>
                  ))}
              </div>
              <div className="vd-card" style={{ padding: "14px 16px" }}>
                <div style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.08em", opacity: 0.45, marginBottom: 8 }}>Lost stake to</div>
                {flow30d.topDestinations.length === 0 ? <div style={{ fontSize: "0.72rem", opacity: 0.35 }}>No redelegations out</div> :
                  flow30d.topDestinations.map((s) => (
                    <div key={s.address} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: "0.75rem" }}>
                      <Link href={`/validators/${s.address}`} className="link" style={{ opacity: 0.85 }}>{s.moniker || short(s.address)}</Link>
                      <span style={{ fontFamily: "var(--font-mono)", color: "var(--danger)" }}>-{fmt(s.amount)}</span>
                    </div>
                  ))}
              </div>
            </div>
          </section>

          {/* Governance */}
          <section role="tabpanel" hidden={tab !== "governance"}>
            {governance.votes.length === 0 ? (
              <div style={{ fontSize: "0.78rem", opacity: 0.4 }}>No recorded votes.</div>
            ) : (() => {
              const tally = governance.votes.reduce<Record<string, number>>((a, g) => { a[g.vote] = (a[g.vote] || 0) + 1; return a; }, {});
              const pct = totalProposals > 0 ? Math.round((governance.votedCount / totalProposals) * 100) : null;
              return (
                <>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", fontSize: "0.72rem", marginBottom: 14, opacity: 0.8 }}>
                    <span><strong>{governance.votedCount}</strong>{totalProposals ? ` of ${totalProposals}` : ""} proposals voted{pct !== null ? ` (${pct}% participation)` : ""}</span>
                    <span style={{ opacity: 0.5 }}>
                      {tally.YES ? `${tally.YES} Yes` : ""}{tally.NO ? ` · ${tally.NO} No` : ""}
                      {tally.ABSTAIN ? ` · ${tally.ABSTAIN} Abstain` : ""}{tally.NO_WITH_VETO ? ` · ${tally.NO_WITH_VETO} Veto` : ""}
                    </span>
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table className="data-table" style={{ minWidth: 460, width: "100%" }}>
                      <thead>
                        <tr><th style={{ textAlign: "left", width: 48 }}>#</th><th style={{ textAlign: "left" }}>Proposal</th><th style={{ textAlign: "right" }}>Vote</th></tr>
                      </thead>
                      <tbody>
                        {governance.votes.map((g) => (
                          <tr key={g.proposalId}>
                            <td style={{ opacity: 0.5, fontFamily: "var(--font-mono)", fontSize: "0.72rem" }}>{g.proposalId}</td>
                            <td>
                              <Link href={`/governance/${g.proposalId}`} className="link" style={{ fontSize: "0.76rem" }}>
                                {govMeta[g.proposalId]?.title || `Proposal #${g.proposalId}`}
                              </Link>
                            </td>
                            <td style={{ textAlign: "right" }}>
                              <span style={{ fontSize: "0.66rem", fontWeight: 700, fontFamily: "var(--font-mono)", color: VOTE_COLOR[g.vote] || "var(--text-dark)" }}>
                                {g.vote === "NO_WITH_VETO" ? "VETO" : g.vote}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              );
            })()}
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
                      const color = inbound ? "var(--text-accent)" : "var(--danger)";
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
              // flex:1 + centered so the empty state fills the stretched panel
              // instead of leaving blank below it during the collecting window.
              <div style={{ flex: "1 1 auto", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", fontSize: "0.75rem", opacity: 0.5, padding: "8px 0", minHeight: 120 }}>
                <span style={{ maxWidth: 420 }}>
                  Collecting daily snapshots since {history[0]?.date ?? "recently"}. Voting power and delegator
                  trends appear here once there are a few days of data, this history is recorded going forward and
                  can&apos;t be backfilled, so check back soon.
                </span>
              </div>
            ) : tab === "history" ? (
              // Mount the charts only when this tab is visible. Recharts sizes
              // to its container, and a chart in a display:none panel measures
              // 0x0 and draws nothing. Charts carry no SEO text, so lazy is fine.
              <>
                <div style={{ fontSize: "0.66rem", opacity: 0.5, marginBottom: 10 }}>
                  {history.length} daily snapshots since {history[0].date}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
                  <MiniHistoryChart
                    title="Voting Power"
                    data={history.map((h) => ({ date: h.date, value: Number(h.tokens) }))}
                    format={(n) => `${fmt(n)}`}
                  />
                  {history.some((h) => h.delegatorCount != null) && (
                    <MiniHistoryChart
                      title="Delegators"
                      data={history.filter((h) => h.delegatorCount != null).map((h) => ({ date: h.date, value: h.delegatorCount as number }))}
                      format={(n) => n.toLocaleString()}
                    />
                  )}
                </div>
              </>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
