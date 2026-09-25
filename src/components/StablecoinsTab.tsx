"use client";

// /stablecoins. Every dollar on TX, read live from the chain.
//
// Built ahead of USTX, Brale's native stablecoin for TX, announced for October
// 2026. Chart first: the page answers "how much, who holds it, is it used,
// what can the issuer do" with a picture each, and keeps prose to one line
// per section. Every figure comes from /api/stablecoins, which reads the chain
// live and the hourly collector's tables (migrations 021 and 022).

import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import Shareable from "@/components/share/Shareable";

type CoinRole = "incumbent" | "issued" | "test";
type HolderKind = "dex" | "contract" | "known" | "wallet";
interface Holder { address: string; amount: number; share: number; label: string | null; kind: HolderKind }
interface Breakdown { top1: number; second: number; next8: number; rest: number }
interface SizeBand { label: string; wallets: number; amount: number }
interface Controls { features: string[]; admin: string | null; globallyFrozen: boolean }
interface Coin {
  denom: string;
  symbol: string;
  name: string;
  issuer: string | null;
  role: CoinRole;
  supply: number;
  holders: number | null;
  top1Share: number | null;
  top10Share: number | null;
  breakdown: Breakdown | null;
  topHolders: Holder[];
  sizes: SizeBand[] | null;
  controls: Controls | null;
}
interface Fragment { denom: string; hops: number; firstChannel: string; viaChain: string | null; amount: number }
interface HistoryPoint { denom: string; takenAt: string; supply: number; holders: number | null; top1Share: number | null }
interface ActivityDay { day: string; txs: number; volume: number; ibcIn: number; ibcOut: number; chain: number; senders: number }
interface Activity { denom: string; since: string | null; days: ActivityDay[]; txs: number; volume: number; wallets: number }
interface Payload {
  updatedAt: string;
  coins: Coin[];
  ustx: { issued: boolean; denom: string | null; foundBy: string | null; testnetDenom: string | null; checkedAt: string } | null;
  watching: { mainnetIssuer: string; testnetIssuer: string };
  recording: { since: string | null; snapshots: number } | null;
  usdc: { routes: number; total: number; canonical: number | null; canonicalShare: number | null; fragments: Fragment[] };
  history: { available: boolean; points: HistoryPoint[] };
  activity: Activity[] | null;
}

const REFRESH_MS = 5 * 60_000;

// Same pattern as the other hooks in src/hooks: fetch on mount, refresh on an
// interval, keep the last good payload through a failed refresh.
function useStablecoins() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/stablecoins", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = (await res.json()) as Payload;
        if (alive) { setData(j); setError(null); }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return { data, error };
}

const num = (v: number, d = 2) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const usd = (v: number) =>
  v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toFixed(v < 10 ? 2 : 0)}`;
const pct = (v: number | null, d = 1) => (v == null ? "n/a" : `${(v * 100).toFixed(d)}%`);
const short = (a: string) => `${a.slice(0, 12)}...${a.slice(-6)}`;
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};
const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const dateOnly = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

// Muted text uses the text token, never a bar token. --accent-olive is tuned
// for fills and falls to 4.24:1 as type on the light ground.
const MUTED = { color: "var(--text-light)" } as const;
// .card-title sets opacity 0.85; stacked on --text-light it fell to 4.46:1.
const CARD_TITLE = { ...MUTED, opacity: 1 } as const;

// Fills only. Text never uses these.
const C = {
  chain: "var(--accent-olive)",
  ibcIn: "var(--brand-accent)",
  ibcOut: "var(--danger)",
  grey: "rgba(128,128,128,0.42)",
  faint: "rgba(128,128,128,0.16)",
};
const BANDS = [C.ibcOut, "color-mix(in srgb, var(--danger) 45%, transparent)", C.grey, C.faint];
const BAND_LABELS = ["Largest wallet", "Second", "Next eight", "Everyone else"];

const AXIS = { fontSize: 11, fill: "var(--text-light)" } as const;

function Panel({ title, sub, children, className = "" }: { title: string; sub?: string; children: React.ReactNode; className?: string }) {
  return (
    // Every panel exports as a snapshot card, same as the flows and analytics
    // charts. framed=false: the panel already carries its own heading.
    <Shareable title={title} subtitle={sub} framed={false}>
      <section className={`panel stc-panel ${className}`}>
        <div className="section-head" style={{ color: "var(--text-dark)" }}>{title}</div>
        {sub && <p className="stc-sub" style={MUTED}>{sub}</p>}
        <div className="stc-body">{children}</div>
      </section>
    </Shareable>
  );
}

function TipBox({ children }: { children: React.ReactNode }) {
  return <div className="stc-tip">{children}</div>;
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="stc-legend">
      {items.map(([l, c]) => (
        <span key={l} style={MUTED}>
          <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 2, background: c, display: "inline-block" }} />
          {l}
        </span>
      ))}
    </div>
  );
}

// ── KPI tiles ────────────────────────────────────────────────────────────

function Spark({ data, k }: { data: ActivityDay[]; k: "volume" | "txs" | "senders" }) {
  if (data.length < 2) return null;
  return (
    <div style={{ height: 34, marginTop: 8 }} aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <Area dataKey={k} type="monotone" stroke="var(--accent-olive)" strokeWidth={1.5} fill="var(--accent-olive)" fillOpacity={0.14} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function Kpi({ label, value, note, spark }: { label: string; value: string; note: string; spark?: React.ReactNode }) {
  return (
    <Shareable title={label} subtitle="Stablecoins on TX" framed={false}>
      <div className="stc-kpi">
        <div className="card-title" style={CARD_TITLE}>{label}</div>
        <div className="mono stc-kpi-value" style={{ color: "var(--text-dark)" }}>{value}</div>
        <div style={{ ...MUTED, fontSize: "0.76rem" }}>{note}</div>
        {spark}
      </div>
    </Shareable>
  );
}

// ── activity ─────────────────────────────────────────────────────────────

function ActivityChart({ a }: { a: Activity }) {
  return (
    <>
      <div style={{ height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={a.days} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(128,128,128,0.2)" />
            <XAxis dataKey="day" tickFormatter={dayLabel} tick={AXIS} tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis yAxisId="v" tickFormatter={(v) => usd(v as number)} tick={AXIS} tickLine={false} axisLine={false} width={52} />
            <YAxis yAxisId="t" orientation="right" tick={AXIS} tickLine={false} axisLine={false} width={34} allowDecimals={false} />
            <Tooltip
              cursor={{ fill: "rgba(128,128,128,0.08)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as ActivityDay;
                return (
                  <TipBox>
                    <strong>{dayLabel(d.day)}</strong>
                    <span>moved <b className="mono">{usd(d.volume)}</b></span>
                    <span>on chain <b className="mono">{usd(d.chain)}</b></span>
                    <span>IBC in <b className="mono">{usd(d.ibcIn)}</b> · out <b className="mono">{usd(d.ibcOut)}</b></span>
                    <span><b className="mono">{d.txs}</b> transactions, <b className="mono">{d.senders}</b> senders</span>
                  </TipBox>
                );
              }}
            />
            <Bar yAxisId="v" dataKey="chain" stackId="v" fill={C.chain} isAnimationActive={false} />
            <Bar yAxisId="v" dataKey="ibcIn" stackId="v" fill={C.ibcIn} isAnimationActive={false} />
            <Bar yAxisId="v" dataKey="ibcOut" stackId="v" fill={C.ibcOut} radius={[3, 3, 0, 0]} isAnimationActive={false} />
            <Line yAxisId="t" dataKey="txs" type="linear" stroke="var(--text-dark)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <Legend items={[["On chain", C.chain], ["IBC in", C.ibcIn], ["IBC out", C.ibcOut], ["Transactions (right axis)", "var(--text-dark)"]]} />
    </>
  );
}

// ── USTX monitor ─────────────────────────────────────────────────────────

function WatchRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="stc-watchrow">
      <span style={{ display: "flex", alignItems: "center", color: "var(--text-dark)" }}>
        <span aria-hidden="true" className="stc-dot" />
        {label}
      </span>
      <span className="mono" style={MUTED}>{value}</span>
    </div>
  );
}

function UstxMonitor({ d }: { d: Payload }) {
  const u = d.ustx;
  const issued = u?.issued ?? false;
  const headline = issued ? "Live on TX" : u?.testnetDenom ? "On testnet only" : "Not issued yet";
  const rec = d.recording;
  return (
    <Panel title="USTX" sub="Brale's native stablecoin for TX, announced for October 2026." className="stc-ustx">
      <div className="stc-ustx-status" style={{ color: issued ? "var(--text-accent)" : "var(--text-dark)" }}>{headline}</div>
      <div style={{ display: "grid", gap: 8 }}>
        <WatchRow label="Brale mainnet issuer" value={u ? `checked ${ago(u.checkedAt)}` : "n/a"} />
        <WatchRow label="Brale testnet issuer" value={u ? `checked ${ago(u.checkedAt)}` : "n/a"} />
        <WatchRow label="USTX symbol scan" value={u ? `checked ${ago(u.checkedAt)}` : "n/a"} />
      </div>
      <div className="stc-ustx-foot">
        <span style={{ color: "var(--text-dark)" }}>Recording since</span>
        <span className="mono" style={MUTED}>{rec?.since ? `${dateOnly(rec.since)} · ${rec.snapshots} runs` : "not started"}</span>
      </div>
    </Panel>
  );
}

// ── who holds ────────────────────────────────────────────────────────────

function WhoHolds({ d }: { d: Payload }) {
  const rows = d.coins
    .filter((c) => c.role !== "test" && c.breakdown)
    .map((c) => ({ symbol: c.symbol, holders: c.holders, ...c.breakdown! }));
  return (
    <Panel title="Who holds the dollar" sub="Share of each coin, largest wallet first.">
      <div style={{ height: 36 + rows.length * 48 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }} barSize={20}>
            <XAxis type="number" domain={[0, 1]} tickFormatter={(v) => `${Math.round((v as number) * 100)}%`} tick={AXIS} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="symbol" tick={{ ...AXIS, fill: "var(--text-dark)", fontWeight: 700 }} tickLine={false} axisLine={false} width={48} />
            <Tooltip
              cursor={{ fill: "rgba(128,128,128,0.08)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const r = payload[0].payload as (typeof rows)[number];
                return (
                  <TipBox>
                    <strong>{r.symbol} · {r.holders?.toLocaleString("en-US") ?? "?"} holders</strong>
                    <span>largest wallet <b className="mono">{pct(r.top1)}</b></span>
                    <span>second <b className="mono">{pct(r.second)}</b></span>
                    <span>next eight <b className="mono">{pct(r.next8)}</b></span>
                    <span>everyone else <b className="mono">{pct(r.rest)}</b></span>
                  </TipBox>
                );
              }}
            />
            {(["top1", "second", "next8", "rest"] as const).map((k, i) => (
              <Bar key={k} dataKey={k} stackId="h" fill={BANDS[i]} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {!d.ustx?.issued && (
        <div className="stc-placeholder">
          <span style={{ fontWeight: 700, ...MUTED }}>USTX</span>
          <span className="stc-placeholder-bar" />
          <span className="mono" style={{ ...MUTED, fontSize: "0.76rem" }}>awaiting first mint</span>
        </div>
      )}
      <Legend items={BAND_LABELS.map((l, i) => [l, BANDS[i]] as [string, string])} />
    </Panel>
  );
}

function HolderSizes({ c }: { c: Coin }) {
  const total = c.supply || 1;
  const walletsTotal = c.sizes!.reduce((s, b) => s + b.wallets, 0) || 1;
  const rows = c.sizes!.map((b) => ({ ...b, walletShare: b.wallets / walletsTotal, dollarShare: b.amount / total }));
  return (
    <Panel title={`${c.symbol} wallets by size`} sub="Share of wallets against share of dollars, per balance band.">
      <div style={{ height: 40 + rows.length * 44 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }} barGap={2} barSize={12}>
            <XAxis type="number" domain={[0, 1]} tickFormatter={(v) => `${Math.round((v as number) * 100)}%`} tick={AXIS} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="label" tick={{ ...AXIS, fill: "var(--text-dark)" }} tickLine={false} axisLine={false} width={96} />
            <Tooltip
              cursor={{ fill: "rgba(128,128,128,0.08)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const r = payload[0].payload as (typeof rows)[number];
                return (
                  <TipBox>
                    <strong>{r.label}</strong>
                    <span><b className="mono">{r.wallets.toLocaleString("en-US")}</b> wallets, {pct(r.walletShare)}</span>
                    <span>hold <b className="mono">{num(r.amount)}</b>, {pct(r.dollarShare)} of supply</span>
                  </TipBox>
                );
              }}
            />
            <Bar dataKey="walletShare" fill={C.grey} radius={[0, 3, 3, 0]} isAnimationActive={false} />
            <Bar dataKey="dollarShare" fill={C.chain} radius={[0, 3, 3, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <Legend items={[["Share of wallets", C.grey], ["Share of dollars", C.chain]]} />
    </Panel>
  );
}

// ── holders ──────────────────────────────────────────────────────────────

const KIND_STYLE: Record<HolderKind, { color: string; background: string }> = {
  dex: { color: "var(--text-accent)", background: "rgba(128,128,128,0.10)" },
  contract: { color: "var(--text-dark)", background: "rgba(128,128,128,0.10)" },
  known: { color: "var(--text-dark)", background: "rgba(128,128,128,0.10)" },
  wallet: { color: "var(--text-light)", background: "transparent" },
};

function HolderList({ c }: { c: Coin }) {
  const max = c.topHolders[0]?.share || 1;
  return (
    <Shareable title={`Largest ${c.symbol} holders`} subtitle="Stablecoins on TX" framed={false}>
    <div className="panel" style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, paddingRight: 40 }}>
        <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-dark)" }}>{c.symbol}</div>
        <div className="mono" style={{ ...MUTED, fontSize: "0.8rem" }}>top 10 of {c.holders?.toLocaleString("en-US") ?? "?"}</div>
      </div>
      <ol style={{ listStyle: "none", padding: 0, margin: "12px 0 0" }}>
        {c.topHolders.map((h, i) => {
          const ks = KIND_STYLE[h.kind];
          return (
            <li key={h.address} className="stc-holder">
              <span className="mono" style={{ ...MUTED, width: 20 }}>{i + 1}</span>
              <span style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
                <span
                  className="mono"
                  style={{ fontSize: "0.72rem", color: ks.color, background: ks.background, borderRadius: 4, padding: h.kind === "wallet" ? 0 : "1px 6px", alignSelf: "flex-start" }}
                >
                  {h.label ?? "Unlabelled wallet"}
                </span>
                <a href={`/passport/${h.address}`} className="mono stc-addr" style={{ color: "var(--text-dark)" }}>{short(h.address)}</a>
                <span className="stc-share" aria-hidden="true"><span style={{ width: `${(h.share / max) * 100}%` }} /></span>
              </span>
              <span className="mono" style={{ textAlign: "right", color: "var(--text-dark)" }}>{num(h.amount)}</span>
              <span className="mono" style={{ textAlign: "right", ...MUTED }}>{pct(h.share)}</span>
            </li>
          );
        })}
      </ol>
    </div>
    </Shareable>
  );
}

// ── routes ───────────────────────────────────────────────────────────────

function Routes({ d }: { d: Payload }) {
  const f = d.usdc.fragments;
  if (f.length === 0) return null;
  const TOP = 6;
  const rows = f.slice(0, TOP).map((r, i) => ({
    name: i === 0 ? "noble-1, main" : `${r.viaChain ?? r.firstChannel}, ${r.hops} hop${r.hops === 1 ? "" : "s"}`,
    amount: r.amount,
    main: i === 0,
  }));
  const rest = f.slice(TOP);
  if (rest.length) rows.push({ name: `${rest.length} other routes`, amount: rest.reduce((s, r) => s + r.amount, 0), main: false });
  return (
    <Panel title={`One dollar, ${d.usdc.routes} tokens`} sub="Each IBC route mints its own USDC. They do not swap one for one.">
      <div style={{ height: 30 + rows.length * 34 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }} barSize={16}>
            <XAxis type="number" scale="log" domain={[1, 100_000]} ticks={[1, 10, 100, 1_000, 10_000, 100_000]} allowDataOverflow tickFormatter={(v) => usd(v as number)} tick={AXIS} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="name" tick={{ ...AXIS, fill: "var(--text-dark)" }} tickLine={false} axisLine={false} width={172} />
            <Tooltip
              cursor={{ fill: "rgba(128,128,128,0.08)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const r = payload[0].payload as (typeof rows)[number];
                return <TipBox><strong>{r.name}</strong><span><b className="mono">{num(r.amount)}</b> USDC</span></TipBox>;
              }}
            />
            <Bar dataKey="amount" radius={[0, 3, 3, 0]} isAnimationActive={false}>
              {rows.map((r) => <Cell key={r.name} fill={r.main ? C.chain : C.ibcOut} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div style={{ ...MUTED, fontSize: "0.76rem", marginTop: 6 }}>
        Log scale. The main route holds <span className="mono" style={{ color: "var(--text-dark)" }}>{pct(d.usdc.canonicalShare)}</span> of{" "}
        <span className="mono" style={{ color: "var(--text-dark)" }}>{num(d.usdc.total)}</span> USDC.
      </div>
    </Panel>
  );
}

// ── smart token controls ─────────────────────────────────────────────────

// x/assetft features, in the order a holder cares about them, with what each
// one lets the issuer do.
const FEATURES: [string, string, string][] = [
  ["minting", "Mint", "create new supply"],
  ["burning", "Burn", "destroy supply it holds"],
  ["freezing", "Freeze", "lock any holder's balance"],
  ["whitelisting", "Allowlist", "cap what each wallet may hold"],
  ["clawback", "Clawback", "take a balance back"],
  ["ibc", "IBC", "let the coin leave over IBC"],
];

function ControlsMatrix({ d }: { d: Payload }) {
  const native = d.coins.filter((c) => c.controls);
  if (native.length === 0) return null;
  return (
    <Panel title="What the issuer can do" sub="Smart Token features, fixed at issuance. USDC's controls live on Noble.">
      <div style={{ overflowX: "auto" }}>
        <table className="stc-matrix">
          <thead>
            <tr>
              <th style={MUTED}>Coin</th>
              {FEATURES.map(([, l]) => <th key={l} style={MUTED}>{l}</th>)}
            </tr>
          </thead>
          <tbody>
            {native.map((c) => (
              <tr key={c.denom}>
                <td style={{ color: "var(--text-dark)", fontWeight: 700 }}>{c.symbol}</td>
                {FEATURES.map(([k, l]) => {
                  const on = c.controls!.features.includes(k);
                  return (
                    <td key={k}>
                      <span className={`stc-chip ${on ? "on" : ""}`} aria-label={`${l} ${on ? "enabled" : "off"}`}>{on ? "on" : "off"}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="stc-defs">
        {FEATURES.map(([k, l, what]) => (
          <div key={k}><dt style={{ color: "var(--text-dark)" }}>{l}</dt><dd style={MUTED}>{what}</dd></div>
        ))}
      </dl>
    </Panel>
  );
}

// ── supply over time ─────────────────────────────────────────────────────

function SupplyHistory({ d }: { d: Payload }) {
  const main = d.coins.filter((c) => c.role !== "test");
  const series = main
    .map((c) => ({ c, pts: d.history.points.filter((p) => p.denom === c.denom) }))
    .filter((s) => s.pts.length > 1);
  if (series.length === 0) {
    return (
      <Panel title="Supply over time">
        <p style={{ ...MUTED, margin: 0 }}>
          {d.history.available ? "Recording. The chart draws after the second hourly run." : "Starts with the hourly collector. The chain keeps no holder history."}
        </p>
      </Panel>
    );
  }
  return (
    <Panel title="Supply over time" sub={`Hourly, recorded since ${d.recording?.since ? dateOnly(d.recording.since) : "the first run"}.`}>
      <div className="stc-grid-2">
        {series.map(({ c, pts }) => {
          const data = pts.map((p) => ({ t: new Date(p.takenAt).getTime(), supply: p.supply, holders: p.holders }));
          return (
            <div key={c.denom}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", marginBottom: 4 }}>
                <span style={{ color: "var(--text-dark)", fontWeight: 700 }}>{c.symbol}</span>
                <span className="mono" style={MUTED}>{num(data[data.length - 1].supply)}</span>
              </div>
              <div style={{ height: 120 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                    <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} hide />
                    <YAxis domain={["auto", "auto"]} hide />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const p = payload[0].payload as (typeof data)[number];
                        return (
                          <TipBox>
                            <strong>{new Date(p.t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC</strong>
                            <span>supply <b className="mono">{num(p.supply)}</b></span>
                            <span>holders <b className="mono">{p.holders ?? "?"}</b></span>
                          </TipBox>
                        );
                      }}
                    />
                    <Area dataKey="supply" type="stepAfter" stroke={C.chain} strokeWidth={1.5} fill={C.chain} fillOpacity={0.14} isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// ── page ─────────────────────────────────────────────────────────────────

export default function StablecoinsTab() {
  const { data: d, error } = useStablecoins();

  if (!d) {
    return (
      <div className="panel" style={{ padding: 24 }}>
        <p style={{ ...MUTED, margin: 0 }}>
          {error ? `Could not reach the chain (${error}). Retrying.` : "Reading stablecoins from the chain."}
        </p>
      </div>
    );
  }

  const main = d.coins.filter((c) => c.role !== "test");
  const tests = d.coins.filter((c) => c.role === "test");
  const usdc = main.find((c) => c.symbol === "USDC");
  const sbc = main.find((c) => c.symbol === "SBC");
  // All USDC routes, not only the canonical one, plus SBC.
  const totalStable = d.usdc.total + (sbc?.supply ?? 0);
  const act = d.activity?.find((a) => a.denom === usdc?.denom) ?? null;
  const withHolders = main.filter((c) => c.topHolders.length > 0);
  const pending = "from the next collector run";

  return (
    <div>
      <style>{`
        .stc-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
        .stc-kpi { padding: 18px 20px; min-width: 0; }
        .stc-kpis > .shareable + .shareable { border-left: 1px solid rgba(128,128,128,0.18); }
        .stc-kpi-value { font-size: 1.7rem; margin: 4px 0 2px; white-space: nowrap; }
        .stc-panel { padding: 22px 24px; display: flex; flex-direction: column; min-width: 0; }
        .stc-panel .section-head { padding-right: 40px; }
        .stc-kpi .card-title { padding-right: 32px; }
        .stc-sub { margin: 4px 0 14px; font-size: 0.84rem; line-height: 1.5; }
        .stc-body { flex: 1; display: flex; flex-direction: column; min-width: 0; }
        .stc-row { display: grid; gap: 14px; margin-top: 14px; align-items: stretch; }
        .stc-row-main { grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); }
        .stc-grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
        .stc-legend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: auto; padding-top: 10px; font-size: 0.76rem; }
        .stc-legend > span { display: flex; align-items: center; gap: 6px; }
        .stc-tip { display: grid; gap: 3px; padding: 8px 10px; border-radius: 8px; font-size: 0.78rem;
                   background: var(--paper, var(--glass-bg)); color: var(--text-dark);
                   border: 1px solid rgba(128,128,128,0.3); box-shadow: 0 6px 20px rgba(0,0,0,0.18); }
        .stc-tip b { font-weight: 700; }
        .stc-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--accent-olive); margin-right: 8px; flex-shrink: 0; }
        .stc-watchrow { display: flex; justify-content: space-between; gap: 12px; font-size: 0.82rem; align-items: center; }
        .stc-ustx-status { font-size: 1.6rem; font-weight: 700; margin: 0 0 16px; }
        .stc-ustx-foot { display: flex; justify-content: space-between; gap: 12px; font-size: 0.82rem;
                         border-top: 1px solid rgba(128,128,128,0.2); padding-top: 10px; margin-top: 16px; }
        .stc-placeholder { display: grid; grid-template-columns: 38px minmax(0, 1fr) auto; gap: 10px; align-items: center; margin: 4px 8px 0 0; font-size: 0.8rem; }
        .stc-placeholder-bar { height: 20px; border-radius: 4px; border: 1px dashed rgba(128,128,128,0.5); }
        .stc-holder { display: grid; grid-template-columns: 20px minmax(0, 1fr) auto 58px; gap: 10px; align-items: center;
                      padding: 8px 0; border-top: 1px solid rgba(128,128,128,0.16); font-size: 0.84rem; }
        .stc-addr { font-size: 0.8rem; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .stc-addr:hover { text-decoration: underline; }
        .stc-share { display: block; height: 3px; margin-top: 4px; border-radius: 2px; background: rgba(128,128,128,0.12); }
        .stc-share > span { display: block; height: 100%; border-radius: 2px; background: var(--accent-olive); }
        .stc-matrix { width: 100%; border-collapse: collapse; font-size: 0.84rem; }
        .stc-matrix th { font-weight: 500; text-align: left; padding: 6px 8px; font-size: 0.76rem; }
        .stc-matrix td { padding: 10px 8px; border-top: 1px solid rgba(128,128,128,0.18); }
        .stc-defs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 16px; margin: auto 0 0; padding-top: 14px; font-size: 0.78rem; }
        .stc-defs > div { display: flex; gap: 6px; }
        .stc-defs dt { font-weight: 700; }
        .stc-defs dd { margin: 0; }
        .stc-chip { font-family: var(--font-mono); font-size: 0.72rem; padding: 2px 8px; border-radius: 10px;
                    color: var(--text-light); background: rgba(128,128,128,0.10); }
        .stc-chip.on { color: var(--text-dark); background: color-mix(in srgb, var(--accent-olive) 28%, transparent); font-weight: 700; }
        @media (max-width: 980px) {
          .stc-row-main, .stc-grid-2 { grid-template-columns: minmax(0, 1fr); }
          .stc-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .stc-kpis > .shareable:nth-child(3) { border-left: none; }
          .stc-kpis > .shareable:nth-child(n+3) { border-top: 1px solid rgba(128,128,128,0.18); }
        }
        @media (max-width: 520px) {
          .stc-kpi { padding: 14px 12px; }
          .stc-kpi-value { font-size: 1.2rem; }
          .stc-panel { padding: 18px 14px; }
          .stc-defs { grid-template-columns: minmax(0, 1fr); }
        }
      `}</style>

      <div style={{ marginBottom: 16 }}>
        <h1 className="page-title" style={{ color: "var(--text-dark)" }}>Stablecoins on TX</h1>
        <p className="section-sub" style={{ ...MUTED, marginTop: 4 }}>
          Every dollar on the chain, read live. Updated {ago(d.updatedAt)}.
        </p>
      </div>

      <div className="panel stc-kpis">
        <Kpi label="Dollars on chain" value={usd(totalStable)} note="all USDC routes plus SBC" />
        <Kpi
          label="USDC moved, 30d"
          value={act ? usd(act.volume) : "n/a"}
          note={act ? "largest leg per transaction" : pending}
          spark={act && <Spark data={act.days} k="volume" />}
        />
        <Kpi
          label="USDC transactions, 30d"
          value={act ? act.txs.toLocaleString("en-US") : "n/a"}
          note={act ? `about ${Math.round(act.txs / Math.max(1, act.days.length))} a day` : pending}
          spark={act && <Spark data={act.days} k="txs" />}
        />
        <Kpi
          label="Wallets using USDC, 30d"
          value={act ? act.wallets.toLocaleString("en-US") : "n/a"}
          note={usdc?.holders != null ? `${usdc.holders.toLocaleString("en-US")} hold it now` : pending}
          spark={act && <Spark data={act.days} k="senders" />}
        />
      </div>

      <div className="stc-row stc-row-main">
        <Panel
          title="USDC activity"
          sub={act?.since ? `Daily dollars moved and transactions, since ${dateOnly(act.since)}.` : "Daily dollars moved and transactions."}
        >
          {act && act.days.length > 0
            ? <ActivityChart a={act} />
            : <p style={{ ...MUTED, margin: 0 }}>Transfers are recorded by the hourly collector. The chart fills after its next run.</p>}
        </Panel>
        <UstxMonitor d={d} />
      </div>

      <div className="stc-row stc-grid-2">
        <WhoHolds d={d} />
        {usdc?.sizes && <HolderSizes c={usdc} />}
      </div>

      {withHolders.length > 0 && (
        <div className="stc-row stc-grid-2">
          {withHolders.map((c) => <HolderList key={c.denom} c={c} />)}
        </div>
      )}

      <div className="stc-row stc-grid-2">
        <Routes d={d} />
        <ControlsMatrix d={d} />
      </div>

      <div className="stc-row">
        <SupplyHistory d={d} />
      </div>

      {tests.length > 0 && (
        <div style={{ ...MUTED, fontSize: "0.8rem", marginTop: 14, lineHeight: 1.6 }}>
          Also issued by Brale on mainnet, at test size:{" "}
          {tests.map((t, i) => (
            <span key={t.denom} className="mono" style={{ color: "var(--text-dark)" }}>
              {t.symbol} {num(t.supply)}{i < tests.length - 1 ? ", " : ""}
            </span>
          ))}
          .
        </div>
      )}
    </div>
  );
}
