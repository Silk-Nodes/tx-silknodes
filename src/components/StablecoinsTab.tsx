"use client";

// /stablecoins. Every dollar on TX, read live from the chain.
//
// Built ahead of USTX, Brale's native stablecoin for TX, announced for October
// 2026. The page is useful before launch on purpose: it explains what USTX is
// entering (39 incompatible USDC tokens, and Brale's first stablecoin here
// sitting 97.2% in one wallet), so that on launch day the new number arrives
// with its context already on the page.

import { useEffect, useState } from "react";

type CoinRole = "incumbent" | "issued" | "test";
type HolderKind = "dex" | "contract" | "known" | "wallet";
interface Holder { address: string; amount: number; share: number; label: string | null; kind: HolderKind }
interface Breakdown { top1: number; second: number; next8: number; rest: number }
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
}
interface Fragment { denom: string; hops: number; firstChannel: string; viaChain: string | null; amount: number }
interface HistoryPoint { denom: string; takenAt: string; supply: number; holders: number | null; top1Share: number | null }
interface Payload {
  updatedAt: string;
  coins: Coin[];
  ustx: { issued: boolean; denom: string | null; foundBy: string | null; testnetDenom: string | null; checkedAt: string } | null;
  watching: { mainnetIssuer: string; testnetIssuer: string };
  recording: { since: string | null; snapshots: number } | null;
  usdc: { routes: number; total: number; canonical: number | null; canonicalShare: number | null; fragments: Fragment[] };
  history: { available: boolean; points: HistoryPoint[] };
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
const pct = (v: number | null, d = 1) => (v == null ? "n/a" : `${(v * 100).toFixed(d)}%`);
const short = (a: string) => `${a.slice(0, 12)}...${a.slice(-6)}`;
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

// Muted text uses the text token, never a bar token. --accent-olive is tuned
// for fills and falls to 4.24:1 as type on the light ground.
const MUTED = { color: "var(--text-light)" } as const;

// For elements carrying .card-title, which sets opacity: 0.85. That opacity
// is fine on full-strength text, but stacked on --text-light (already white
// at 62% in dark mode) it fell to 4.46:1. The colour is chosen explicitly
// here, so the class's dimming is cancelled rather than compounded.
const CARD_TITLE = { ...MUTED, opacity: 1 } as const;



// Bands of the "who holds the dollar" bar, largest wallet outwards. Fills,
// not text, so they only need to read as distinct from each other; the legend
// carries the words.
const BANDS = [
  "var(--danger)",
  "color-mix(in srgb, var(--danger) 45%, transparent)",
  "rgba(128,128,128,0.42)",
  "rgba(128,128,128,0.16)",
];
const BAND_LABELS = ["Largest wallet", "Second", "Next eight", "Everyone else"];

const dateOnly = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

function Dot() {
  return (
    <span
      aria-hidden="true"
      style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "var(--accent-olive)", marginRight: 8, flexShrink: 0 }}
    />
  );
}

function WatchRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: "0.82rem", alignItems: "center" }}>
      <span style={{ display: "flex", alignItems: "center", color: "var(--text-dark)" }}><Dot />{label}</span>
      <span className="mono" style={MUTED}>{value}</span>
    </div>
  );
}

// The hero reads as a monitor, not a paragraph: something is watching, it
// last looked a few minutes ago, and it has been recording since a date.
function UstxHero({ d }: { d: Payload }) {
  const u = d.ustx;
  const issued = u?.issued ?? false;
  const headline = issued ? "USTX is live on TX" : u?.testnetDenom ? "Seen on testnet, not yet on mainnet" : "Not issued yet";
  const rec = d.recording;
  return (
    <div className="panel stc-hero" style={{ padding: 24, marginBottom: 14 }}>
      <div>
        <div style={{ ...MUTED, textTransform: "uppercase", letterSpacing: "0.06em", fontSize: "0.72rem" }}>
          USTX · announced for October 2026
        </div>
        <h2 style={{ fontSize: "1.9rem", fontWeight: 700, margin: "6px 0 10px", color: "var(--text-dark)" }}>{headline}</h2>
        <p style={{ color: "var(--text-medium)", lineHeight: 1.6, margin: 0, maxWidth: 520 }}>
          {issued
            ? "The first mint has landed. Supply and holders below are read live and recorded every hour from launch."
            : "Brale's native stablecoin for TX, backed 1:1. We record it from the first mint, because the chain keeps no history of who held a token on launch day."}
        </p>
      </div>
      <div className="stc-watch">
        <WatchRow label="Brale, mainnet issuer" value={u ? ago(u.checkedAt) : "n/a"} />
        <WatchRow label="Brale, testnet issuer" value={u ? ago(u.checkedAt) : "n/a"} />
        <div style={{ borderTop: "1px solid rgba(128,128,128,0.2)", paddingTop: 8, display: "flex", justifyContent: "space-between", gap: 12, fontSize: "0.82rem" }}>
          <span style={{ color: "var(--text-dark)" }}>Recording since</span>
          <span className="mono" style={MUTED}>
            {rec?.since ? `${dateOnly(rec.since)} · ${rec.snapshots} runs` : "not started"}
          </span>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="stc-stat">
      <div className="card-title" style={CARD_TITLE}>{label}</div>
      <div className="mono stc-stat-value" style={{ color: "var(--text-dark)" }}>{value}</div>
      <div style={{ ...MUTED, fontSize: "0.76rem" }}>{note}</div>
    </div>
  );
}

function StackedBar({ b }: { b: Breakdown }) {
  const parts = [b.top1, b.second, b.next8, b.rest];
  return (
    <div role="presentation" style={{ display: "flex", height: 16, borderRadius: 4, overflow: "hidden", background: "rgba(128,128,128,0.08)" }}>
      {parts.map((p, i) => (p > 0 ? <div key={i} style={{ width: `${p * 100}%`, background: BANDS[i] }} /> : null))}
    </div>
  );
}

// The centrepiece. Concentration reads without reading a number, and USTX
// holds a dashed row from before launch, so on launch day the new bar fills a
// space the reader was already looking at.
function WhoHolds({ d }: { d: Payload }) {
  const rows = d.coins.filter((c) => c.role !== "test" && c.breakdown);
  const sbc = d.coins.find((c) => c.symbol === "SBC");
  const ustxLive = d.ustx?.issued;
  return (
    <div className="panel" style={{ padding: 24, marginTop: 14 }}>
      <div className="section-head" style={{ color: "var(--text-dark)" }}>Who holds the dollar</div>
      <p style={{ ...MUTED, margin: "4px 0 18px", lineHeight: 1.55, maxWidth: 720 }}>
        Share of each coin by holder.{" "}
        {sbc?.top1Share != null
          ? `SBC is Brale's first stablecoin here, and one wallet holds ${pct(sbc.top1Share)} of it. When USTX mints, this is the shape to watch.`
          : ""}
      </p>
      <div style={{ display: "grid", gap: 16 }}>
        {rows.map((c) => (
          <div key={c.denom}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 6, fontSize: "0.88rem" }}>
              <span style={{ fontWeight: 700, color: "var(--text-dark)" }}>{c.symbol}</span>
              <span className="mono" style={MUTED}>
                {c.holders?.toLocaleString("en-US") ?? "?"} holders · largest{" "}
                <span style={{ color: (c.top1Share ?? 0) > 0.5 ? "var(--danger-text)" : "var(--text-dark)" }}>{pct(c.top1Share)}</span>
              </span>
            </div>
            <StackedBar b={c.breakdown!} />
          </div>
        ))}
        {!ustxLive && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 6, fontSize: "0.88rem" }}>
              <span style={{ fontWeight: 700, ...MUTED }}>USTX</span>
              <span className="mono" style={MUTED}>awaiting first mint</span>
            </div>
            <div style={{ height: 16, borderRadius: 4, border: "1px dashed rgba(128,128,128,0.45)" }} />
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 16, fontSize: "0.76rem" }}>
        {BAND_LABELS.map((l, i) => (
          <span key={l} style={{ display: "flex", alignItems: "center", gap: 6, ...MUTED }}>
            <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 2, background: BANDS[i] }} />
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

const KIND_STYLE: Record<HolderKind, { color: string; background: string }> = {
  dex: { color: "var(--text-accent)", background: "rgba(128,128,128,0.10)" },
  contract: { color: "var(--text-dark)", background: "rgba(128,128,128,0.10)" },
  known: { color: "var(--text-dark)", background: "rgba(128,128,128,0.10)" },
  wallet: { color: "var(--text-light)", background: "transparent" },
};

function HolderList({ c }: { c: Coin }) {
  return (
    <div className="panel" style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
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
                <a
                  href={`/passport/${h.address}`}
                  className="mono stc-addr"
                  style={{ color: "var(--text-dark)" }}
                >
                  {short(h.address)}
                </a>
              </span>
              <span className="mono" style={{ textAlign: "right", color: "var(--text-dark)" }}>{num(h.amount)}</span>
              <span className="mono" style={{ textAlign: "right", ...MUTED }}>{pct(h.share)}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Routes({ d }: { d: Payload }) {
  const f = d.usdc.fragments;
  if (f.length === 0) return null;
  const share = d.usdc.canonicalShare ?? 0;
  const rest = f.slice(1).reduce((s, x) => s + x.amount, 0);
  return (
    <div className="panel" style={{ padding: 24, marginTop: 14 }}>
      <div className="section-head" style={{ color: "var(--text-dark)" }}>One dollar, {d.usdc.routes} tokens</div>
      <p style={{ ...MUTED, margin: "4px 0 14px", lineHeight: 1.55, maxWidth: 720 }}>
        Every route USDC takes into TX mints its own token, and they cannot be swapped for one another directly.
      </p>
      <div role="presentation" style={{ display: "flex", height: 26, borderRadius: 4, overflow: "hidden" }}>
        <div style={{ width: `${share * 100}%`, background: "var(--accent-olive)" }} />
        <div style={{ width: `${(1 - share) * 100}%`, background: "var(--danger)" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginTop: 8, fontSize: "0.82rem" }}>
        <span style={{ color: "var(--text-dark)" }}>noble-1, main route · <span className="mono">{pct(share)}</span></span>
        <span style={MUTED}>{f.length - 1} other routes · <span className="mono">{num(rest)}</span> USDC</span>
      </div>
      <details style={{ marginTop: 14 }}>
        <summary style={{ cursor: "pointer", fontSize: "0.85rem", color: "var(--text-dark)" }}>Every route</summary>
        <div style={{ overflowX: "auto", marginTop: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th style={{ ...MUTED, fontWeight: 500, padding: "6px 8px" }}>Arrives from</th>
                <th style={{ ...MUTED, fontWeight: 500, padding: "6px 8px" }}>Hops</th>
                <th style={{ ...MUTED, fontWeight: 500, padding: "6px 8px", textAlign: "right" }}>USDC</th>
              </tr>
            </thead>
            <tbody>
              {f.map((r, i) => (
                <tr key={r.denom} style={{ borderTop: "1px solid rgba(128,128,128,0.18)" }}>
                  <td className="mono" style={{ padding: 8, color: "var(--text-dark)" }}>{i === 0 ? "noble-1, main route" : r.viaChain ?? r.firstChannel}</td>
                  <td className="mono" style={{ padding: 8, color: "var(--text-dark)" }}>{r.hops}</td>
                  <td className="mono" style={{ padding: 8, textAlign: "right", color: "var(--text-dark)" }}>{num(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function History({ d }: { d: Payload }) {
  const { available, points } = d.history;
  const byDenom = new Map<string, HistoryPoint[]>();
  for (const p of points) byDenom.set(p.denom, [...(byDenom.get(p.denom) ?? []), p]);
  const series = d.coins
    .filter((c) => c.role !== "test")
    .map((c) => ({ c, pts: byDenom.get(c.denom) ?? [] }))
    .filter((s) => s.pts.length > 1);

  return (
    <div className="panel" style={{ padding: 24, marginTop: 16 }}>
      <div className="section-head" style={{ color: "var(--text-dark)" }}>Supply over time</div>
      {series.length === 0 ? (
        <p style={{ ...MUTED, lineHeight: 1.6, margin: "10px 0 0" }}>
          {available
            ? "Recording has started. The chart appears once there are two snapshots to draw between."
            : "History begins when the hourly collector starts recording. The chain keeps no record of past holders, so this cannot be backfilled, which is why recording starts before launch."}
        </p>
      ) : (
        <div style={{ display: "grid", gap: 20, marginTop: 14 }}>
          {series.map(({ c, pts }) => {
            const W = 600, H = 90;
            const xs = pts.map((p) => new Date(p.takenAt).getTime());
            const ys = pts.map((p) => p.supply);
            const x0 = Math.min(...xs), x1 = Math.max(...xs);
            const y0 = Math.min(...ys), y1 = Math.max(...ys);
            const sx = (v: number) => (x1 === x0 ? 0 : ((v - x0) / (x1 - x0)) * W);
            const sy = (v: number) => (y1 === y0 ? H / 2 : H - ((v - y0) / (y1 - y0)) * H);
            const path = pts.map((p, i) => `${i ? "L" : "M"}${sx(xs[i]).toFixed(1)},${sy(p.supply).toFixed(1)}`).join(" ");
            return (
              <div key={c.denom}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem" }}>
                  <span style={{ color: "var(--text-dark)", fontWeight: 600 }}>{c.symbol}</span>
                  <span className="mono" style={MUTED}>{num(ys[0])} to {num(ys[ys.length - 1])}</span>
                </div>
                <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: 90, display: "block" }}>
                  <path d={path} fill="none" stroke="var(--accent-olive)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
                </svg>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

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
  const totalStable = main.reduce((s, c) => s + c.supply, 0);
  const withHolders = main.filter((c) => c.topHolders.length > 0);

  return (
    <div>
      <style>{`
        .stc-hero { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 24px; align-items: stretch; }
        .stc-watch { display: grid; gap: 8px; align-content: center; padding: 14px 16px; border-radius: 10px; background: rgba(128,128,128,0.07); }
        .stc-strip { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .stc-stat { padding: 18px 20px; min-width: 0; }
        .stc-stat + .stc-stat { border-left: 1px solid rgba(128,128,128,0.18); }
        .stc-stat-value { font-size: 1.9rem; margin: 4px 0 2px; }
        .stc-holders { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 14px; }
        .stc-holder { display: grid; grid-template-columns: 20px minmax(0, 1fr) auto 58px; gap: 10px; align-items: center;
                      padding: 8px 0; border-top: 1px solid rgba(128,128,128,0.16); font-size: 0.84rem; }
        .stc-addr { font-size: 0.8rem; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .stc-addr:hover { text-decoration: underline; }
        @media (max-width: 860px) {
          .stc-hero { grid-template-columns: minmax(0, 1fr); }
          .stc-holders { grid-template-columns: minmax(0, 1fr); }
        }
        @media (max-width: 520px) {
          .stc-stat { padding: 14px 10px; }
          .stc-stat-value { font-size: 1.25rem; }
        }
      `}</style>

      <div style={{ marginBottom: 16 }}>
        <h1 className="page-title" style={{ color: "var(--text-dark)" }}>Stablecoins on TX</h1>
        <p className="section-sub" style={{ ...MUTED, marginTop: 4 }}>
          Every dollar on the chain, read live. Updated {ago(d.updatedAt)}.
        </p>
      </div>

      <UstxHero d={d} />

      <div className="panel stc-strip">
        <Stat label="Stablecoins on chain" value={num(totalStable, 0)} note="canonical USDC plus SBC" />
        <Stat label="USDC tokens" value={String(d.usdc.routes)} note="routes, none interchangeable" />
        <Stat label="On the main route" value={pct(d.usdc.canonicalShare)} note="of all USDC, via Noble" />
      </div>

      <WhoHolds d={d} />

      {withHolders.length > 0 && (
        <>
          <div className="section-head" style={{ color: "var(--text-dark)", marginTop: 22 }}>The largest holders</div>
          <p style={{ ...MUTED, margin: "4px 0 0", lineHeight: 1.55, maxWidth: 720 }}>
            Contracts name themselves on chain, so DEX pools are labelled automatically. Wallets are named only when we know
            who they are.
          </p>
          <div className="stc-holders">
            {withHolders.map((c) => <HolderList key={c.denom} c={c} />)}
          </div>
        </>
      )}

      <Routes d={d} />

      <History d={d} />

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
