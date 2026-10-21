"use client";

// /stablecoins. Every dollar on TX, read live from the chain.
//
// Built ahead of USTX, Brale's native stablecoin for TX, announced for October
// 2026. Chart first: the page answers "how much, who holds it, is it used,
// what can the issuer do" with a picture each, and keeps prose to one line
// per section. Every figure comes from /api/stablecoins, which reads the chain
// live and the hourly collector's tables (migrations 021 and 022).

import { Fragment, useEffect, useState } from "react";
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
import Shareable, { useInSnapshot } from "@/components/share/Shareable";
import { FilmButton } from "@/components/StablecoinsFilm";

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
  ustxFlows: SupplyFlows | null;
}
interface SupplyDay { day: string; minted: number; burned: number }
interface SupplyFlows {
  denom: string; since: string | null; startSupply: number; supplyNow: number;
  minted: number; burned: number; days: SupplyDay[];
  transfers: number; wallets: number; preview: boolean;
}

const REFRESH_MS = 5 * 60_000;

// Same pattern as the other hooks in src/hooks: fetch on mount, refresh on an
// interval, keep the last good payload through a failed refresh.
const STYLES = `
        .ustx-flow { display: grid; grid-template-columns: minmax(0,1fr) 28px minmax(0,1fr) 28px minmax(0,1fr); align-items: start; gap: 8px; }
        .ustx-node { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 4px; min-width: 0; }
        .ustx-token { width: 52px; height: 52px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
                      font-family: var(--font-mono); font-size: 0.68rem; font-weight: 700; letter-spacing: 0.02em; margin-bottom: 6px; }
        .ustx-token-usdc { border: 1.5px solid rgba(128,128,128,0.5); color: var(--text-dark); }
        .ustx-token-brale { border: 1.5px dashed rgba(128,128,128,0.6); color: var(--text-dark); }
        .ustx-token-ustx { background: var(--tx-neon); color: #101208; box-shadow: 0 0 0 5px color-mix(in srgb, var(--tx-neon) 20%, transparent); }
        .ustx-node-title { font-weight: 700; font-size: 0.9rem; color: var(--text-dark); }
        .ustx-node-sub { font-size: 0.76rem; color: var(--text-light); line-height: 1.35; }
        .ustx-arrow { color: var(--text-light); align-self: start; margin-top: 20px; display: flex; justify-content: center; }
        .ustx-rate { margin: 18px auto 0; padding: 8px 18px; border-radius: 999px; font-size: 0.9rem; font-weight: 700; text-align: center; width: fit-content;
                     color: var(--text-dark); border: 1px solid color-mix(in srgb, var(--accent-olive) 70%, transparent);
                     background: color-mix(in srgb, var(--accent-olive) 14%, transparent); }
        .ustx-from { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 6px; margin-top: 16px; }
        .ustx-from-label { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-light); margin-right: 2px; }
        .ustx-chip { font-size: 0.72rem; padding: 2px 9px; border-radius: 999px; border: 1px solid rgba(128,128,128,0.3); color: var(--text-dark); }
        .ustx-chip-later { border-style: dashed; color: var(--text-medium); }
        .ustx-actions { display: flex; align-items: center; justify-content: space-between; gap: 10px 16px; flex-wrap: wrap;
                        margin-top: auto; padding-top: 18px; }
        .ustx-status { font-size: 0.74rem; padding: 4px 10px; border-radius: 999px; background: rgba(128,128,128,0.12); color: var(--text-dark); }
        .stc-link { color: var(--text-accent); font-size: 0.82rem; font-weight: 600; text-decoration: underline; text-underline-offset: 2px; }
        .ustx-bars { display: grid; gap: 16px; }
        .ustx-bar-head { display: flex; justify-content: space-between; gap: 10px; font-size: 0.86rem; margin-bottom: 6px; }
        .ustx-bar { height: 14px; border-radius: 7px; background: rgba(128,128,128,0.10); overflow: hidden; }
        .ustx-bar > span { display: block; height: 100%; background: var(--tx-neon); }
        .ustx-bar-empty { background: transparent; border: 1px dashed rgba(128,128,128,0.5); }
        .ustx-bar-note { font-size: 0.74rem; color: var(--text-light); margin-top: 5px; }
        .ustx-eq { flex: 1; display: grid; grid-template-columns: minmax(0,1fr) auto minmax(0,1fr); align-items: center; gap: 12px; min-height: 180px; }
        .ustx-eq-side { display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center; }
        .ustx-eq-v { font-size: clamp(2.2rem, 5vw, 3.4rem); line-height: 1; font-weight: 600; }
        .ustx-eq-k { font-size: 0.86rem; color: var(--text-light); }
        .ustx-eq-sign { font-size: 2.4rem; color: var(--text-accent); font-weight: 700; }
        .ustx-eq-note { text-align: center; font-size: 0.8rem; color: var(--text-light); margin: 0; }
        .ustx-cadence { margin-top: 18px; }
        .ustx-coverage { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 18px; align-items: center;
                         padding: 14px 16px; border-radius: 12px; background: rgba(128,128,128,0.07); margin-bottom: 18px; }
        .ustx-coverage-v { font-size: 2.2rem; line-height: 1.05; margin-top: 2px; }
        .ustx-coverage-note { font-size: 0.78rem; line-height: 1.5; color: var(--text-light); }
        .ustx-ticks { display: grid; grid-template-columns: repeat(30, minmax(0, 1fr)); gap: 3px; align-items: end; height: 34px; }
        .ustx-tick { height: 40%; border-radius: 2px; background: color-mix(in srgb, var(--accent-olive) 55%, transparent); }
        .ustx-tick-month { height: 100%; background: var(--tx-neon); box-shadow: 0 0 0 2px color-mix(in srgb, var(--tx-neon) 25%, transparent); }
        .ustx-cadence-legend { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 6px 14px; margin-top: 8px; font-size: 0.76rem; color: var(--text-light); }
        .ustx-cadence-legend span { display: inline-flex; align-items: center; gap: 6px; }
        .ustx-key { width: 8px; height: 8px; border-radius: 2px; display: inline-block; background: color-mix(in srgb, var(--accent-olive) 55%, transparent); }
        .ustx-key-month { background: var(--tx-neon); }
        .ustx-diagram { width: 100%; height: auto; display: block; }
        .ustx-narrow { display: none; }
        @media (max-width: 640px) {
          .ustx-diagram { display: none; }
          .ustx-narrow { display: grid; }
          .ustx-from.ustx-narrow { display: flex; }
        }
        @media (prefers-reduced-motion: reduce) { .ud-dot { display: none; } }
        .ustx-ghost { position: absolute; inset: 16px 16px 0; display: flex; align-items: flex-end; gap: 6%; opacity: 0.9; }
        .ustx-ghost span { flex: 1; border-radius: 3px 3px 0 0; background: linear-gradient(to top, rgba(128,128,128,0.28), rgba(128,128,128,0.06)); }
        .ustx-waiting-label { position: relative; display: grid; gap: 4px; justify-items: center; padding: 10px 16px; border-radius: 12px;
                              background: var(--glass-bg); border: 1px solid rgba(128,128,128,0.25); }
        .ustx-big { font-size: 1.5rem; margin: 4px 0 2px; }
        .ustx-waiting { position: relative; overflow: hidden; display: grid; gap: 6px; place-content: center; text-align: center; min-height: 200px;
                        border: 1px dashed rgba(128,128,128,0.45); border-radius: 12px; padding: 20px; }
        .ustx-preview { font-size: 0.74rem; padding: 6px 10px; border-radius: 8px; margin-bottom: 12px;
                        background: color-mix(in srgb, var(--accent-orange) 22%, transparent); color: var(--text-dark); }
        .ustx-track { display: grid; gap: 14px; }
        .ustx-foot-line { font-size: 0.78rem; color: var(--text-light); }
        .ustx-kpis { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
        @media (max-width: 520px) {
          .ustx-kpis { grid-template-columns: minmax(0, 1fr); }
          .ustx-flow { grid-template-columns: minmax(0,1fr) 18px minmax(0,1fr) 18px minmax(0,1fr); gap: 4px; }
          .ustx-arrow svg { width: 18px; }
        }
        .stc-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px 20px; flex-wrap: wrap; margin-bottom: 16px; }
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
        .stc-supply-grid { display: grid; grid-template-columns: repeat(var(--cols, 2), minmax(0, 1fr)); gap: 14px; }
        .stc-supply-card { padding: 16px 18px 12px; border-radius: 12px; background: rgba(128,128,128,0.07); min-width: 0; }
        .stc-supply-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
        .stc-supply-sym { font-weight: 700; font-size: 1rem; color: var(--text-dark); }
        .stc-supply-now { font-size: 1.5rem; color: var(--text-dark); }
        .stc-supply-sub { font-size: 0.76rem; color: var(--text-medium); margin: 4px 0 10px; }
        .stc-supply-axis { display: flex; justify-content: space-between; font-size: 0.72rem; color: var(--text-medium); margin-top: 6px; }
        @media (max-width: 1180px) { .stc-supply-grid { grid-template-columns: minmax(0, 1fr); } }
        .stc-holder-summary { margin-top: auto; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px;
                              padding: 14px 16px; border-radius: 12px; background: rgba(128,128,128,0.07); }
        .stc-holders-row { grid-template-columns: repeat(var(--cols, 2), minmax(0, 1fr)); }
        @media (max-width: 1180px) { .stc-holders-row { grid-template-columns: minmax(0, 1fr); } }
        /* The card is stretched to the routes chart beside it; the rows take
           that height instead of leaving a gap above the definitions. */
        .stc-matrix-wrap { flex: 1; overflow-x: auto; display: flex; }
        .stc-matrix { width: 100%; height: 100%; border-collapse: collapse; font-size: 0.84rem; }
        .stc-matrix th { font-weight: 500; text-align: left; padding: 6px 8px; font-size: 0.76rem; }
        .stc-matrix td { padding: 10px 8px; border-top: 1px solid rgba(128,128,128,0.18); }
        .stc-defs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 16px; margin: 0; padding-top: 14px; font-size: 0.78rem; }
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
      
        .stc-skel-panel { min-height: var(--skel-h); }
        .stc-skel-kpis { height: 206px; overflow: hidden; }
        @media (max-width: 980px) { .stc-skel-panel { min-height: var(--skel-hm); } .stc-skel-kpis { height: 336px; } }
        .stc-skel { border-radius: 6px; background: linear-gradient(90deg, rgba(128,128,128,0.10) 0%, rgba(128,128,128,0.20) 50%, rgba(128,128,128,0.10) 100%);
                    background-size: 200% 100%; animation: skeleton-shimmer 1.4s linear infinite; }
        .stc-skel-bars { flex: 1; display: flex; align-items: flex-end; gap: 3%; min-height: 150px; }
        .stc-skel-bars > span { flex: 1; border-radius: 3px 3px 0 0; }
        .stc-loading-note { font-size: 0.8rem; color: var(--text-dark); padding: 8px 12px; border-radius: 10px; margin-bottom: 12px;
                            background: color-mix(in srgb, var(--accent-orange) 20%, transparent); }
        @media (prefers-reduced-motion: reduce) { .stc-skel { animation: none; } }
`;

function useStablecoins() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        // ?previewFlows=<denom> only does anything outside production.
        const q = new URLSearchParams(window.location.search).get("previewFlows");
        const res = await fetch(`/api/stablecoins${q ? `?previewFlows=${encodeURIComponent(q)}` : ""}`, { cache: "no-store" });
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

// First hourly snapshot of USTX, which the collector writes the hour it
// appears. Null before launch.
function ustxSince(d: Payload): string | null {
  const den = d.ustx?.issued ? d.ustx.denom : null;
  if (!den) return null;
  const first = d.history.points.filter((p) => p.denom === den).map((p) => p.takenAt).sort()[0];
  return first ? dateOnly(first) : null;
}

function UstxMonitor({ d }: { d: Payload }) {
  const u = d.ustx;
  const issued = u?.issued ?? false;
  const headline = issued ? "Live on TX" : u?.testnetDenom ? "On testnet only" : "Not issued yet";
  const rec = d.recording;
  return (
    <Panel title="USTX" sub={ustxSince(d) ? `Brale's native stablecoin for TX, on mainnet since ${ustxSince(d)}.` : "Brale's native stablecoin for TX, announced for October 2026."} className="stc-ustx">
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


// ── USDC to USTX ─────────────────────────────────────────────────────────

// From tx's announcement, 2026-09-28. Brale runs the conversion; this page
// only reads the result on chain and links to their flow.
const ANNOUNCEMENT = "https://x.com/txEcosystem/status/2104606576997024056";
// Public minting opened 2026-10-20 in the tx wallet. Set this to the
// conversion page once there is one public URL to send people to.
const GET_USTX_URL: string | null = null;
// USDC routes Brale accepts at launch, then the ones announced for later.
// Live first, so the diagram reads top down.
const LIVE_CHAINS = ["Ethereum", "Base", "Polygon", "Solana"];
const LATER_CHAINS = ["Arbitrum", "Optimism", "Avalanche", "Celo"];
const SOURCE_CHAINS = [...LIVE_CHAINS, ...LATER_CHAINS];
// Brale's reserve reports are monthly PDFs per coin, with no data feed.
const BRALE_SBC_PAGE = "https://brale.xyz/stablecoins/SBC";

// The wide version of the flow: eight source chains fan into USDC, then
// USDC, Brale, USTX. A dot travels each path so the direction reads without
// words. Colours come from classes so both themes apply.
function FlowDiagram() {
  // A snapshot is a still: dots only have a position while animating.
  const still = useInSnapshot();
  const W = 640, H = 262, cy = H / 2 + 6;
  const chainX = 8, chainW = 92, gap = 27;
  const top = cy - ((SOURCE_CHAINS.length - 1) * gap) / 2;
  const usdc = { x: 250, y: cy }, brale = { x: 410, y: cy }, ustx = { x: 570, y: cy };
  const R = 34;
  const fan = SOURCE_CHAINS.map((c, i) => {
    const y = top + i * gap;
    const x0 = chainX + chainW;
    return { c, y, later: i >= LIVE_CHAINS.length, d: `M${x0},${y} C${x0 + 70},${y} ${usdc.x - R - 60},${cy} ${usdc.x - R},${cy}` };
  });
  const mid = `M${usdc.x + R},${cy} L${brale.x - R},${cy}`;
  const end = `M${brale.x + R},${cy} L${ustx.x - R - 6},${cy}`;
  return (
    <svg className="ustx-diagram" viewBox={`0 0 ${W} ${H + 24}`} role="img"
      aria-label="USDC from four chains, with four more to come, goes to Brale, which issues USTX to a tx wallet, one for one">
      {fan.map((f, i) => (
        <g key={f.c}>
          <path d={f.d} fill="none" stroke={f.later ? "rgba(128,128,128,0.2)" : "rgba(128,128,128,0.35)"} strokeWidth={1.3} strokeDasharray={f.later ? "3 4" : undefined} />
          {!still && !f.later && (
          <circle r="2.6" fill="var(--text-dark)" opacity={0.75} className="ud-dot">
            <animateMotion dur="3.2s" begin={`${(i * 0.37).toFixed(2)}s`} repeatCount="indefinite" path={f.d} />
          </circle>
          )}
          <rect x={chainX} y={f.y - 10} width={chainW} height={20} rx={10} fill="var(--glass-bg)" stroke="rgba(128,128,128,0.35)" strokeDasharray={f.later ? "3 3" : undefined} />
          <text x={chainX + chainW / 2} y={f.y + 4} textAnchor="middle" fontSize={10.5} fill={f.later ? "var(--text-medium)" : "var(--text-dark)"}>{f.c}</text>
        </g>
      ))}
      <path d={mid} fill="none" stroke="rgba(128,128,128,0.6)" strokeWidth={1.8} />
      <path d={end} fill="none" stroke="var(--tx-neon)" strokeWidth={2} markerEnd="url(#ud-arrow)" />
      {!still && (
      <circle r="3.2" fill="var(--text-dark)" opacity={0.75} className="ud-dot">
        <animateMotion dur="1.6s" repeatCount="indefinite" path={mid} />
      </circle>
      )}
      {!still && (
      <circle r="3.2" fill="var(--tx-neon)" className="ud-dot">
        <animateMotion dur="1.6s" begin="0.8s" repeatCount="indefinite" path={end} />
      </circle>
      )}
      <defs>
        <marker id="ud-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--tx-neon)" />
        </marker>
      </defs>
      <circle cx={usdc.x} cy={cy} r={R} fill="var(--glass-bg)" stroke="rgba(128,128,128,0.55)" strokeWidth={1.5} />
      <text x={usdc.x} y={cy + 4} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={11} fontWeight={700} fill="var(--text-dark)">USDC</text>
      <circle cx={brale.x} cy={cy} r={R} fill="var(--glass-bg)" stroke="rgba(128,128,128,0.55)" strokeWidth={1.5} strokeDasharray="4 3" />
      <text x={brale.x} y={cy + 4} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={11} fontWeight={700} fill="var(--text-dark)">Brale</text>
      <circle cx={ustx.x} cy={cy} r={R + 7} fill="rgba(177,252,3,0.18)" />
      <circle cx={ustx.x} cy={cy} r={R} fill="var(--tx-neon)" />
      <text x={ustx.x} y={cy + 4} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={11} fontWeight={700} fill="#101208">USTX</text>
      <text x={usdc.x} y={cy + R + 24} textAnchor="middle" fontSize={12.5} fontWeight={700} fill="var(--text-dark)">Send USDC</text>
      <text x={brale.x} y={cy + R + 24} textAnchor="middle" fontSize={12.5} fontWeight={700} fill="var(--text-dark)">Brale issues</text>
      <text x={ustx.x} y={cy + R + 24} textAnchor="middle" fontSize={12.5} fontWeight={700} fill="var(--text-dark)">In your tx wallet</text>
      <text x={(usdc.x + brale.x) / 2} y={cy - 12} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={11} fontWeight={700} fill="var(--text-accent)">1 : 1</text>
      <text x={chainX} y={top - 20} fontSize={10.5} fill="var(--text-light)" letterSpacing="0.08em">4 LIVE, 4 COMING</text>
    </svg>
  );
}

function HowUstx() {
  const nodes: { k: string; title: string; sub: string; tone: "usdc" | "brale" | "ustx" }[] = [
    { k: "USDC", title: "Send USDC", sub: "from a wallet you control", tone: "usdc" },
    { k: "Brale", title: "Brale issues", sub: "backed by its reserves", tone: "brale" },
    { k: "USTX", title: "USTX arrives", sub: "in your tx wallet", tone: "ustx" },
  ];
  return (
    <Panel title="How USDC becomes USTX" sub="Brale runs the conversion. This page reads the result on chain.">
      <FlowDiagram />
      <div className="ustx-flow ustx-narrow">
        {nodes.map((n, i) => (
          <Fragment key={n.k}>
            <div className="ustx-node">
              <span className={`ustx-token ustx-token-${n.tone}`}>{n.k}</span>
              <span className="ustx-node-title">{n.title}</span>
              <span className="ustx-node-sub">{n.sub}</span>
            </div>
            {i < nodes.length - 1 && (
              <span className="ustx-arrow" aria-hidden="true">
                <svg width="28" height="12" viewBox="0 0 28 12"><path d="M0 6h24M19 1l6 5-6 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
            )}
          </Fragment>
        ))}
      </div>
      <div className="ustx-rate mono">1 USDC = 1 USTX</div>
      <div className="ustx-from ustx-narrow">
        <span className="ustx-from-label">From</span>
        {LIVE_CHAINS.map((c) => <span key={c} className="ustx-chip">{c}</span>)}
        {LATER_CHAINS.map((c) => <span key={c} className="ustx-chip ustx-chip-later" title="Announced for a later phase">{c}</span>)}
      </div>
      <div className="ustx-actions">
        {GET_USTX_URL ? (
          <a className="film-cta" href={GET_USTX_URL} target="_blank" rel="noopener noreferrer">Get USTX</a>
        ) : (
          <span className="ustx-status mono">Minting is live in the tx wallet</span>
        )}
        <a href={ANNOUNCEMENT} target="_blank" rel="noopener noreferrer" className="stc-link">tx&apos;s announcement</a>
      </div>
    </Panel>
  );
}

function UstxReserves({ d }: { d: Payload }) {
  const f = d.ustxFlows;
  const live = Boolean(d.ustx?.issued && !f?.preview);
  const supply = live ? d.coins.find((c) => c.denom === d.ustx?.denom)?.supply ?? 0 : 0;
  return (
    <Panel title="Backed 1:1">
      <div className="ustx-eq">
        <div className="ustx-eq-side">
          <span className="mono ustx-eq-v" style={{ color: "var(--text-dark)" }}>{num(supply, supply < 1000 ? 2 : 0)}</span>
          <span className="ustx-eq-k">USTX on tx</span>
        </div>
        <span className="ustx-eq-sign mono" aria-label="equals">=</span>
        <div className="ustx-eq-side">
          <span className="mono ustx-eq-v" style={{ color: "var(--text-light)" }}>$ ?</span>
          <span className="ustx-eq-k">in reserve</span>
        </div>
      </div>
      <p className="ustx-eq-note">Reserves are attested monthly by an independent firm. The first USTX report is still to come.</p>
      <div className="ustx-actions">
        <span />
        <a href={BRALE_SBC_PAGE} target="_blank" rel="noopener noreferrer" className="stc-link">Brale&apos;s reports</a>
      </div>
    </Panel>
  );
}

function UstxTracker({ d }: { d: Payload }) {
  const f = d.ustxFlows;
  const sym = f?.preview ? d.coins.find((c) => c.denom === f.denom)?.symbol ?? "preview" : "USTX";
  const data = f?.days.map((x) => ({ ...x, burnedNeg: -x.burned })) ?? [];
  const holders = d.coins.find((c) => c.denom === f?.denom)?.holders ?? null;
  return (
    <Panel
      title="USDC converted to USTX"
      sub={f ? `${sym} minted and burned, read from hourly supply snapshots${f.since ? ` since ${dateOnly(f.since)}` : ""}.` : "Every mint shows here within the hour of the first one."}
    >
      {f?.preview && (
        <div className="ustx-preview mono">Preview with {sym} data. Local only.</div>
      )}
      {!f ? (
        <div className="ustx-waiting">
          <div className="ustx-ghost" aria-hidden="true">
            {[18, 30, 22, 44, 36, 58, 40, 66, 52, 74, 60, 82, 70, 90].map((h, i) => <span key={i} style={{ height: `${h}%` }} />)}
          </div>
          <div className="ustx-waiting-label">
            <span className="mono" style={{ color: "var(--text-dark)" }}>Waiting for the first mint</span>
            <span style={{ ...MUTED, fontSize: "0.78rem" }}>Watching {short(d.watching.mainnetIssuer)} every hour</span>
          </div>
        </div>
      ) : (
        <div className="ustx-track">
          <div className="ustx-kpis">
            <div><div className="card-title" style={CARD_TITLE}>In circulation</div><div className="mono ustx-big" style={{ color: "var(--text-dark)" }}>{num(f.supplyNow, f.supplyNow < 1000 ? 2 : 0)}</div></div>
            <div><div className="card-title" style={CARD_TITLE}>Minted, 30d</div><div className="mono ustx-big" style={{ color: "var(--text-dark)" }}>{num(f.minted, f.minted < 1000 ? 2 : 0)}</div></div>
            <div><div className="card-title" style={CARD_TITLE}>Burned, 30d</div><div className="mono ustx-big" style={{ color: "var(--text-dark)" }}>{num(f.burned, f.burned < 1000 ? 2 : 0)}</div></div>
          </div>
          {data.length > 0 ? (
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} stackOffset="sign" margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(128,128,128,0.2)" />
                  <XAxis dataKey="day" tickFormatter={dayLabel} tick={AXIS} tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis tickFormatter={(v) => usd(Math.abs(v as number))} tick={AXIS} tickLine={false} axisLine={false} width={52} />
                  <Tooltip
                    cursor={{ fill: "rgba(128,128,128,0.08)" }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const x = payload[0].payload as SupplyDay;
                      return (
                        <TipBox>
                          <strong>{dayLabel(x.day)}</strong>
                          <span>minted <b className="mono">{num(x.minted)}</b></span>
                          <span>burned <b className="mono">{num(x.burned)}</b></span>
                        </TipBox>
                      );
                    }}
                  />
                  <Bar dataKey="minted" stackId="f" fill={C.ibcIn} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                  <Bar dataKey="burnedNeg" stackId="f" fill={C.ibcOut} radius={[0, 0, 3, 3]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="ustx-waiting" style={{ minHeight: 120 }}>
              <span className="mono" style={{ color: "var(--text-dark)" }}>No supply change in the window</span>
            </div>
          )}
          <Legend items={[["Minted", C.ibcIn], ["Burned", C.ibcOut]]} />
          <div className="ustx-foot-line mono">
            {f.transfers.toLocaleString("en-US")} transfers between {f.wallets.toLocaleString("en-US")} wallets in 30 days
            {holders != null ? `, ${holders.toLocaleString("en-US")} holding now` : ""}
          </div>
        </div>
      )}
    </Panel>
  );
}

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
    <div className="panel" style={{ padding: 20, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, paddingRight: 40 }}>
        <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-dark)" }}>{c.symbol}</div>
        <div className="mono" style={{ ...MUTED, fontSize: "0.8rem" }}>
          {c.holders != null && c.holders <= 10 ? `all ${c.holders} holders` : `top 10 of ${c.holders?.toLocaleString("en-US") ?? "?"}`}
        </div>
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
      {/* A short list (USTX had 6 holders at launch) leaves the card taller
          than its rows, as it matches the 10-row cards beside it. The space
          carries the coin's concentration instead of sitting empty. */}
      {c.topHolders.length < 10 && c.topHolders.length >= 3 && (
        <div className="stc-holder-summary">
          <div>
            <div className="card-title" style={CARD_TITLE}>Top 3 hold</div>
            <div className="mono ustx-big" style={{ color: "var(--text-dark)" }}>
              {pct(c.topHolders.slice(0, 3).reduce((a, h) => a + h.share, 0))}
            </div>
          </div>
          <div>
            <div className="card-title" style={CARD_TITLE}>Wallets</div>
            <div className="mono ustx-big" style={{ color: "var(--text-dark)" }}>{c.holders?.toLocaleString("en-US") ?? c.topHolders.length}</div>
          </div>
          <div>
            <div className="card-title" style={CARD_TITLE}>Supply</div>
            <div className="mono ustx-big" style={{ color: "var(--text-dark)" }}>{num(c.supply, c.supply < 1000 ? 2 : 0)}</div>
          </div>
        </div>
      )}
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
      <div className="stc-matrix-wrap">
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

// One card per coin: where supply stands, how far it moved since recording
// began, and the holder count beside it. A coin whose supply never moved
// says so instead of drawing a flat line as if it were a chart.
function signed(v: number, dp: number) {
  const r = Number(v.toFixed(dp));
  return `${r > 0 ? "+" : r < 0 ? "\u2212" : ""}${Math.abs(r).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}

function SupplyCard({ c, pts }: { c: Coin; pts: HistoryPoint[] }) {
  const data = pts.map((p) => ({ t: new Date(p.takenAt).getTime(), supply: p.supply, holders: p.holders }));
  const first = data[0], last = data[data.length - 1];
  const dp = last.supply < 1000 ? 2 : 0;
  const delta = last.supply - first.supply;
  const pctMove = first.supply > 0 ? delta / first.supply : null;
  const flat = data.every((x) => x.supply === first.supply);
  const hFirst = first.holders, hLast = last.holders;
  const day = (t: number) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return (
    <div className="stc-supply-card">
      <div className="stc-supply-head">
        <span className="stc-supply-sym">{c.symbol}</span>
        <span className="mono stc-supply-now">{num(last.supply, dp)}</span>
      </div>
      <div className="stc-supply-sub mono">
        {flat
          ? `unchanged since ${day(first.t)}`
          : `${signed(delta, dp)}${pctMove != null ? ` (${signed(pctMove * 100, 1)}%)` : ""} since ${day(first.t)}`}
        {hLast != null && (
          <span>
            {" · "}{hLast.toLocaleString("en-US")} holders
            {hFirst != null && hFirst !== hLast ? ` (${signed(hLast - hFirst, 0)})` : ""}
          </span>
        )}
      </div>
      <div style={{ height: 130, opacity: flat ? 0.55 : 1 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 6, right: 0, left: 0, bottom: 0 }}>
            <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} hide />
            <YAxis domain={flat ? [0, "auto"] : ["auto", "auto"]} hide />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as (typeof data)[number];
                return (
                  <TipBox>
                    <strong>{new Date(p.t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC</strong>
                    <span>supply <b className="mono">{num(p.supply, dp)}</b></span>
                    <span>holders <b className="mono">{p.holders ?? "?"}</b></span>
                  </TipBox>
                );
              }}
            />
            <Area dataKey="supply" type="stepAfter" stroke={C.chain} strokeWidth={1.5} fill={C.chain} fillOpacity={0.14} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="stc-supply-axis mono"><span>{day(first.t)}</span><span>{day(last.t)}</span></div>
    </div>
  );
}

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
    <Panel title="Supply over time" sub={`Hourly snapshots since ${d.recording?.since ? dateOnly(d.recording.since) : "the first run"}. The chain keeps no history, so this starts when we did.`}>
      <div className="stc-supply-grid" style={{ ["--cols" as string]: series.length } as React.CSSProperties}>
        {series.map(({ c, pts }) => <SupplyCard key={c.denom} c={c} pts={pts} />)}
      </div>
    </Panel>
  );
}

// ── page ─────────────────────────────────────────────────────────────────


// Loading: the page's real layout with placeholders, so nothing moves when
// the data lands (about 1.3s on production). Titles are fixed text and show
// at once; numbers and charts arrive into boxes that are already there.
const BAR_HEIGHTS = [34, 52, 28, 70, 46, 88, 40, 62, 30, 76, 54, 92, 44, 66];

function SkelBars() {
  return <div className="stc-skel-bars" aria-hidden="true">{BAR_HEIGHTS.map((h, i) => <span key={i} className="stc-skel" style={{ height: `${h}%` }} />)}</div>;
}
function SkelLines({ n, h = 14 }: { n: number; h?: number }) {
  return (
    <div style={{ display: "grid", gap: 12 }} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => <span key={i} className="stc-skel" style={{ height: h, width: `${92 - (i % 3) * 14}%` }} />)}
    </div>
  );
}
// Heights are the loaded cards' on production (1400 and 393), so the page
// does not jump when data lands.
function SkelPanel({ title, children, h, m }: { title: string; children: React.ReactNode; h: number; m: number }) {
  return (
    <section className="panel stc-panel stc-skel-panel" style={{ ["--skel-h" as string]: `${h}px`, ["--skel-hm" as string]: `${m}px` } as React.CSSProperties}>
      <div className="section-head" style={{ color: "var(--text-dark)" }}>{title}</div>
      <span className="stc-skel" style={{ height: 12, width: "55%", margin: "8px 0 18px" }} aria-hidden="true" />
      <div className="stc-body">{children}</div>
    </section>
  );
}

function StablecoinsSkeleton({ error }: { error: string | null }) {
  const kpis = ["Dollars on chain", "USDC moved, 30d", "USDC transactions, 30d", "Wallets using USDC, 30d"];
  return (
    <div aria-busy="true">
      <style>{STYLES}</style>
      <div className="stc-head">
        <div>
          <h1 className="page-title" style={{ color: "var(--text-dark)" }}>Stablecoins on TX</h1>
          <p className="section-sub" style={{ ...MUTED, marginTop: 4 }}>Every dollar on the chain, read live. Reading the chain…</p>
        </div>
        <FilmButton />
      </div>
      {error && <div className="stc-loading-note" role="status">Could not reach the chain ({error}). Retrying.</div>}
      <div className="panel stc-kpis stc-skel-kpis">
        {kpis.map((k) => (
          <div key={k} className="shareable"><div className="stc-kpi">
            <div className="card-title" style={CARD_TITLE}>{k}</div>
            <span className="stc-skel" style={{ display: "block", height: 30, width: "60%", margin: "8px 0 6px" }} aria-hidden="true" />
            <span className="stc-skel" style={{ display: "block", height: 10, width: "80%" }} aria-hidden="true" />
            <span className="stc-skel" style={{ display: "block", height: 34, marginTop: 10 }} aria-hidden="true" />
          </div></div>
        ))}
      </div>
      <div className="stc-row stc-row-main">
        <SkelPanel title="USDC activity" h={404} m={416}><SkelBars /></SkelPanel>
        <SkelPanel title="USTX" h={404} m={283}><SkelLines n={5} /></SkelPanel>
      </div>
      <div className="stc-row stc-grid-2">
        <SkelPanel title="How USDC becomes USTX" h={484} m={401}><SkelBars /></SkelPanel>
        <SkelPanel title="Backed 1:1" h={484} m={317}><SkelLines n={4} h={18} /></SkelPanel>
      </div>
      <div className="stc-row"><SkelPanel title="USDC converted to USTX" h={318} m={331}><SkelBars /></SkelPanel></div>
      <div className="stc-row stc-grid-2">
        <SkelPanel title="Who holds the dollar" h={447} m={312}><SkelLines n={4} h={20} /></SkelPanel>
        <SkelPanel title="USDC wallets by size" h={447} m={460}><SkelLines n={6} /></SkelPanel>
      </div>
      <div className="stc-row stc-grid-2">
        <SkelPanel title="USDC" h={611} m={611}><SkelLines n={8} /></SkelPanel>
        <SkelPanel title="SBC" h={611} m={611}><SkelLines n={8} /></SkelPanel>
      </div>
    </div>
  );
}

export default function StablecoinsTab() {
  const { data: d, error } = useStablecoins();

  if (!d) return <StablecoinsSkeleton error={error} />;

  const main = d.coins.filter((c) => c.role !== "test");
  const tests = d.coins.filter((c) => c.role === "test");
  const usdc = main.find((c) => c.symbol === "USDC");
  const sbc = main.find((c) => c.symbol === "SBC");
  // All USDC routes, not only the canonical one, plus SBC.
  const ustxCoin = main.find((c) => c.symbol === "USTX");
  const totalStable = d.usdc.total + (sbc?.supply ?? 0) + (ustxCoin?.supply ?? 0);
  const act = d.activity?.find((a) => a.denom === usdc?.denom) ?? null;
  const withHolders = main.filter((c) => c.topHolders.length > 0);
  const pending = "from the next collector run";

  return (
    <div>
      <style>{STYLES}</style>

      <div className="stc-head">
        <div>
          <h1 className="page-title" style={{ color: "var(--text-dark)" }}>Stablecoins on TX</h1>
          <p className="section-sub" style={{ ...MUTED, marginTop: 4 }}>
            Every dollar on the chain, read live. Updated {ago(d.updatedAt)}.
          </p>
        </div>
        <FilmButton />
      </div>

      <div className="panel stc-kpis">
        <Kpi label="Dollars on chain" value={usd(totalStable)} note={ustxCoin ? "all USDC routes, SBC and USTX" : "all USDC routes plus SBC"} />
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
        <HowUstx />
        <UstxReserves d={d} />
      </div>

      <div className="stc-row">
        <UstxTracker d={d} />
      </div>

      <div className="stc-row stc-grid-2">
        <WhoHolds d={d} />
        {usdc?.sizes && <HolderSizes c={usdc} />}
      </div>

      {withHolders.length > 0 && (
        // One column per coin, so a third list (USTX, live 2026-10-08) sits
        // beside the other two instead of alone under them.
        <div className="stc-row stc-holders-row" style={{ ["--cols" as string]: withHolders.length } as React.CSSProperties}>
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
