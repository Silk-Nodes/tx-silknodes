"use client";

import { useEffect, useState } from "react";
import type { StakingEvent } from "@/lib/staking-events";
import {
  formatEventAmount,
  formatFullTimestamp,
  resolveValidator,
  txExplorerUrl,
  validatorUrl,
} from "@/lib/staking-events";

interface StakingFeedPanelProps {
  event: StakingEvent | null;
  validators: Record<string, string>;
  onClose: () => void;
}

const TYPE_LABELS: Record<StakingEvent["type"], string> = {
  delegate: "Delegation",
  undelegate: "Undelegation",
  redelegate: "Redelegation",
};

// Event type icons — colored dots that mirror the row-border color scheme
// used on the activity feed. Color lives here (plus the amount prefix)
// rather than on the header text or big stat, matching DelegatorPanel's
// restrained look where "RANK #N" and the big stake number stay neutral.
const TYPE_ICON: Record<StakingEvent["type"], string> = {
  delegate: "🟢",
  undelegate: "🔴",
  redelegate: "🟡",
};

const AMOUNT_PREFIX: Record<StakingEvent["type"], string> = {
  delegate: "+",
  undelegate: "-",
  redelegate: "",
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore clipboard permission errors
    }
  };

  return (
    <button
      type="button"
      className="staking-panel-copy"
      onClick={handleCopy}
      title="Copy to clipboard"
      aria-label="Copy"
    >
      {copied ? "✓" : "⧉"}
    </button>
  );
}

// Visual structure matches DelegatorPanel:
//   .delegator-panel-header  — icon + type label + timestamp (with border-bottom)
//   .delegator-panel-stat    — big formatted amount (colored by type)
//   .delegator-panel-stat-sub — raw TX count
//   .staking-panel-section × N — delegator, validator(s), tx hash, block
//   .delegator-panel-footer  — "View on Mintscan" link
export default function StakingFeedPanel({ event, validators, onClose }: StakingFeedPanelProps) {
  useEffect(() => {
    if (!event) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [event, onClose]);

  if (!event) return null;

  const icon = TYPE_ICON[event.type];
  const label = TYPE_LABELS[event.type];
  const prefix = AMOUNT_PREFIX[event.type];
  const validatorName = resolveValidator(event.validator, validators);
  const sourceName = event.sourceValidator ? resolveValidator(event.sourceValidator, validators) : null;

  return (
    <>
      <div className="staking-feed-panel-backdrop" onClick={onClose} />
      <div className="staking-feed-panel" role="dialog" aria-modal="true">
        <button type="button" className="staking-panel-close" onClick={onClose} aria-label="Close">
          ×
        </button>

        {/* ─── Header: icon + type + timestamp (matches DelegatorPanel rhythm) ─── */}
        {/* Header label stays neutral grey like "RANK #2" in the whale panel —
            the colored circle icon carries the type signal on its own,
            matching DelegatorPanel's restraint (color lives in the icon +
            amount-prefix, not in the header text). */}
        <div className="delegator-panel-header">
          <div className="delegator-panel-rank">
            <span className="delegator-panel-rank-icon">{icon}</span>
            <span className="delegator-panel-rank-text">{label}</span>
          </div>
          <div className="staking-panel-timestamp">{formatFullTimestamp(event.timestamp)}</div>
        </div>

        {/* ─── Headline stat ─── */}
        {/* Big number is neutral dark (same as the whale panel's "63.11M TX")
            so both panels share the same "big stat" visual. The prefix
            (+/-/) + the icon already convey the type. */}
        <div className="delegator-panel-stat">
          {prefix}
          {formatEventAmount(event.amount)} TX
        </div>
        <div className="delegator-panel-stat-sub">{event.amount.toLocaleString()} TX</div>

        {/* ─── Delegator ─── */}
        <div className="staking-panel-section">
          <div className="staking-panel-label">Delegator</div>
          <div className="staking-panel-value-row">
            <span className="staking-panel-mono">{event.delegator}</span>
            <CopyButton text={event.delegator} />
          </div>
        </div>

        {/* ─── Validator(s) ─── */}
        {event.type === "redelegate" && sourceName ? (
          <>
            <div className="staking-panel-section">
              <div className="staking-panel-label">From Validator</div>
              <div className="staking-panel-value-row">
                <a
                  href={validatorUrl(event.sourceValidator!)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="staking-panel-link"
                >
                  {sourceName} ↗
                </a>
              </div>
              <div className="staking-panel-value-row">
                <span className="staking-panel-mono staking-panel-sub">{event.sourceValidator}</span>
                <CopyButton text={event.sourceValidator!} />
              </div>
            </div>
            <div className="staking-panel-section">
              <div className="staking-panel-label">To Validator</div>
              <div className="staking-panel-value-row">
                <a
                  href={validatorUrl(event.validator)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="staking-panel-link"
                >
                  {validatorName} ↗
                </a>
              </div>
              <div className="staking-panel-value-row">
                <span className="staking-panel-mono staking-panel-sub">{event.validator}</span>
                <CopyButton text={event.validator} />
              </div>
            </div>
          </>
        ) : (
          <div className="staking-panel-section">
            <div className="staking-panel-label">Validator</div>
            <div className="staking-panel-value-row">
              <a
                href={validatorUrl(event.validator)}
                target="_blank"
                rel="noopener noreferrer"
                className="staking-panel-link"
              >
                {validatorName} ↗
              </a>
            </div>
            <div className="staking-panel-value-row">
              <span className="staking-panel-mono staking-panel-sub">{event.validator}</span>
              <CopyButton text={event.validator} />
            </div>
          </div>
        )}

        {/* ─── Transaction Details (tx hash + block height combined) ─── */}
        {/* Combined to reduce vertical density — whale panel shows only 2
            body sections, we now show 3 (delegator, validator, tx details)
            instead of the previous 4. Block height sits as a small
            sub-line since it's a technical detail, not headline info. */}
        <div className="staking-panel-section">
          <div className="staking-panel-label">Transaction</div>
          <div className="staking-panel-value-row">
            <a
              href={txExplorerUrl(event.txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="staking-panel-link staking-panel-mono"
            >
              {event.txHash.slice(0, 20)}... ↗
            </a>
            <CopyButton text={event.txHash} />
          </div>
          <div className="staking-panel-value-row">
            <span className="staking-panel-mono staking-panel-sub">
              Block {event.height.toLocaleString()}
            </span>
          </div>
        </div>

        {/* ─── Footer: View on Mintscan (matches DelegatorPanel) ─── */}
        <div className="delegator-panel-footer">
          <a
            href={txExplorerUrl(event.txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="staking-panel-link"
          >
            View transaction on Mintscan ↗
          </a>
        </div>
      </div>
    </>
  );
}
