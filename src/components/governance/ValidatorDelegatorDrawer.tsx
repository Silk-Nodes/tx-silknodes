"use client";

// The mirror image of DelegatorDrawer. That one answers "which validators
// did this delegator override?"; this one answers "which of this
// validator's delegators voted for themselves, and did they agree or
// rebel?" Same dd-* styling on purpose: the two drawers are one interface
// read from opposite ends, and they should look like it.
//
// Honest scope note: only delegators who cast a direct vote can appear.
// The silent majority of a validator's delegators leave no vote record, so
// this is "who spoke up", never "everyone".

import { useEffect } from "react";
import type { ValidatorVote, VoteOption } from "@/hooks/useProposalDetail";
import type { OverrideEnrichment } from "@/hooks/useProposalOverrides";
import { formatTxAmount } from "@/lib/governance";

interface Props {
  validator: ValidatorVote | null;
  overrides: OverrideEnrichment[] | null;
  loading: boolean;
  onClose: () => void;
}

const VOTE_LABEL: Record<string, string> = {
  YES: "Yes",
  NO: "No",
  ABSTAIN: "Abstain",
  NO_WITH_VETO: "Veto",
  DID_NOT_VOTE: "Did not vote",
};

export default function ValidatorDelegatorDrawer({ validator, overrides, loading, onClose }: Props) {
  const open = !!validator;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!validator) return null;

  const op = validator.operatorAddress.toLowerCase();
  const validatorVoted = validator.voteOption !== "DID_NOT_VOTE";

  // Every direct voter with a delegation to this validator, valued at the
  // stake they delegate HERE, not their total across the set.
  const rows = (overrides ?? [])
    .map((o) => {
      const here = o.delegations.find((d) => d.operatorAddress.toLowerCase() === op);
      if (!here) return null;
      const rebelled = validatorVoted && o.voteOption !== validator.voteOption;
      return {
        voterAddress: o.voterAddress,
        voteOption: o.voteOption as VoteOption,
        votedAt: o.votedAt,
        delegatedTX: here.delegatedTX,
        rebelled,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => {
      if (a.rebelled !== b.rebelled) return a.rebelled ? -1 : 1;
      return b.delegatedTX - a.delegatedTX;
    });

  const votedPower = rows.reduce((s, r) => s + r.delegatedTX, 0);
  const rebels = rows.filter((r) => r.rebelled);
  const rebelPower = rebels.reduce((s, r) => s + r.delegatedTX, 0);

  return (
    <>
      <div className="delegator-drawer-backdrop" onClick={onClose} aria-hidden="true" />

      <aside
        className="delegator-drawer"
        role="dialog"
        aria-label={`Delegator votes behind ${validator.moniker}`}
      >
        <header className="dd-head">
          <div className="dd-head-eyebrow">VALIDATOR&apos;S DELEGATORS</div>
          <div className="dd-head-row">
            <div className="dd-head-addr">
              <span>{validator.moniker}</span>
              <button
                type="button"
                className="dd-copy"
                title="Copy operator address"
                onClick={() => navigator.clipboard?.writeText(validator.operatorAddress)}
              >
                Copy
              </button>
            </div>
            <button type="button" className="dd-close" onClick={onClose} aria-label="Close panel">
              ×
            </button>
          </div>
          <div className="dd-head-meta">
            Voted{" "}
            <span className={`vvt-vote-badge vvt-vote-${validator.voteOption.toLowerCase()}`}>
              {VOTE_LABEL[validator.voteOption]}
            </span>{" "}
            with {formatTxAmount(validator.bondedStakeTX)} TX bonded
          </div>
        </header>

        <div className="dd-summary">
          <DdStat
            label="Delegators who voted"
            value={`${rows.length}`}
            sub={`${formatTxAmount(votedPower)} TX voted directly`}
          />
          <DdStat
            label={validatorVoted ? "Rebelled" : "Voted despite silence"}
            value={
              validatorVoted
                ? (rebels.length === 0 ? "None" : `${rebels.length} of ${rows.length}`)
                : `${rows.length}`
            }
            sub={
              validatorVoted
                ? (rebels.length === 0
                    ? "Every direct voter agreed"
                    : `${formatTxAmount(rebelPower)} TX against this validator's vote`)
                : "This validator has not voted; these delegators did"
            }
            tone={validatorVoted && rebels.length > 0 ? "warn" : "ok"}
          />
        </div>

        <div className="dd-section-label">Delegator votes</div>
        <div className="dd-list">
          {loading && !overrides && <div className="dd-empty">Fetching delegator votes...</div>}
          {!loading && rows.length === 0 && (
            <div className="dd-empty">
              None of this validator&apos;s delegators cast a direct vote on this proposal.
            </div>
          )}
          {rows.map((r) => (
            <div key={r.voterAddress} className={`dd-row ${r.rebelled ? "dd-row-rebel" : "dd-row-agree"}`}>
              <div className="dd-row-validator">
                <div className="dd-row-validator-text">
                  <span className="dd-row-name mono">{shorten(r.voterAddress)}</span>
                  <span className="dd-row-validator-vote">
                    Voted{" "}
                    <span className={`dd-vote dd-vote-${r.voteOption.toLowerCase()}`}>
                      {VOTE_LABEL[r.voteOption]}
                    </span>
                  </span>
                </div>
              </div>
              <div className="dd-row-stake">
                <span className="dd-row-stake-amount">{formatTxAmount(r.delegatedTX)} TX</span>
                <span className={`dd-row-tag ${r.rebelled ? "dd-row-tag-rebel" : "dd-row-tag-agree"}`}>
                  {r.rebelled ? "Rebelled" : validatorVoted ? "Agreed" : "Voted"}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="dd-fineprint">
          Only delegators who cast a direct vote appear here; a validator&apos;s silent
          delegators leave no vote record. Stake shown is what each voter delegates to{" "}
          <strong>this</strong> validator, at current bonded amounts.
        </div>
      </aside>
    </>
  );
}

function DdStat({
  label, value, sub, tone,
}: { label: string; value: string; sub: string; tone?: "ok" | "warn" }) {
  return (
    <div className={`dd-stat ${tone ? `dd-stat-${tone}` : ""}`}>
      <div className="dd-stat-label">{label}</div>
      <div className="dd-stat-value">{value}</div>
      <div className="dd-stat-sub">{sub}</div>
    </div>
  );
}

function shorten(s: string): string {
  if (!s) return "";
  if (s.length <= 18) return s;
  return `${s.slice(0, 12)}...${s.slice(-6)}`;
}
