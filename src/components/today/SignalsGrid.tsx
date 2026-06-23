"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatCompact } from "@/lib/ui-format";

// ── API contract (must match /api/today/signals route.ts) ──────────────
type SignalsResponse = {
  updatedAt: string;
  signals: {
    exchangeFlow: { netTx: number; inflowTx: number; outflowTx: number } | null;
    whaleMoves: {
      count: number;
      largest: {
        amountTx: number;
        type: "delegate" | "undelegate" | "redelegate";
        validator: string | null;
        moniker: string | null;
      } | null;
    } | null;
    newWhales: { arrivals: number; exits: number; updatedAt: string | null } | null;
    unbondingWave: {
      totalTx: number;
      peakDate: string | null;
      peakTx: number;
      days: Array<{ date: string; tx: number }>;
    } | null;
    activeStakers: { count24h: number; avg30d: number; deltaPct: number } | null;
    topValidator: {
      moniker: string | null;
      operator: string;
      netTx: number;
      direction: "in" | "out";
    } | null;
  };
};

// SignalsGrid: 3×2 grid of compact data tiles. Each tile has a unique
// mini-visualization tailored to the underlying metric, so the eye
// reads them as six different things rather than six rows of the same
// thing. No emojis - visual differentiation comes from the per-tile
// viz, the label, and color tone.
//
// Every tile links to a deeper page (flows / analytics / validators)
// - that's why these specific six were picked. Surfaces don't repeat
// data that lives elsewhere on the Today page (governance + PSE are
// in the right rail; APR / Bonded / Price are in the hero stats).
export default function SignalsGrid() {
  const [data, setData] = useState<SignalsResponse | null>(null);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/today/signals")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((j: SignalsResponse) => {
        if (cancelled) return;
        setData(j);
      })
      .catch(() => {
        if (cancelled) return;
        setErrored(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loading = !data && !errored;

  // Distinguish a hard fetch failure from "data loaded, nothing notable".
  // Without this, a network error fell through to every tile rendering
  // fabricated "no data / quiet" copy, which misleads the reader.
  if (errored) {
    return (
      <section className="today-section signals-grid-section">
        <div className="today-section-label">Today&apos;s signals</div>
        <div className="signals-grid-error" role="status">
          Signals are temporarily unavailable. Refresh to try again.
        </div>
      </section>
    );
  }

  return (
    <section className="today-section signals-grid-section">
      <div className="today-section-label">Today&apos;s signals</div>
      <div className="signals-grid" aria-busy={loading} aria-live="polite">
        <ExchangeFlowTile signal={data?.signals.exchangeFlow} loading={loading} />
        <WhaleMovesTile signal={data?.signals.whaleMoves} loading={loading} />
        <NewWhalesTile signal={data?.signals.newWhales} loading={loading} />
        <UnbondingWaveTile signal={data?.signals.unbondingWave} loading={loading} />
        <ActiveStakersTile signal={data?.signals.activeStakers} loading={loading} />
        <TopValidatorTile signal={data?.signals.topValidator} loading={loading} />
      </div>
    </section>
  );
}

// ─── Tile primitives ───────────────────────────────────────────────────

// Generic wrapper so all six tiles share padding, hover, link behavior.
// `viz` slot holds the per-signal mini visualization between the value
// and the micro-sub line.
function Tile({
  label, value, valueTone, viz, sub, href, ctaLabel, empty,
}: {
  label: string;
  value: React.ReactNode;
  valueTone?: "ok" | "warn" | "muted";
  viz?: React.ReactNode;
  sub?: React.ReactNode;
  href: string;
  ctaLabel: string;
  empty?: boolean;
}) {
  return (
    <Link href={href} className={`sg-tile ${empty ? "is-empty" : ""}`}>
      <div className="sg-tile-label">{label}</div>
      <div className={`sg-tile-value ${valueTone ? `tone-${valueTone}` : ""}`}>
        {value}
      </div>
      {viz && <div className="sg-tile-viz">{viz}</div>}
      {sub && <div className="sg-tile-sub">{sub}</div>}
      <div className="sg-tile-cta">{ctaLabel}<span className="sg-tile-cta-arrow">→</span></div>
    </Link>
  );
}

// ─── Six tile implementations ──────────────────────────────────────────

function ExchangeFlowTile({ signal, loading }: {
  signal: SignalsResponse["signals"]["exchangeFlow"] | null | undefined;
  loading: boolean;
}) {
  if (loading) return <SkeletonTile label="Exchange flow 24h" />;
  if (!signal) {
    return (
      <Tile label="Exchange flow 24h" value="-" sub="No exchange flow data yet" href="/flows" ctaLabel="See flows" empty />
    );
  }
  const { netTx, inflowTx, outflowTx } = signal;
  const total = inflowTx + outflowTx;
  const outPct = total > 0 ? (outflowTx / total) * 100 : 50;
  // Net positive = TX moved out of exchanges = accumulation signal.
  const tone: "ok" | "warn" | "muted" =
    Math.abs(netTx) < 10_000 ? "muted" : netTx > 0 ? "ok" : "warn";
  return (
    <Tile
      label="Exchange flow 24h"
      value={
        <>
          <span className="sg-sign">{netTx >= 0 ? "+" : "-"}</span>
          {formatTx(Math.abs(netTx))}
        </>
      }
      valueTone={tone}
      viz={<SplitBar leftLabel="in" leftPct={100 - outPct} rightLabel="out" rightPct={outPct} />}
      sub={
        <>
          <span className="sg-mono">{formatTx(inflowTx)}</span> deposited
          {" · "}
          <span className="sg-mono">{formatTx(outflowTx)}</span> withdrawn
        </>
      }
      href="/flows"
      ctaLabel="See flows"
    />
  );
}

function WhaleMovesTile({ signal, loading }: {
  signal: SignalsResponse["signals"]["whaleMoves"] | null | undefined;
  loading: boolean;
}) {
  if (loading) return <SkeletonTile label="Whale moves 24h" />;
  const count = signal?.count ?? 0;
  const largest = signal?.largest;
  return (
    <Tile
      label="Whale moves 24h"
      value={count}
      valueTone={count > 0 ? "warn" : "muted"}
      viz={<DotRow count={Math.min(count, 12)} muted={count === 0 ? 6 : 0} />}
      sub={
        largest
          ? <>
              Largest: <span className="sg-mono">{formatTx(largest.amountTx)}</span>{" "}
              {moveVerb(largest.type)}
              {largest.moniker ? <> {movePreposition(largest.type)} <strong>{largest.moniker}</strong></> : null}
            </>
          : <>Quiet, no moves above 1M TX</>
      }
      href="/flows"
      ctaLabel="Whale tracker"
      empty={count === 0}
    />
  );
}

function NewWhalesTile({ signal, loading }: {
  signal: SignalsResponse["signals"]["newWhales"] | null | undefined;
  loading: boolean;
}) {
  if (loading) return <SkeletonTile label="Top-100 changes 6h" />;
  const arrivals = signal?.arrivals ?? 0;
  const exits = signal?.exits ?? 0;
  const net = arrivals - exits;
  return (
    <Tile
      label="Top-100 changes 6h"
      value={
        <span className="sg-arrival-pair">
          <span className="sg-pair-up">{arrivals}</span>
          <span className="sg-pair-sep">/</span>
          <span className="sg-pair-down">{exits}</span>
        </span>
      }
      valueTone={net === 0 ? "muted" : net > 0 ? "ok" : "warn"}
      viz={<ArrivalsBar arrivals={arrivals} exits={exits} />}
      sub={
        arrivals + exits === 0
          ? <>No reshuffle in the top-100 this cycle</>
          : <><strong>{arrivals}</strong> arrived · <strong>{exits}</strong> dropped out</>
      }
      href="/analytics"
      ctaLabel="Top delegators"
      empty={arrivals + exits === 0}
    />
  );
}

function UnbondingWaveTile({ signal, loading }: {
  signal: SignalsResponse["signals"]["unbondingWave"] | null | undefined;
  loading: boolean;
}) {
  if (loading) return <SkeletonTile label="Next 7d unbonding" />;
  if (!signal || signal.days.length === 0) {
    return (
      <Tile label="Next 7d unbonding" value="-" sub="No upcoming unbondings" href="/analytics" ctaLabel="See analytics" empty />
    );
  }
  return (
    <Tile
      label="Next 7d unbonding"
      value={formatTx(signal.totalTx)}
      viz={<MiniBars days={signal.days} highlightDate={signal.peakDate} />}
      sub={
        signal.peakDate
          ? <>Peaks on <strong>{shortDate(signal.peakDate)}</strong>: <span className="sg-mono">{formatTx(signal.peakTx)}</span></>
          : <>Distributed across the week</>
      }
      href="/analytics"
      ctaLabel="See analytics"
    />
  );
}

function ActiveStakersTile({ signal, loading }: {
  signal: SignalsResponse["signals"]["activeStakers"] | null | undefined;
  loading: boolean;
}) {
  if (loading) return <SkeletonTile label="Active stakers 24h" />;
  if (!signal) {
    return (
      <Tile label="Active stakers 24h" value="-" sub="No staking activity yet" href="/analytics" ctaLabel="See analytics" empty />
    );
  }
  const tone: "ok" | "warn" | "muted" =
    Math.abs(signal.deltaPct) < 5 ? "muted" : signal.deltaPct > 0 ? "ok" : "warn";
  return (
    <Tile
      label="Active stakers 24h"
      value={signal.count24h.toLocaleString()}
      valueTone={tone}
      viz={<DeltaGauge pct={signal.deltaPct} />}
      sub={
        <>
          <span className="sg-mono">{Math.round(signal.avg30d).toLocaleString()}</span> avg over 30d
          {" · "}
          <span className={`sg-delta ${signal.deltaPct >= 0 ? "tone-ok" : "tone-warn"}`}>
            {signal.deltaPct >= 0 ? "+" : ""}{signal.deltaPct.toFixed(1)}%
          </span>
        </>
      }
      href="/analytics"
      ctaLabel="See analytics"
    />
  );
}

function TopValidatorTile({ signal, loading }: {
  signal: SignalsResponse["signals"]["topValidator"] | null | undefined;
  loading: boolean;
}) {
  if (loading) return <SkeletonTile label="Top validator mover 24h" />;
  if (!signal || signal.netTx === 0) {
    return (
      <Tile label="Top validator mover 24h" value="-" sub="No net validator deltas" href="/validators" ctaLabel="See validators" empty />
    );
  }
  const name = signal.moniker || `${signal.operator.slice(0, 10)}…`;
  return (
    <Tile
      label="Top validator mover 24h"
      value={
        <>
          <span className="sg-sign">{signal.direction === "in" ? "+" : "-"}</span>
          {formatTx(Math.abs(signal.netTx))}
        </>
      }
      valueTone={signal.direction === "in" ? "ok" : "warn"}
      viz={<DirectionalBar pct={Math.max(8, Math.min(100, Math.log10(Math.abs(signal.netTx) + 1) * 16))} direction={signal.direction} />}
      sub={<><strong>{name}</strong> saw the largest 24h net change</>}
      href="/validators"
      ctaLabel="See validators"
    />
  );
}

// ─── Mini-viz primitives ───────────────────────────────────────────────
// Each is a tiny stateless component, pure CSS, no chart lib.

function SplitBar({ leftLabel, leftPct, rightLabel, rightPct }: {
  leftLabel: string; leftPct: number; rightLabel: string; rightPct: number;
}) {
  return (
    <div className="sg-splitbar" aria-label={`${leftLabel} ${leftPct.toFixed(0)}%, ${rightLabel} ${rightPct.toFixed(0)}%`}>
      <span className="sg-splitbar-left" style={{ width: `${leftPct}%` }} />
      <span className="sg-splitbar-right" style={{ width: `${rightPct}%` }} />
    </div>
  );
}

function DotRow({ count, muted = 0 }: { count: number; muted?: number }) {
  const filled = Math.min(count, 12);
  const mutedDots = Math.max(muted, 0);
  const totalRender = filled || mutedDots;
  return (
    <div className="sg-dotrow" aria-label={`${count} moves`}>
      {Array.from({ length: totalRender }).map((_, i) => (
        <span key={i} className={`sg-dot ${i < filled ? "filled" : "muted"}`} />
      ))}
    </div>
  );
}

function ArrivalsBar({ arrivals, exits }: { arrivals: number; exits: number }) {
  const total = arrivals + exits;
  if (total === 0) {
    return <div className="sg-arrivalsbar empty" />;
  }
  const upPct = (arrivals / total) * 100;
  return (
    <div className="sg-arrivalsbar">
      <span className="sg-arrivalsbar-up" style={{ width: `${upPct}%` }} />
      <span className="sg-arrivalsbar-down" style={{ width: `${100 - upPct}%` }} />
    </div>
  );
}

function MiniBars({ days, highlightDate }: {
  days: Array<{ date: string; tx: number }>;
  highlightDate: string | null;
}) {
  const max = Math.max(...days.map((d) => d.tx), 1);
  return (
    <div className="sg-minibars" aria-label="Next 7 days unbonding">
      {days.map((d) => {
        const h = (d.tx / max) * 100;
        return (
          <span
            key={d.date}
            className={`sg-minibar ${d.date === highlightDate ? "peak" : ""}`}
            style={{ height: `${Math.max(6, h)}%` }}
            title={`${d.date}: ${formatTx(d.tx)} TX`}
          />
        );
      })}
    </div>
  );
}

function DeltaGauge({ pct }: { pct: number }) {
  // -100..+100 mapped to a centered horizontal indicator. Clamps so a
  // wild outlier doesn't blow the viz proportions.
  const clamped = Math.max(-50, Math.min(50, pct));
  const left = 50 + clamped; // 0..100 across the bar
  return (
    <div className="sg-deltagauge">
      <span className="sg-deltagauge-axis" />
      <span className="sg-deltagauge-center" />
      <span
        className={`sg-deltagauge-pin ${pct >= 0 ? "tone-ok" : "tone-warn"}`}
        style={{ left: `${left}%` }}
      />
    </div>
  );
}

function DirectionalBar({ pct, direction }: { pct: number; direction: "in" | "out" }) {
  return (
    <div className={`sg-dirbar dir-${direction}`}>
      <span className="sg-dirbar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

// ─── Loading skeleton ──────────────────────────────────────────────────
function SkeletonTile({ label }: { label: string }) {
  return (
    <div className="sg-tile sg-tile-skeleton">
      <div className="sg-tile-label">{label}</div>
      <div className="sg-tile-value sg-skel-line wide" />
      <div className="sg-tile-viz sg-skel-line short" />
      <div className="sg-tile-sub sg-skel-line med" />
    </div>
  );
}

// ─── Format helpers ────────────────────────────────────────────────────
// Compact TX amount via the shared sign-safe formatter (2dp K so whale
// amounts read with enough precision).
function formatTx(n: number): string {
  return formatCompact(n, { k: 1, m: 2, b: 2 });
}
// Correct verb + preposition for all three staking event types - the
// earlier two-way branch mislabeled redelegate as "delegated".
function moveVerb(type: "delegate" | "undelegate" | "redelegate"): string {
  if (type === "undelegate") return "unbonded";
  if (type === "redelegate") return "redelegated";
  return "delegated";
}
function movePreposition(type: "delegate" | "undelegate" | "redelegate"): string {
  return type === "undelegate" ? "from" : "to";
}
function shortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
