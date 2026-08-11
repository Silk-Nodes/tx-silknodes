"use client";

// What PSE has actually paid this wallet, and what is accruing now.
//
// The two halves are different KINDS of number and are labelled as such.
//
// Settled cycles are exact because pse_transfer.amount IS the transfer the
// chain made. Nothing here recomputes it. Verified across all five cycles:
// every recipient's score sums to the allocation's total_score with zero
// difference, and the payouts sum to the pool to the ucore.
//
// The score/total_score ratio is shown as the derivation, NOT as something
// that reproduces the payout bit for bit. Checking all 9,990 cycle-5 payouts,
// floor(score * pool / total_score) matches 8,144 of them and the rest run up
// to 170 ucore high: the divisor the chain actually used is about 7.8e10
// below the published total_score, a relative difference of 1.0e-11. That is
// far below the 6 decimal places of share shown here, so the percentage is
// right as displayed, but the copy must not invite anyone to reproduce the
// exact ucore and conclude we are wrong when they cannot.
//
// The current cycle cannot be exact, and no data source fixes that. The
// payout divides by the total score at the SNAPSHOT BLOCK, which has not
// happened: this wallet's score is still accruing, so is everyone else's, and
// stake moves in between. So the figure here is explicitly a projection, its
// basis is stated (the previous cycle's settled total), and it is never
// called a reward.
//
// All score arithmetic is BigInt. Scores run past 18 digits and JavaScript
// numbers lose precision after 16.

import { useEffect, useState } from "react";
import { formatCompact } from "@/lib/ui-format";
import Tooltip from "@/components/Tooltip";
import { fetchOnChainPSEScore } from "@/lib/pse-calculator";

interface Payout {
  height: number;
  amountTX: number;
  amountUcore: string;
  score: string;
  type: string;
}
interface Cycle {
  cycle: number;
  date: string;
  poolTX: number;
  priceUsd: number | null;
  startAtHeight: number;
  endAtHeight: number;
  totalScore: string;
}
interface Row {
  cycle: number;
  date: string;
  amountTX: number;
  amountUcore: string;
  score: string;
  totalScore: string;
  priceUsd: number | null;
  usd: number | null;
  sharePct: number;
}

const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });

/** Exact TX from raw ucore, without going through a float. */
function ucoreToTX(ucore: string): string {
  const neg = ucore.startsWith("-");
  const digits = (neg ? ucore.slice(1) : ucore).padStart(7, "0");
  const whole = digits.slice(0, -6).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${whole}.${digits.slice(-6)}`;
}

/** score / total as a percentage to 6 dp, computed in BigInt. */
function sharePctExact(score: string, total: string): number {
  try {
    const s = BigInt(score), t = BigInt(total);
    if (t === BigInt(0)) return 0;
    return Number((s * BigInt(100_000_000)) / t) / 1_000_000;
  } catch {
    return 0;
  }
}

/** Compact form of a very large integer, e.g. 3.513e17. */
function sci(v: string): string {
  const d = v.replace("-", "");
  if (d.length <= 4) return v;
  return `${d[0]}.${d.slice(1, 4)}e${d.length - 1}`;
}

export default function PseHistory({ address }: { address: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [unmatched, setUnmatched] = useState(0);
  const [liveScore, setLiveScore] = useState<string | null>(null);
  const [lastCycle, setLastCycle] = useState<Cycle | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setFailed(false);
    setLiveScore(null);

    Promise.all([
      fetch(`/api/address/pse-earned?address=${address}`).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/pse-distributions").then((r) => (r.ok ? r.json() : null)),
      fetchOnChainPSEScore(address).catch(() => null),
    ])
      .then(([earned, dist, score]) => {
        if (cancelled) return;
        if (!earned || !dist) { setFailed(true); return; }
        const payouts: Payout[] = earned.distributions ?? [];
        const cycles: Cycle[] = dist.distributions ?? [];
        setLiveScore(score);
        setLastCycle(cycles.length ? cycles[cycles.length - 1] : null);

        // Distributions begin at start_at_height and spill forward over the
        // following blocks; cycles 1 and 2 declare zero-width ranges, so an
        // exact range test dropped cycle 2 for every wallet.
        const byStart = [...cycles].sort((a, b) => a.startAtHeight - b.startAtHeight);
        let missed = 0;
        const mapped: Row[] = [];
        for (const p of payouts) {
          let c: Cycle | undefined;
          for (let i = byStart.length - 1; i >= 0; i--) {
            if (p.height >= byStart[i].startAtHeight) {
              const next = byStart[i + 1];
              if (!next || p.height < next.startAtHeight) c = byStart[i];
              break;
            }
          }
          if (!c) { missed++; continue; }
          mapped.push({
            cycle: c.cycle,
            date: c.date,
            amountTX: p.amountTX,
            amountUcore: String(p.amountUcore),
            score: String(p.score),
            totalScore: String(c.totalScore),
            priceUsd: c.priceUsd,
            usd: c.priceUsd !== null ? p.amountTX * c.priceUsd : null,
            sharePct: sharePctExact(String(p.score), String(c.totalScore)),
          });
        }
        mapped.sort((a, b) => b.cycle - a.cycle);
        setUnmatched(missed);
        setRows(mapped);
      })
      .catch(() => { if (!cancelled) setFailed(true); });

    return () => { cancelled = true; };
  }, [address]);

  if (failed) return <div className="psp-empty">PSE history could not be read right now.</div>;
  if (!rows) return <div className="pdp-loading">Reading distribution history...</div>;

  const totalUcore = rows.reduce((n, r) => n + BigInt(r.amountUcore || "0"), BigInt(0));
  const totalUsd = rows.reduce((n, r) => n + (r.usd ?? 0), 0);

  // Projection for the cycle in progress, on the previous cycle's SETTLED
  // total. Stated as a comparison, never as an amount owed.
  const projShare =
    liveScore && lastCycle?.totalScore ? sharePctExact(liveScore, lastCycle.totalScore) : null;
  const projection =
    projShare !== null && lastCycle
      ? { sharePct: projShare, tx: (projShare / 100) * lastCycle.poolTX, basisCycle: lastCycle.cycle }
      : null;

  return (
    <div className="pse-hist">
      {/* ── Settled: exact ── */}
      <div className="pseh-head">
        <div className="psp-metric">
          <span className="psp-metric-label">
            PSE received
            <Tooltip text="Every PSE transfer the chain has made to this wallet, read from the indexer's pse_transfer table. These are the amounts that landed, not estimates or recalculations. Each row also shows the score the chain used, which is what set the size of the share." />
          </span>
          <span className="psp-metric-value psp-metric-accent">
            {rows.length ? `${ucoreToTX(totalUcore.toString())} TX` : "0 TX"}
          </span>
          <span className="psp-metric-sub">
            across {rows.length} settled cycle{rows.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="psp-metric">
          <span className="psp-metric-label">
            Worth when paid
            <Tooltip text="Each distribution valued at the TX price on the day it landed, then summed. Restating past income at today's price would flatter or punish it depending on where price has since moved." />
          </span>
          <span className="psp-metric-value">{totalUsd > 0 ? `$${formatCompact(totalUsd)}` : "-"}</span>
          <span className="psp-metric-sub">at each cycle&apos;s own price</span>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="psp-empty">
          No PSE received yet. PSE goes to stake bonded across a whole cycle, so a wallet
          that staked mid-cycle first appears in the following one.
        </div>
      ) : (
        <div className="pdp-wrap">
          <table className="pdp-table">
            <thead>
              <tr>
                <th>Cycle</th>
                <th>Date</th>
                <th className="pdp-num">Received</th>
                <th className="pdp-num">
                  Your score
                  <Tooltip text="The chain's own score for this wallet in that cycle: stake multiplied by how long it stayed bonded. Your share is this divided by the cycle total. Hover a value for every digit and the total it was measured against." />
                </th>
                <th className="pdp-num">Share of pool</th>
                <th className="pdp-num">TX price</th>
                <th className="pdp-num">Worth then</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.cycle}>
                  <td className="pdp-cycle">#{r.cycle}</td>
                  <td>{fmtDate(r.date)}</td>
                  {/* Full precision: this is the number a reader checks. */}
                  <td className="pdp-num mono">{ucoreToTX(r.amountUcore)} TX</td>
                  <td className="pdp-num mono" title={`${r.score} of ${r.totalScore} total`}>
                    {sci(r.score)}
                  </td>
                  <td className="pdp-num mono">
                    {r.sharePct < 0.000001 ? "<0.000001%" : `${r.sharePct.toFixed(6)}%`}
                  </td>
                  <td className="pdp-num mono">{r.priceUsd !== null ? `$${r.priceUsd.toFixed(6)}` : "-"}</td>
                  <td className="pdp-num mono">{r.usd !== null ? `$${formatCompact(r.usd)}` : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── In progress: explicitly not a payout ── */}
      {projection && liveScore && (
        <div className="pseh-proj">
          <span className="pseh-proj-label">
            This cycle, in progress
            <Tooltip text="Not a reward and not owed. A PSE payout divides by the total score of every delegator at the snapshot block, which has not happened yet: your score is still accruing, so is everyone else's, and stake moves in between. This projects your current exact score against the previous cycle's settled total, purely as a reference point." />
          </span>
          <div className="pseh-proj-grid">
            <div>
              <span className="pseh-proj-key">Your score now</span>
              <span className="mono pseh-proj-val" title={liveScore}>{sci(liveScore)}</span>
              <span className="pseh-proj-note">exact, read from the chain</span>
            </div>
            <div>
              <span className="pseh-proj-key">Against cycle #{projection.basisCycle}&apos;s total</span>
              <span className="mono pseh-proj-val">{projection.sharePct.toFixed(6)}%</span>
              <span className="pseh-proj-note">of that cycle&apos;s pool</span>
            </div>
            <div>
              <span className="pseh-proj-key">Which would have been</span>
              <span className="mono pseh-proj-val">~{formatCompact(projection.tx)} TX</span>
              <span className="pseh-proj-note">if this cycle settles like the last</span>
            </div>
          </div>
        </div>
      )}

      {unmatched > 0 && (
        <p className="pdp-source">
          {unmatched} payout{unmatched === 1 ? "" : "s"} could not be matched to a known cycle and
          {unmatched === 1 ? " is" : " are"} left out of the totals above.
        </p>
      )}
      <p className="pdp-source">
        Amounts and scores are read from the chain, not recalculated: each figure is the
        transfer that actually settled. Share is your score over the cycle&apos;s total score.
        Price: CoinGecko daily close for each distribution date.
      </p>
    </div>
  );
}
