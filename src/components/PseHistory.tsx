"use client";

// What this wallet has actually been PAID by PSE, cycle by cycle.
//
// Everything else on this site estimates the NEXT distribution from a live
// score. This is the opposite: the record of what already landed, straight
// from the indexer's pse_transfer table (recipient_address, amount, height).
//
// Two things make it worth its own view rather than a number:
//
//   - each payout is valued at the TX price on the day it landed, not at
//     today's price. Restating past income at the current price is the most
//     common way this kind of table lies, in either direction.
//   - share of pool. The pool is fixed at 476,190,476 TX every cycle, so a
//     wallet's share moving between cycles says something the TX amount
//     alone does not: it separates "I staked more" from "the price moved".
//
// Payouts arrive keyed by block height, and cycles are height RANGES, so
// matching a payout to its cycle is a range lookup rather than a date
// comparison.

import { useEffect, useState } from "react";
import { formatCompact } from "@/lib/ui-format";
import Tooltip from "@/components/Tooltip";

interface Payout {
  height: number;
  amountTX: number;
  type: string;
}
interface Cycle {
  cycle: number;
  date: string;
  poolTX: number;
  priceUsd: number | null;
  startAtHeight: number;
  endAtHeight: number;
}
interface Row {
  cycle: number;
  date: string;
  amountTX: number;
  poolTX: number;
  priceUsd: number | null;
  usd: number | null;
  sharePct: number;
}

const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });

export default function PseHistory({ address }: { address: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [unmatched, setUnmatched] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setFailed(false);

    Promise.all([
      fetch(`/api/address/pse-earned?address=${address}`).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/pse-distributions").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([earned, dist]) => {
        if (cancelled) return;
        const payouts: Payout[] = earned?.distributions ?? [];
        const cycles: Cycle[] = dist?.distributions ?? [];
        if (!earned || !dist) { setFailed(true); return; }

        let missed = 0;
        const mapped: Row[] = [];
        for (const p of payouts) {
          const c = cycles.find((x) => p.height >= x.startAtHeight && p.height <= x.endAtHeight);
          // A payout outside every known range is not guessed into the
          // nearest cycle. It is counted and disclosed instead, because a
          // wrongly attributed payout is worse than a missing one.
          if (!c) { missed++; continue; }
          mapped.push({
            cycle: c.cycle,
            date: c.date,
            amountTX: p.amountTX,
            poolTX: c.poolTX,
            priceUsd: c.priceUsd,
            usd: c.priceUsd !== null ? p.amountTX * c.priceUsd : null,
            sharePct: c.poolTX > 0 ? (p.amountTX / c.poolTX) * 100 : 0,
          });
        }
        mapped.sort((a, b) => b.cycle - a.cycle);
        setUnmatched(missed);
        setRows(mapped);
      })
      .catch(() => { if (!cancelled) setFailed(true); });

    return () => { cancelled = true; };
  }, [address]);

  if (failed) {
    return <div className="psp-empty">PSE history could not be read right now.</div>;
  }
  if (!rows) {
    return <div className="pdp-loading">Reading distribution history...</div>;
  }
  if (rows.length === 0) {
    return (
      <div className="psp-empty">
        No PSE received yet. PSE goes to stake that is bonded across a whole cycle,
        so a wallet that staked mid-cycle first appears in the following one.
      </div>
    );
  }

  const totalTX = rows.reduce((n, r) => n + r.amountTX, 0);
  // Summed at each cycle's own price, so this is what the payouts were worth
  // when they landed, not what they would be worth today.
  const totalUsd = rows.reduce((n, r) => n + (r.usd ?? 0), 0);

  return (
    <div className="pse-hist">
      <div className="psp-headline pfp-headline">
        <div className="psp-metric">
          <span className="psp-metric-label">
            PSE received
            <Tooltip text="Every PSE distribution paid to this wallet, read from the chain. This is what actually landed, not an estimate of what is coming." />
          </span>
          <span className="psp-metric-value psp-metric-accent">{formatCompact(totalTX)} TX</span>
          <span className="psp-metric-sub">across {rows.length} cycle{rows.length === 1 ? "" : "s"}</span>
        </div>
        <div className="psp-metric">
          <span className="psp-metric-label">
            Worth when paid
            <Tooltip text="Each distribution valued at the TX price on the day it landed, then summed. Restating past income at today's price would flatter or punish it depending on where price has since moved." />
          </span>
          <span className="psp-metric-value">
            {totalUsd > 0 ? `$${formatCompact(totalUsd)}` : "-"}
          </span>
          <span className="psp-metric-sub">at each cycle&apos;s own price</span>
        </div>
      </div>

      <div className="pdp-wrap">
        <table className="pdp-table">
          <thead>
            <tr>
              <th>Cycle</th>
              <th>Date</th>
              <th className="pdp-num">Received</th>
              <th className="pdp-num">TX price</th>
              <th className="pdp-num">Worth then</th>
              <th className="pdp-num">Share of pool</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.cycle}>
                <td className="pdp-cycle">#{r.cycle}</td>
                <td>{fmtDate(r.date)}</td>
                <td className="pdp-num mono">{formatCompact(r.amountTX)} TX</td>
                <td className="pdp-num mono">{r.priceUsd !== null ? `$${r.priceUsd.toFixed(6)}` : "-"}</td>
                <td className="pdp-num mono">{r.usd !== null ? `$${formatCompact(r.usd)}` : "-"}</td>
                {/* Small shares need more than two decimals to move at all. */}
                <td className="pdp-num mono">{r.sharePct < 0.0001 ? "<0.0001%" : `${r.sharePct.toFixed(4)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {unmatched > 0 && (
        <p className="pdp-source">
          {unmatched} payout{unmatched === 1 ? "" : "s"} could not be matched to a known cycle and
          {unmatched === 1 ? " is" : " are"} left out of the totals above.
        </p>
      )}
      <p className="pdp-source">
        Amounts from the chain. Price: CoinGecko daily close for each distribution date.
      </p>
    </div>
  );
}
