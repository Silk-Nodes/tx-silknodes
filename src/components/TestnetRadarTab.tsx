"use client";

// /radar. What is being deployed on TX testnet, by product line.
//
// Four pictures, one question each:
//   is anything happening      headline + deployments per week
//   what, and when             product line x week heatmap
//   how far along              testnet, in use, mainnet track per line
//   what is actually used      most-called components, latest deployments
//
// Every figure comes from /api/testnet-radar (lib/testnet-radar). Product
// lines only: contract labels often name their builder, so the page never
// shows a label, only what the contract does.

import { useEffect, useState } from "react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import Shareable from "@/components/share/Shareable";

type LineId = "securities" | "repo" | "pools" | "oracle" | "staking" | "stablecoins" | "governance" | "launch" | "other";
interface RadarContract {
  line: LineId; component: string; codeId: number; createdHeight: number;
  createdAt: string | null; calls7d: number | null; onMainnet: boolean;
}
interface RadarLine {
  id: LineId; name: string; blurb: string; new7d: number; newWindow: number; calls7d: number;
  lastDeployed: string | null; onMainnet: number; weekly: number[];
  components: { name: string; deployments: number; lastDeployed: string | null; calls7d: number; onMainnet: boolean }[];
}
interface Radar {
  asOf: string; windowDays: number; head: { height: number; time: string };
  totals: { new7d: number; newWindow: number; lines7d: number; calls7d: number; onMainnet: number };
  lines: RadarLine[]; weeks: string[]; weekly: number[];
  topUsed: { line: LineId; component: string; calls7d: number; contracts: number }[];
  latest: RadarContract[];
  scan: { codes: number; contracts: number; complete: boolean };
}

const REFRESH_MS = 10 * 60_000;
const MUTED = { color: "var(--text-light)" } as const;

const LINE_NAME: Record<LineId, string> = {
  securities: "Tokenized securities", repo: "Repo and credit", pools: "Pools and trading", oracle: "Price oracles",
  staking: "Liquid staking and rewards", stablecoins: "Stablecoins", governance: "DAOs and governance",
  launch: "Launchpads and NFTs", other: "Other",
};

const STYLES = `
  .rdr-head { margin-bottom: 16px; }
  .rdr-note { margin: 6px 0 0; font-size: 0.8rem; line-height: 1.5; }
  .rdr-panel { padding: 22px 24px; min-width: 0; display: flex; flex-direction: column; height: 100%; }
  .rdr-panel .section-head { padding-right: 40px; }
  .rdr-sub { margin: 4px 0 14px; font-size: 0.84rem; line-height: 1.5; }
  .rdr-row { display: grid; gap: 14px; margin-top: 14px; align-items: stretch; }
  .rdr-row-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }

  /* 1. hero */
  .rdr-hero { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr); gap: 28px; align-items: center; }
  .rdr-hero-num { font-size: 4.2rem; line-height: 1; font-weight: 800; letter-spacing: -2px; color: var(--text-dark); }
  .rdr-hero-line { font-size: 1.15rem; line-height: 1.4; color: var(--text-dark); margin-top: 8px; max-width: 30ch; }
  .rdr-facts { display: flex; flex-wrap: wrap; gap: 6px 18px; margin-top: 16px; font-size: 0.8rem; }
  .rdr-facts b { color: var(--text-dark); font-family: var(--font-mono); font-weight: 700; }
  .rdr-chart-cap { font-size: 0.76rem; margin-bottom: 6px; }

  /* 2. heatmap */
  .rdr-heat-wrap { min-width: 0; }
  .rdr-heat { display: grid; grid-template-columns: minmax(150px, 1.4fr) repeat(8, minmax(30px, 0.5fr)) minmax(212px, 1.1fr); gap: 4px 4px; align-items: center; }
  .rdr-heat-h { font-size: 0.72rem; color: var(--text-light); text-align: center; padding-bottom: 4px; white-space: nowrap; }
  .rdr-heat-h.left { text-align: left; }
  .rdr-heat-h.now { color: var(--text-dark); font-weight: 700; }
  .rdr-heat-name { font-size: 0.86rem; font-weight: 700; color: var(--text-dark); line-height: 1.25; padding-right: 8px; }
  .rdr-heat-name span { display: block; font-weight: 400; font-size: 0.74rem; color: var(--text-light); margin-top: 2px; }
  .rdr-cell { height: 34px; border-radius: 6px; display: flex; align-items: center; justify-content: center;
    font-family: var(--font-mono); font-size: 0.76rem; font-weight: 700; color: var(--text-dark); }
  .rdr-cell.s0 { background: rgba(128,128,128,0.08); color: transparent; }
  .rdr-cell.s1 { background: color-mix(in srgb, var(--brand-accent) 22%, transparent); }
  .rdr-cell.s2 { background: color-mix(in srgb, var(--brand-accent) 42%, transparent); }
  .rdr-cell.s3 { background: color-mix(in srgb, var(--brand-accent) 66%, transparent); color: #101208; }
  .rdr-cell.s4 { background: var(--brand-accent); color: #101208; }
  .rdr-cell.now { outline: 1.5px solid var(--text-dark); outline-offset: 1px; }
  .rdr-sep { grid-column: 1 / -1; height: 1px; background: rgba(128,128,128,0.14); margin: 4px 0; }
  .rdr-scale { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 14px; font-size: 0.74rem; }
  .rdr-scale-note { margin-left: auto; }
  @media (max-width: 760px) { .rdr-scale-note { margin-left: 0; flex-basis: 100%; margin-top: 6px; line-height: 1.5; } }
  .rdr-scale .rdr-cell { width: 26px; height: 16px; font-size: 0.66rem; }

  /* 3. progress track */
  .rdr-track { display: flex; align-items: center; padding-left: 14px; }
  .rdr-step { display: flex; flex-direction: column; align-items: center; gap: 4px; flex: 0 0 auto; width: 56px; }
  .rdr-dot { width: 14px; height: 14px; border-radius: 50%; border: 2px solid rgba(128,128,128,0.55); background: transparent; }
  .rdr-dot.on { border-color: var(--brand-accent); background: var(--brand-accent); }
  .rdr-step-k { font-size: 0.64rem; color: var(--text-light); white-space: nowrap; }
  .rdr-step-k.on { color: var(--text-dark); font-weight: 700; }
  .rdr-link { flex: 1 1 auto; height: 2px; min-width: 6px; background: rgba(128,128,128,0.35); margin-bottom: 16px; }
  .rdr-link.on { background: var(--brand-accent); }

  /* 4a. most used */
  .rdr-used { display: grid; gap: 12px; }
  .rdr-used-top { display: flex; justify-content: space-between; gap: 12px; font-size: 0.84rem; }
  .rdr-used-name { color: var(--text-dark); font-weight: 700; }
  .rdr-used-name span { font-weight: 400; color: var(--text-light); }
  .rdr-used-v { font-family: var(--font-mono); color: var(--text-dark); white-space: nowrap; }
  .rdr-used-bar { height: 8px; border-radius: 4px; background: rgba(128,128,128,0.12); margin-top: 6px; overflow: hidden; }
  .rdr-used-bar i { display: block; height: 100%; border-radius: 4px; background: var(--brand-accent); }

  /* 4b. timeline */
  .rdr-tl { flex: 1 1 0; min-height: 240px; overflow-y: auto; padding-right: 4px; }
  .rdr-tl-day { font-size: 0.74rem; font-weight: 700; color: var(--text-light); text-transform: uppercase; letter-spacing: 0.06em; margin: 12px 0 6px; }
  .rdr-tl-day:first-child { margin-top: 0; }
  .rdr-tl-item { position: relative; padding: 0 0 12px 22px; font-size: 0.84rem; }
  .rdr-tl-item::before { content: ""; position: absolute; left: 4px; top: 6px; width: 8px; height: 8px; border-radius: 50%; background: var(--brand-accent); }
  .rdr-tl-item::after { content: ""; position: absolute; left: 7.5px; top: 16px; bottom: 0; width: 1px; background: rgba(128,128,128,0.3); }
  .rdr-tl-item:last-child::after { display: none; }
  .rdr-tl-what { color: var(--text-dark); font-weight: 700; }
  .rdr-tl-meta { font-size: 0.76rem; color: var(--text-light); margin-top: 1px; }
  .rdr-badge { font-family: var(--font-mono); font-size: 0.68rem; font-weight: 700; padding: 1px 7px; border-radius: 10px; margin-left: 6px;
    background: color-mix(in srgb, var(--brand-accent) 30%, transparent); color: var(--text-dark); white-space: nowrap; }

  .rdr-foot { margin-top: 14px; font-size: 0.76rem; line-height: 1.6; }
  .rdr-wait { padding: 40px 0; text-align: center; font-size: 0.86rem; }

  @media (max-width: 980px) {
    .rdr-row-2, .rdr-hero { grid-template-columns: minmax(0, 1fr); }
    .rdr-tl { flex: none; height: 360px; }
  }
  @media (max-width: 760px) {
    .rdr-heat-wrap { overflow-x: auto; }
    .rdr-heat { min-width: 780px; grid-template-columns: 132px repeat(8, minmax(44px, 1fr)) 212px; }
    /* The line name stays put while the weeks scroll under it. Opaque, so
       cells pass under a clean edge: light is the panel's 45% white over
       the page, dark is the panel colour itself. */
    .rdr-heat-name, .rdr-heat-h.left:first-child {
      position: sticky; left: 0; z-index: 1; align-self: stretch; display: flex; flex-direction: column; justify-content: center;
      background: color-mix(in srgb, #fff 45%, var(--nav-solid-bg));
    }
    [data-theme="dark"] .rdr-heat-name, [data-theme="dark"] .rdr-heat-h.left:first-child { background: var(--nav-solid-bg); }
    .rdr-heat-name span { display: none; }
  }
`;

const ago = (iso: string | null) => {
  if (!iso) return "n/a";
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (m < 60) return m < 1 ? "just now" : `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
};
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const hm = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
const n = (v: number) => v.toLocaleString("en-US");
const step = (v: number) => (v === 0 ? 0 : v === 1 ? 1 : v <= 3 ? 2 : v <= 9 ? 3 : 4);

function useRadar() {
  const [data, setData] = useState<Radar | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/testnet-radar", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = (await res.json()) as Radar;
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

function Panel({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <Shareable title={title} subtitle={sub ?? "Testnet radar, TX"} framed={false}>
      <section className="panel rdr-panel">
        <div className="section-head" style={{ color: "var(--text-dark)" }}>{title}</div>
        {sub && <p className="rdr-sub" style={MUTED}>{sub}</p>}
        {children}
      </section>
    </Shareable>
  );
}

function Head({ d }: { d: Radar | null }) {
  return (
    <div className="rdr-head">
      <h1 className="page-title" style={{ color: "var(--text-dark)" }}>Testnet radar</h1>
      <p className="section-sub" style={{ ...MUTED, marginTop: 4 }}>
        What is being deployed on TX testnet, by product line. Scanned from the chain every hour{d ? `, last ${ago(d.asOf)}` : ""}.
      </p>
      <p className="rdr-note" style={MUTED}>
        Testnet contracts are rehearsals. Nothing here is a launch date, and contract names are set by whoever deploys them.
      </p>
    </div>
  );
}

// 1. Is anything happening?
function Hero({ d }: { d: Radar }) {
  const busiest = [...d.lines].sort((a, b) => b.new7d - a.new7d)[0];
  const lastAny = d.latest[0]?.createdAt ?? null;
  const line = d.totals.new7d > 0 && busiest?.new7d > 0
    ? `new contracts on testnet this week, most of them in ${busiest.name.toLowerCase()}.`
    : `new contracts this week. The last one landed ${ago(lastAny)}.`;
  const data = d.weekly.map((v, i) => ({ v, label: i === d.weekly.length - 1 ? "this week" : day(d.weeks[i]) }));
  return (
    <Panel title="This week on testnet">
      <div className="rdr-hero">
        <div>
          <div className="rdr-hero-num">{n(d.totals.new7d)}</div>
          <div className="rdr-hero-line">{line}</div>
          <div className="rdr-facts" style={MUTED}>
            <span><b>{n(d.totals.newWindow)}</b> in 8 weeks</span>
            <span><b>{n(d.totals.calls7d)}</b> contract calls this week</span>
            <span><b>{n(d.totals.onMainnet)}</b> already share code with mainnet</span>
          </div>
        </div>
        <div>
          <div className="rdr-chart-cap" style={MUTED}>Contracts deployed per week</div>
          <div style={{ height: 170 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 18, right: 0, left: 0, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--text-light)" }} tickLine={false} axisLine={{ stroke: "rgba(128,128,128,0.3)" }} interval="preserveEnd" minTickGap={10} />
                <YAxis hide />
                <RTooltip
                  cursor={{ fill: "rgba(128,128,128,0.08)" }}
                  content={({ active, payload }) =>
                    active && payload?.length ? (
                      <div className="panel" style={{ padding: "8px 10px", fontSize: "0.8rem", color: "var(--text-dark)" }}>
                        <b>{(payload[0].payload as { label: string }).label}</b>: {n(payload[0].value as number)} contracts
                      </div>
                    ) : null
                  }
                />
                <Bar dataKey="v" radius={[4, 4, 0, 0]} isAnimationActive={false} label={{ position: "top", fontSize: 11, fill: "var(--text-dark)" }}>
                  {data.map((_, i) => (
                    <Cell key={i} fill={i === data.length - 1 ? "var(--brand-accent)" : "color-mix(in srgb, var(--brand-accent) 38%, transparent)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </Panel>
  );
}

// 2 and 3. What is being built, when, and how far along.
function Track({ l }: { l: RadarLine }) {
  const steps: [string, boolean][] = [["on testnet", true], ["in use", l.calls7d > 0], ["on mainnet", l.onMainnet > 0]];
  return (
    <div className="rdr-track" aria-label={steps.map(([k, on]) => `${k} ${on ? "yes" : "no"}`).join(", ")}>
      {steps.map(([k, on], i) => (
        <div key={k} style={{ display: "contents" }}>
          {i > 0 && <span className={`rdr-link ${on ? "on" : ""}`} />}
          <div className="rdr-step">
            <span className={`rdr-dot ${on ? "on" : ""}`} />
            <span className={`rdr-step-k ${on ? "on" : ""}`}>{k}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function Heatmap({ d }: { d: Radar }) {
  const last = d.weeks.length - 1;
  return (
    <Panel
      title="What is being built, week by week"
      sub="Each square is one week of new contracts for a product line. Darker means more. The track on the right shows how far each line has come."
    >
      <div className="rdr-heat-wrap">
        <div className="rdr-heat" role="table" aria-label="New contracts per product line per week">
          <div className="rdr-heat-h left">Product line</div>
          {d.weeks.map((w, i) => (
            <div key={w} className={`rdr-heat-h ${i === last ? "now" : ""}`}>{i === last ? "now" : day(w)}</div>
          ))}
          <div className="rdr-heat-h left" style={{ paddingLeft: 14 }}>Progress</div>
          {d.lines.map((l) => (
            <div key={l.id} style={{ display: "contents" }}>
              <div className="rdr-sep" />
              <div className="rdr-heat-name">
                {l.name}
                <span>{l.components.slice(0, 3).map((c) => c.name).join(", ")}{l.components.length > 3 ? ", more" : ""}</span>
              </div>
              {l.weekly.map((v, i) => (
                <div
                  key={i}
                  className={`rdr-cell s${step(v)} ${i === last ? "now" : ""}`}
                  aria-label={`${l.name}, week of ${day(d.weeks[i])}: ${v} new contract${v === 1 ? "" : "s"}`}
                >
                  {v}
                </div>
              ))}
              <Track l={l} />
            </div>
          ))}
        </div>
      </div>
      <div className="rdr-scale" style={MUTED}>
        <span>Fewer</span>
        {[0, 1, 2, 5, 12].map((v) => <span key={v} className={`rdr-cell s${step(v)}`} style={{ color: "transparent" }} />)}
        <span>More</span>
        <span className="rdr-scale-note">In use means at least one call in the past 7 days. On mainnet means the same compiled code is on mainnet.</span>
      </div>
    </Panel>
  );
}

// 4. What is actually used, and what landed last.
function MostUsed({ d }: { d: Radar }) {
  const max = Math.max(1, ...d.topUsed.map((u) => u.calls7d));
  return (
    <Panel title="Most used this week" sub="Calls to testnet contracts in the past 7 days, by component.">
      {d.topUsed.length === 0 ? (
        <p className="mono" style={{ ...MUTED, margin: 0, fontSize: "0.84rem" }}>No calls this week.</p>
      ) : (
        <div className="rdr-used">
          {d.topUsed.map((u) => (
            <div key={`${u.line}-${u.component}`}>
              <div className="rdr-used-top">
                <span className="rdr-used-name">{u.component} <span>· {LINE_NAME[u.line]}</span></span>
                <span className="rdr-used-v">{n(u.calls7d)}</span>
              </div>
              <div className="rdr-used-bar"><i style={{ width: `${Math.max(1.5, (u.calls7d / max) * 100)}%` }} /></div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function Latest({ d }: { d: Radar }) {
  const groups: { day: string; items: RadarContract[] }[] = [];
  for (const c of d.latest) {
    const k = c.createdAt ? day(c.createdAt) : "date unknown";
    const g = groups[groups.length - 1];
    if (g && g.day === k) g.items.push(c);
    else groups.push({ day: k, items: [c] });
  }
  return (
    <Panel title="Latest deployments" sub="Newest first, times in UTC.">
      <div className="rdr-tl">
        {groups.map((g) => (
          <div key={g.day}>
            <div className="rdr-tl-day">{g.day}</div>
            {g.items.map((c) => (
              <div key={`${c.createdHeight}-${c.codeId}-${c.component}`} className="rdr-tl-item">
                <div className="rdr-tl-what">
                  {c.component}
                  {c.onMainnet && <span className="rdr-badge">same code on mainnet</span>}
                </div>
                <div className="rdr-tl-meta">
                  {c.createdAt ? hm(c.createdAt) : ""} · {LINE_NAME[c.line]}
                  {c.calls7d ? ` · ${n(c.calls7d)} call${c.calls7d === 1 ? "" : "s"} this week` : ""}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Panel>
  );
}

export default function TestnetRadarTab() {
  const { data: d, error } = useRadar();

  if (!d) {
    return (
      <div>
        <style>{STYLES}</style>
        <Head d={null} />
        <section className="panel rdr-panel">
          <div className="rdr-wait mono" style={MUTED}>
            {error ? "Could not scan testnet right now. Trying again in a few minutes." : "Scanning testnet contracts. The first scan after a restart takes about 20 seconds."}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div>
      <style>{STYLES}</style>
      <Head d={d} />
      <Hero d={d} />
      <div className="rdr-row"><Heatmap d={d} /></div>
      <div className="rdr-row rdr-row-2">
        <MostUsed d={d} />
        <Latest d={d} />
      </div>
      <p className="rdr-foot mono" style={MUTED}>
        Scanned {n(d.scan.codes)} code ids and {n(d.scan.contracts)} contracts at testnet block {n(d.head.height)}
        {d.scan.complete ? "." : ", scan cut short; older contracts may be missing."} Contracts created from older code may be missed.
      </p>
    </div>
  );
}
