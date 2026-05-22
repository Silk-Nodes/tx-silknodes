"use client";

import { formatTxAmount } from "@/lib/governance";

interface Props {
  yes: number;
  no: number;
  veto: number;
  abstain: number;
  total: number;
}

// Single horizontal stacked progress bar replacing the 4-card grid. When
// outcome is lopsided (e.g. 100% Yes), the bar tells the story instantly;
// the smaller side counts go in a muted row below so they don't take
// equal visual weight.
export default function VoteResultBar({ yes, no, veto, abstain, total }: Props) {
  const sum = yes + no + veto + abstain;
  if (sum === 0) {
    return <div className="vrb-empty">No votes were cast.</div>;
  }
  const pct = (n: number) => (n / sum) * 100;

  // Dominant side: pick the largest non-abstain. Abstain never "wins."
  const dominant = yes >= no && yes >= veto
    ? { label: "Yes", value: yes, cls: "vrb-dom-yes" }
    : no >= veto
    ? { label: "No", value: no, cls: "vrb-dom-no" }
    : { label: "Veto", value: veto, cls: "vrb-dom-veto" };

  return (
    <div className="vrb">
      <div className="vrb-bar" role="img" aria-label="Vote distribution">
        {yes > 0 && (
          <div className="vrb-seg vrb-yes" style={{ width: `${pct(yes)}%` }} title={`Yes ${pct(yes).toFixed(1)}%`} />
        )}
        {no > 0 && (
          <div className="vrb-seg vrb-no" style={{ width: `${pct(no)}%` }} title={`No ${pct(no).toFixed(1)}%`} />
        )}
        {veto > 0 && (
          <div className="vrb-seg vrb-veto" style={{ width: `${pct(veto)}%` }} title={`Veto ${pct(veto).toFixed(1)}%`} />
        )}
        {abstain > 0 && (
          <div className="vrb-seg vrb-abstain" style={{ width: `${pct(abstain)}%` }} title={`Abstain ${pct(abstain).toFixed(1)}%`} />
        )}
      </div>

      <div className="vrb-headline">
        <span className={`vrb-headline-pct ${dominant.cls}`}>
          {pct(dominant.value).toFixed(pct(dominant.value) === 100 ? 0 : 1)}% {dominant.label}
        </span>
        <span className="vrb-headline-amount">
          {formatTxAmount(sum)} TX voted of {formatTxAmount(total)} bonded
        </span>
      </div>

      <div className="vrb-muted-row">
        {yes !== dominant.value && (
          <span className="vrb-mini vrb-mini-yes">Yes {pct(yes).toFixed(1)}%</span>
        )}
        {no !== dominant.value && (
          <span className="vrb-mini vrb-mini-no">No {pct(no).toFixed(1)}%</span>
        )}
        {veto !== dominant.value && (
          <span className="vrb-mini vrb-mini-veto">Veto {pct(veto).toFixed(1)}%</span>
        )}
        <span className="vrb-mini vrb-mini-abstain">Abstain {pct(abstain).toFixed(1)}%</span>
      </div>
    </div>
  );
}
