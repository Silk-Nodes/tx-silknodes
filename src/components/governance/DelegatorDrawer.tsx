"use client";

import { useEffect } from "react";
import type { ValidatorVote, VoteOption } from "@/hooks/useProposalDetail";
import type { OverrideEnrichment } from "@/hooks/useProposalOverrides";
import { formatTxAmount } from "@/lib/governance";

interface Props {
  override: OverrideEnrichment | null;
  validators: ValidatorVote[];
  onClose: () => void;
}

const VOTE_LABEL: Record<string, string> = {
  YES: "Yes",
  NO: "No",
  ABSTAIN: "Abstain",
  NO_WITH_VETO: "Veto",
  DID_NOT_VOTE: "Did not vote",
};

// Slide-in side panel showing one delegator's full override story:
// which validators they delegate to, how each validator voted, whether
// the delegator's direct vote rebelled against that validator. Closes on
// Escape, backdrop click, or the X button.
export default function DelegatorDrawer({ override, validators, onClose }: Props) {
  const open = !!override;

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Lock body scroll while open so the page behind doesn't jump on
  // mobile when the drawer is the focus. We restore on unmount/close.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!override) return null;

  // Build a quick lookup from operator address to validator vote data so
  // we can show the delegator's validator's vote next to each delegation.
  const validatorByOp = new Map(
    validators.map((v) => [v.operatorAddress.toLowerCase(), v]),
  );

  // Enrich + sort delegations: largest first, rebels grouped at top.
  const rows = override.delegations
    .map((d) => {
      const v = validatorByOp.get(d.operatorAddress.toLowerCase());
      const validatorVote: VoteOption = v?.voteOption ?? "DID_NOT_VOTE";
      const rebelled = validatorVote !== "DID_NOT_VOTE" && validatorVote !== override.voteOption;
      return {
        ...d,
        moniker: v?.moniker ?? d.operatorAddress.slice(0, 12),
        avatarUrl: v?.avatarUrl ?? null,
        validatorVote,
        rebelled,
      };
    })
    .sort((a, b) => {
      if (a.rebelled !== b.rebelled) return a.rebelled ? -1 : 1;
      return b.delegatedTX - a.delegatedTX;
    });

  const rebelStake = rows.filter((r) => r.rebelled).reduce((s, r) => s + r.delegatedTX, 0);
  const agreedStake = rows.filter((r) => !r.rebelled).reduce((s, r) => s + r.delegatedTX, 0);
  const rebelCount = rows.filter((r) => r.rebelled).length;

  return (
    <>
      {/* Backdrop */}
      <div
        className="delegator-drawer-backdrop"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <aside
        className="delegator-drawer"
        role="dialog"
        aria-label={`Override detail for ${shorten(override.voterAddress)}`}
      >
        <header className="dd-head">
          <div className="dd-head-eyebrow">DELEGATOR OVERRIDE</div>
          <div className="dd-head-row">
            <div className="dd-head-addr">
              <span className="mono">{shorten(override.voterAddress)}</span>
              <button
                type="button"
                className="dd-copy"
                title="Copy address"
                onClick={() => navigator.clipboard?.writeText(override.voterAddress)}
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
            <span className={`vvt-vote-badge vvt-vote-${override.voteOption.toLowerCase()}`}>
              {VOTE_LABEL[override.voteOption]}
            </span>{" "}
            on {new Date(override.votedAt).toLocaleString()}
          </div>
        </header>

        <div className="dd-summary">
          <DdStat
            label="Voting power"
            value={`${formatTxAmount(override.bondedTotalTX)} TX`}
            sub="Current bonded across all validators"
          />
          <DdStat
            label="Rebelled against"
            value={
              rebelCount === 0
                ? "None"
                : `${rebelCount} of ${rows.length}`
            }
            sub={rebelCount === 0
              ? "Voted in line with validators"
              : `${formatTxAmount(rebelStake)} TX moved against validators`}
            tone={rebelCount > 0 ? "warn" : "ok"}
          />
        </div>

        <div className="dd-section-label">Delegation breakdown</div>
        <div className="dd-list">
          {rows.length === 0 && (
            <div className="dd-empty">
              No active delegations found for this address. They may have unbonded after voting.
            </div>
          )}
          {rows.map((r) => (
            <div key={r.operatorAddress} className={`dd-row ${r.rebelled ? "dd-row-rebel" : "dd-row-agree"}`}>
              <div className="dd-row-validator">
                {r.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.avatarUrl} alt="" className="dd-avatar" />
                ) : (
                  <span className="dd-avatar dd-avatar-fallback">
                    {r.moniker.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <div className="dd-row-validator-text">
                  <span className="dd-row-name">{r.moniker}</span>
                  <span className="dd-row-validator-vote">
                    Voted{" "}
                    <span className={`dd-vote dd-vote-${r.validatorVote.toLowerCase()}`}>
                      {VOTE_LABEL[r.validatorVote]}
                    </span>
                  </span>
                </div>
              </div>
              <div className="dd-row-stake">
                <span className="dd-row-stake-amount">{formatTxAmount(r.delegatedTX)} TX</span>
                <span className={`dd-row-tag ${r.rebelled ? "dd-row-tag-rebel" : "dd-row-tag-agree"}`}>
                  {r.rebelled ? "Rebelled" : "Agreed"}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="dd-fineprint">
          Voting power shown is the delegator&apos;s <strong>current</strong> bonded stake.
          The on-chain vote actually counted the stake snapshotted at vote time, which may
          differ if the delegator added or removed delegations since.
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
