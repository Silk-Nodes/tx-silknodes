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
}
interface Fragment { denom: string; hops: number; firstChannel: string; viaChain: string | null; amount: number }
interface HistoryPoint { denom: string; takenAt: string; supply: number; holders: number | null; top1Share: number | null }
interface Payload {
  updatedAt: string;
  coins: Coin[];
  ustx: { issued: boolean; denom: string | null; foundBy: string | null; testnetDenom: string | null; checkedAt: string } | null;
  watching: { mainnetIssuer: string; testnetIssuer: string };
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

function Bar({ share, tone }: { share: number; tone: "neutral" | "warn" }) {
  return (
    <div
      role="presentation"
      style={{ height: 8, borderRadius: 4, background: "rgba(128,128,128,0.16)", overflow: "hidden", marginTop: 8 }}
    >
      <div
        style={{
          height: "100%",
          width: `${Math.min(100, Math.max(0, share * 100))}%`,
          background: tone === "warn" ? "var(--danger)" : "var(--accent-olive)",
          borderRadius: 4,
        }}
      />
    </div>
  );
}

function UstxPanel({ d }: { d: Payload }) {
  const u = d.ustx;
  const issued = u?.issued ?? false;
  return (
    <div className="panel" style={{ padding: 24, marginBottom: 16 }}>
      <div className="section-sub" style={{ ...MUTED, textTransform: "uppercase", letterSpacing: "0.06em", fontSize: "0.72rem" }}>
        USTX · announced for October 2026
      </div>
      <h2 style={{ fontSize: "1.9rem", fontWeight: 700, margin: "6px 0 10px", color: "var(--text-dark)" }}>
        {issued ? "USTX is live on TX" : u?.testnetDenom ? "Seen on testnet, not yet on mainnet" : "Not issued yet"}
      </h2>
      <p style={{ color: "var(--text-medium)", lineHeight: 1.6, maxWidth: 720, margin: 0 }}>
        {issued
          ? "The first mint has landed. Supply and holders below are read live, and the hourly collector is recording them from launch."
          : "USTX is Brale's native stablecoin for TX, backed 1:1. It is not on mainnet or testnet yet. We check both every hour and record it from the first mint, because the chain keeps no history of who held a token on launch day."}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 20, marginTop: 18, fontSize: "0.82rem" }}>
        <div>
          <div style={MUTED}>Watching Brale on mainnet</div>
          <div className="mono" style={{ color: "var(--text-dark)" }}>{short(d.watching.mainnetIssuer)}</div>
        </div>
        <div>
          <div style={MUTED}>and on testnet</div>
          <div className="mono" style={{ color: "var(--text-dark)" }}>{short(d.watching.testnetIssuer)}</div>
        </div>
        {u && (
          <div>
            <div style={MUTED}>Last checked</div>
            <div className="mono" style={{ color: "var(--text-dark)" }}>{ago(u.checkedAt)}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function CoinTile({ c }: { c: Coin }) {
  const concentrated = (c.top1Share ?? 0) > 0.5;
  return (
    <div className="panel" style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text-dark)" }}>{c.symbol}</div>
        <div style={{ ...MUTED, fontSize: "0.78rem", textAlign: "right" }}>{c.name}</div>
      </div>
      <div className="card-value mono" style={{ fontSize: "1.6rem", marginTop: 10, color: "var(--text-dark)" }}>
        {num(c.supply)}
      </div>
      <div style={{ ...MUTED, fontSize: "0.8rem" }}>in circulation on TX</div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16, fontSize: "0.85rem" }}>
        <span style={MUTED}>Holders</span>
        <span className="mono" style={{ color: "var(--text-dark)" }}>{c.holders == null ? "n/a" : c.holders.toLocaleString("en-US")}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: "0.85rem" }}>
        <span style={MUTED}>Largest wallet</span>
        <span className="mono" style={{ color: concentrated ? "var(--danger-text)" : "var(--text-dark)" }}>{pct(c.top1Share)}</span>
      </div>
      {c.top1Share != null && <Bar share={c.top1Share} tone={concentrated ? "warn" : "neutral"} />}
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
  const sbc = d.coins.find((c) => c.symbol === "SBC");
  const totalStable = main.reduce((s, c) => s + c.supply, 0);
  const smallRoutes = d.usdc.fragments.filter((f) => f.denom !== d.usdc.fragments[0]?.denom);
  const smallTotal = smallRoutes.reduce((s, f) => s + f.amount, 0);

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h1 className="page-title" style={{ color: "var(--text-dark)" }}>Stablecoins on TX</h1>
        <p className="section-sub" style={{ ...MUTED, marginTop: 4 }}>
          Every dollar on the chain, read live. Updated {ago(d.updatedAt)}.
        </p>
      </div>

      <UstxPanel d={d} />

      <div className="responsive-grid-3" style={{ gap: 16, marginBottom: 16 }}>
        <div className="panel" style={{ padding: 20 }}>
          <div className="card-title" style={CARD_TITLE}>Stable supply on TX</div>
          <div className="card-value mono" style={{ color: "var(--text-dark)" }}>{num(totalStable, 0)}</div>
          <div style={{ ...MUTED, fontSize: "0.78rem" }}>canonical USDC plus SBC</div>
        </div>
        <div className="panel" style={{ padding: 20 }}>
          <div className="card-title" style={CARD_TITLE}>USDC tokens on TX</div>
          <div className="card-value mono" style={{ color: "var(--text-dark)" }}>{d.usdc.routes}</div>
          <div style={{ ...MUTED, fontSize: "0.78rem" }}>separate routes, none interchangeable</div>
        </div>
        <div className="panel" style={{ padding: 20 }}>
          <div className="card-title" style={CARD_TITLE}>Held on the main route</div>
          <div className="card-value mono" style={{ color: "var(--text-dark)" }}>{pct(d.usdc.canonicalShare)}</div>
          <div style={{ ...MUTED, fontSize: "0.78rem" }}>of all USDC, via Noble</div>
        </div>
      </div>

      <div className="section-head" style={{ color: "var(--text-dark)", marginTop: 8 }}>The dollars on TX today</div>
      <div className="responsive-grid-2" style={{ gap: 16, marginTop: 10 }}>
        {main.map((c) => <CoinTile key={c.denom} c={c} />)}
      </div>

      {sbc && sbc.top1Share != null && (
        <div className="panel" style={{ padding: 24, marginTop: 16 }}>
          <div className="section-head" style={{ color: "var(--text-dark)" }}>The number to watch at launch</div>
          <p style={{ color: "var(--text-medium)", lineHeight: 1.6, margin: "10px 0 0", maxWidth: 760 }}>
            SBC is Brale&apos;s first stablecoin on this chain, issued in 2024. After nearly two years it holds{" "}
            <strong className="mono" style={{ color: "var(--text-dark)" }}>{num(sbc.supply)}</strong> across{" "}
            <strong className="mono" style={{ color: "var(--text-dark)" }}>{sbc.holders}</strong> wallets, and the largest
            one holds <strong className="mono" style={{ color: "var(--danger-text)" }}>{pct(sbc.top1Share)}</strong> of it.
            Same issuer, same chain, same token standard as USTX. Supply alone would never have shown that. When USTX
            mints, how many wallets hold it is the figure that says whether it is being used.
          </p>
        </div>
      )}

      <div className="panel" style={{ padding: 24, marginTop: 16 }}>
        <div className="section-head" style={{ color: "var(--text-dark)" }}>One dollar, {d.usdc.routes} tokens</div>
        <p style={{ color: "var(--text-medium)", lineHeight: 1.6, margin: "10px 0 14px", maxWidth: 760 }}>
          Every route USDC takes into TX mints its own token, and they cannot be swapped for one another directly. The
          main route from Noble holds {pct(d.usdc.canonicalShare)} of all USDC here. The other {smallRoutes.length} routes
          hold {num(smallTotal)} between them.
        </p>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th style={{ ...MUTED, fontWeight: 500, padding: "6px 8px" }}>Route</th>
                <th style={{ ...MUTED, fontWeight: 500, padding: "6px 8px" }}>Hops</th>
                <th style={{ ...MUTED, fontWeight: 500, padding: "6px 8px", textAlign: "right" }}>USDC</th>
              </tr>
            </thead>
            <tbody>
              {d.usdc.fragments.slice(0, 8).map((f, i) => (
                <tr key={f.denom} style={{ borderTop: "1px solid rgba(128,128,128,0.18)" }}>
                  <td className="mono" style={{ padding: "8px", color: "var(--text-dark)" }}>
                    {i === 0 ? "noble-1, main route" : `via ${f.viaChain ?? f.firstChannel}`}
                  </td>
                  <td className="mono" style={{ padding: "8px", color: "var(--text-dark)" }}>{f.hops}</td>
                  <td className="mono" style={{ padding: "8px", textAlign: "right", color: "var(--text-dark)" }}>{num(f.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {d.usdc.fragments.length > 8 && (
          <div style={{ ...MUTED, fontSize: "0.8rem", marginTop: 8 }}>
            and {d.usdc.fragments.length - 8} more routes, the longest {Math.max(...d.usdc.fragments.map((f) => f.hops))} hops deep
          </div>
        )}
      </div>

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
