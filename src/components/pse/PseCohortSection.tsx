"use client";

import { useEffect, useMemo, useState } from "react";
import Shareable from "@/components/share/Shareable";

// ── API contract (must match /api/pse-cohort route.ts) ─────────────────
type CohortPoint = {
  cycle: number;
  cohortTopN: number;
  windowComplete: boolean;
  windowDaysCovered: number;
  cohortSize: number;
  receivedTx: number;
  keptStakedPct: number;
  unbondedPct: number;
  leftWalletPct: number;
};
type CohortResponse = {
  updatedAt: string;
  cohortSizes: number[];
  points: CohortPoint[];
};

// PseCohortSection: the backward-looking counterpart to the PSE
// calculator. Answers "what do recipients actually DO with their PSE"
// using daily cohort snapshots. One stacked bar per cycle so the
// cycle-over-cycle trend (kept staked vs unbonded) reads left to right.
//
// Cohort toggle (top 100 / 500 / 1000) because whales behave differently
// from the broad set - that gap is itself a finding worth surfacing.
//
// Renders nothing destructive if the DB is unreachable: shows an empty
// state instead of erroring (the data only exists when the VM Postgres
// is connected).
export default function PseCohortSection() {
  const [data, setData] = useState<CohortResponse | null>(null);
  const [errored, setErrored] = useState(false);
  const [cohort, setCohort] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/pse-cohort")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((j: CohortResponse) => {
        if (cancelled) return;
        setData(j);
        // Default to the broadest cohort available (most representative).
        if (j.cohortSizes.length) {
          setCohort(j.cohortSizes[j.cohortSizes.length - 1]);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setErrored(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const cohortSizes = data?.cohortSizes ?? [];
  const activeCohort = cohort ?? cohortSizes[cohortSizes.length - 1] ?? null;

  // Points for the selected cohort, ordered by cycle ascending.
  const series = useMemo(() => {
    if (!data || activeCohort == null) return [];
    return data.points
      .filter((p) => p.cohortTopN === activeCohort)
      .sort((a, b) => a.cycle - b.cycle);
  }, [data, activeCohort]);

  // Headline = latest cycle's kept-staked %, plus delta vs prior cycle.
  const headline = useMemo(() => {
    if (series.length === 0) return null;
    const latest = series[series.length - 1];
    const prior = series.length > 1 ? series[series.length - 2] : null;
    const delta = prior ? latest.keptStakedPct - prior.keptStakedPct : null;
    return { latest, prior, delta };
  }, [series]);

  const loading = !data && !errored;

  return (
    <section className="pse-cohort" aria-busy={loading} aria-live="polite">
      <div className="pse-cohort-head">
        <div>
          <h2 className="pse-cohort-title">What recipients do with PSE</h2>
          <p className="pse-cohort-sub">
            PSE auto-stakes the reward at distribution. We track each
            cohort for 7 days after to see how much stays staked versus
            gets unbonded and sold.
          </p>
        </div>
        {cohortSizes.length > 0 && (
          // Group of toggle buttons (aria-pressed), not a tablist: these
          // filter the same chart, they don't switch panels. aria-pressed
          // is the honest contract and needs no roving-tabindex/arrow-key
          // handling that a real tablist would require.
          <div className="pse-cohort-toggle" role="group" aria-label="Cohort size">
            {cohortSizes.map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={n === activeCohort}
                className={`pse-cohort-toggle-btn ${n === activeCohort ? "active" : ""}`}
                onClick={() => setCohort(n)}
              >
                Top {n}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading && <div className="pse-cohort-empty">Loading cohort data…</div>}

      {!loading && series.length === 0 && (
        <div className="pse-cohort-empty">
          {errored
            ? "Cohort data temporarily unavailable."
            : "No cohort snapshots yet. Data appears after the first PSE distribution window."}
        </div>
      )}

      {!loading && headline && (
        <Shareable
          title="PSE recipient behavior"
          subtitle={`Top ${activeCohort} recipients · kept staked vs sold, per cycle`}
          caption="PSE auto-stakes at distribution. Bars show where it ended up 7 days later."
        >
          {/* ── Headline ── */}
          <div className="pse-cohort-headline">
            <div className="pse-cohort-headline-main">
              <span className="pse-cohort-headline-value">
                {headline.latest.keptStakedPct.toFixed(1)}%
              </span>
              <span className="pse-cohort-headline-label">
                of cycle {headline.latest.cycle} PSE stayed staked
                {!headline.latest.windowComplete && (
                  <span className="pse-cohort-live"> · window still open</span>
                )}
              </span>
            </div>
            {headline.delta != null && (
              <div
                className={`pse-cohort-delta ${headline.delta >= 0 ? "tone-ok" : "tone-warn"}`}
              >
                {headline.delta >= 0 ? "▴" : "▾"}{" "}
                {Math.abs(headline.delta).toFixed(1)} pts vs cycle{" "}
                {headline.prior?.cycle}
              </div>
            )}
          </div>

          {/* ── Stacked bars per cycle ── */}
          <div className="pse-cohort-chart">
            <div className="pse-cohort-bars">
              {series.map((p) => (
                <CohortBar key={p.cycle} point={p} />
              ))}
            </div>
            <Legend />
          </div>
        </Shareable>
      )}

      {/* ── Plain-English callouts (outside the share card) ── */}
      {!loading && headline && (
        <ul className="pse-cohort-notes">
          <li>
            Unbonded PSE leaves wallets almost 1:1 on TX, so the unbonded
            share reads as real sell behavior, not repositioning.
          </li>
          <li>
            Larger holders sell more than the broad set. Compare Top 100
            against Top 1000 to see the gap.
          </li>
        </ul>
      )}
    </section>
  );
}

// One cycle's stacked bar. Three segments bottom-to-top: kept staked
// (olive), unbonded-but-still-in-wallet (muted), left wallet (orange).
// We split unbonded into "left wallet" and "held liquid" so the bar
// distinguishes intent (unbonded) from action (actually sold/moved).
function CohortBar({ point }: { point: CohortPoint }) {
  // Clamp every input to [0,100] and normalize the stacked segments so
  // inconsistent API data (e.g. parts summing >100 from rounding or a
  // collector bug) can never make a segment overflow the bar.
  const clamp = (v: number) => Math.max(0, Math.min(100, v || 0));
  const kept = clamp(point.keptStakedPct);
  const left = clamp(point.leftWalletPct);
  // Unbonded but not yet out of the wallet = held liquid (undecided).
  const heldLiquid = clamp(point.unbondedPct - point.leftWalletPct);
  const sum = kept + heldLiquid + left;
  // If the three segments already exceed 100, scale them down to fit
  // (preserving ratios) rather than overflowing the bar.
  const scale = sum > 100 ? 100 / sum : 1;
  const keptH = kept * scale;
  const leftH = left * scale;
  const liquidH = heldLiquid * scale;
  // Anything unaccounted (rounding, partials) pads the bar to 100.
  const other = Math.max(0, 100 - (keptH + leftH + liquidH));

  return (
    <div className="pse-cohort-bar-col">
      <div
        className="pse-cohort-bar"
        title={`Cycle ${point.cycle}: ${kept.toFixed(1)}% kept staked, ${point.unbondedPct.toFixed(1)}% unbonded (${left.toFixed(1)}% left wallet)`}
      >
        {other > 0 && (
          <span className="pse-cohort-seg seg-other" style={{ height: `${other}%` }} />
        )}
        {leftH > 0 && (
          <span className="pse-cohort-seg seg-left" style={{ height: `${leftH}%` }} />
        )}
        {liquidH > 0 && (
          <span className="pse-cohort-seg seg-liquid" style={{ height: `${liquidH}%` }} />
        )}
        <span className="pse-cohort-seg seg-kept" style={{ height: `${keptH}%` }} />
      </div>
      <div className="pse-cohort-bar-keptval">{kept.toFixed(0)}%</div>
      <div className="pse-cohort-bar-label">
        Cycle {point.cycle}
        {!point.windowComplete && <span className="pse-cohort-bar-open"> ·open</span>}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="pse-cohort-legend">
      <span className="pse-cohort-legend-item">
        <span className="pse-cohort-swatch seg-kept" /> Kept staked
      </span>
      <span className="pse-cohort-legend-item">
        <span className="pse-cohort-swatch seg-liquid" /> Unbonded, held liquid
      </span>
      <span className="pse-cohort-legend-item">
        <span className="pse-cohort-swatch seg-left" /> Left wallet
      </span>
    </div>
  );
}
