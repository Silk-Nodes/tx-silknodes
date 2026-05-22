"use client";

import { useState } from "react";
import type { ValidatorVote, VelocityPoint } from "@/hooks/useProposalDetail";
import { computeInsights } from "@/lib/governance-insights";
import VoteConcentration from "./VoteConcentration";
import VelocityChart from "./VelocityChart";

interface Props {
  validators: ValidatorVote[];
  velocity: VelocityPoint[];
  totalBonded: number;
  yesThreshold: number;
  quorumRequired: number;
}

// Plain-English insights up top, advanced metrics hidden behind a toggle.
// Validators and journalists who want the Gini number get one click.
// Casual users never see jargon.
export default function GovernanceInsights({
  validators,
  velocity,
  totalBonded,
  yesThreshold,
  quorumRequired,
}: Props) {
  const [advanced, setAdvanced] = useState(false);
  const insights = computeInsights(validators, totalBonded, velocity, quorumRequired);

  return (
    <div className="gi">
      <ul className="gi-bullets">
        {insights.bullets.map((b, i) => (
          <li key={i} className={`gi-bullet gi-tone-${b.tone}`}>
            <span className="gi-bullet-dot" aria-hidden="true" />
            <span className="gi-bullet-text">{b.text}</span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        className="gi-advanced-toggle"
        onClick={() => setAdvanced((v) => !v)}
        aria-expanded={advanced}
      >
        {advanced ? "Hide advanced metrics" : "Show advanced metrics"}
        <span className="gi-advanced-chev">{advanced ? "▴" : "▾"}</span>
      </button>

      {advanced && (
        <div className="gi-advanced">
          <div className="gi-advanced-section">
            <div className="gi-advanced-label">Concentration</div>
            <VoteConcentration
              validators={validators}
              totalBonded={totalBonded}
              yesThreshold={yesThreshold}
              quorumRequired={quorumRequired}
            />
          </div>
          <div className="gi-advanced-section">
            <div className="gi-advanced-label">Vote velocity</div>
            <VelocityChart
              series={velocity}
              bondedSnapshot={totalBonded}
              quorumRequired={quorumRequired}
            />
          </div>
        </div>
      )}
    </div>
  );
}
