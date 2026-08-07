"use client";

// What each PSE distribution was worth on the day it landed.
//
// Requested by a holder: "is there anywhere to see the price per TX at the
// time of each distribution and its % change since the one preceding". He
// added, correctly, that it would not be nice viewing right now but would be
// worth having later. It is published as-is for that reason: a table that
// only looks good is not worth building.
//
// Sits above the cohort section, which is the other backward-looking part of
// this page. That one answers what recipients did with a distribution; this
// one answers what the distribution was worth.

import { useEffect, useState } from "react";
import { formatCompact } from "@/lib/ui-format";
import Tooltip from "@/components/Tooltip";
import Shareable from "@/components/share/Shareable";

interface Distribution {
  cycle: number;
  date: string;
  poolTX: number;
  priceUsd: number | null;
  changePct: number | null;
  poolUsd: number | null;
}

const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

// Prices here run to six decimals and sub-cent moves matter, so this cannot
// use the shared compact formatter.
const fmtPrice = (v: number) => `$${v.toFixed(6)}`;

export default function PseDistributionPrices() {
  const [rows, setRows] = useState<Distribution[] | null>(null);
  const [source, setSource] = useState<string>("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch("/api/pse-distributions")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.distributions) { setFailed(true); return; }
        setRows(d.distributions);
        setSource(d.priceSource ?? "");
      })
      .catch(() => setFailed(true));
  }, []);

  if (failed) return null;

  const latest = rows && rows.length > 0 ? rows[rows.length - 1] : null;

  return (
    <div className="psp-card psp-card-wide pdp-card">
      <div className="pdp-head">
        <div className="psp-card-head" style={{ marginBottom: 2 }}>
          Distributions and TX price
          <Tooltip
            position="bottom"
            text="What each PSE distribution was worth on the day it landed. The pool is fixed at 476,190,476 TX per cycle, so the dollar value moves only with the TX price. Change compares each distribution to the one before it."
          />
        </div>
        <span className="pdp-sub">
          Every cycle distributes the same 476,190,476 TX, so the dollar value moves
          with price alone
        </span>
      </div>

      {!rows ? (
        <div className="pdp-loading">Reading distribution history...</div>
      ) : rows.length === 0 ? (
        <div className="psp-empty">No settled distributions yet.</div>
      ) : (
        <>
          {/* Same treatment as the cohort section directly below: the branded
              frame (framed defaults to true) supplies the heading, caption and
              footer, so every snapshot from this page looks like every other
              one. Only the table goes inside, not this page card, or the
              export would carry two sets of chrome. */}
          <Shareable
            title="PSE distributions and TX price"
            subtitle={latest ? `${rows.length} cycles to ${fmtDate(latest.date)}` : undefined}
            caption="Every cycle distributes the same 476,190,476 TX, so the dollar value moves with price alone."
            // The wrapper starts at the table, so the default top: 12px put the
            // camera on top of the first row's pool value. Lifted into the card
            // header, which has ~745px of clear space to the right of the
            // subtitle. Negative because it moves up out of the wrapper.
            cameraOffset={{ top: -46, right: 0 }}
          >
          <div className="pdp-wrap">
            <table className="pdp-table">
              <thead>
                <tr>
                  <th>Cycle</th>
                  <th>Date</th>
                  <th className="pdp-num">Pool</th>
                  <th className="pdp-num">TX price</th>
                  <th className="pdp-num">Change</th>
                  <th className="pdp-num">Pool value</th>
                </tr>
              </thead>
              <tbody>
                {/* Newest first: the most recent distribution is the one people
                    are looking for, and the list only grows from here. */}
                {[...rows].reverse().map((d) => (
                  <tr key={d.cycle}>
                    <td className="pdp-cycle">#{d.cycle}</td>
                    <td>{fmtDate(d.date)}</td>
                    <td className="pdp-num mono">{formatCompact(d.poolTX)} TX</td>
                    <td className="pdp-num mono">
                      {d.priceUsd !== null ? fmtPrice(d.priceUsd) : "-"}
                    </td>
                    <td className="pdp-num mono">
                      {d.changePct === null ? (
                        <span className="pdp-flat">-</span>
                      ) : (
                        <span className={d.changePct >= 0 ? "pdp-up" : "pdp-down"}>
                          {d.changePct >= 0 ? "+" : ""}
                          {d.changePct.toFixed(1)}%
                        </span>
                      )}
                    </td>
                    <td className="pdp-num mono">
                      {d.poolUsd !== null ? `$${formatCompact(d.poolUsd)}` : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </Shareable>
          {source && <p className="pdp-source">Price: {source}</p>}
        </>
      )}
    </div>
  );
}
