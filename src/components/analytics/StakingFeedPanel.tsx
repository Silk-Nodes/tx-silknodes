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

// Per-event-type accent colour, used as a CSS dot rendered next to the
// rank pill. Replaces the old 🟢/🔴/🟡 emoji icons since the project
// no longer uses emojis in the UI.
const TYPE_DOT_COLOR: Record<StakingEvent["type"], string> = {
  delegate: "#4a7a1a",   // green — same as the row border on the feed
  undelegate: "#c45a4a", // red
  redelegate: "#e6a800", // amber
};

const AMOUNT_PREFIX: Record<StakingEvent["type"], string> = {
  delegate: "+",
  undelegate: "-",
  redelegate: "",
};

// Maps event type to a class that reuses the whale label pill color palette,
// so the "timestamp pill" in the header looks the same as the "Silk Nodes
// (self)" / "PSE Excluded" pills on DelegatorPanel.
const TYPE_PILL_CLASS: Record<StakingEvent["type"], string> = {
  delegate: "whale-label-validator", // green palette
  undelegate: "whale-label-cex", // amber/orange — repurposed for undel
  redelegate: "whale-label-pse-excluded", // neutral tan
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

// This component is a 1:1 structural mirror of DelegatorPanel. Same root
// classes, same header rhythm (3 rows: rank + prominent-mono-line +
// pill), same .delegator-panel-stat / -stat-sub, same section shells,
// same footer. The only differences are content-driven (an event has no
// stake-distribution bars to show, a delegator has no tx hash).
//
// DelegatorPanel equivalents:
//   .delegator-panel-rank       → icon + "DELEGATION"
//   .delegator-panel-address-row → prominent tx hash + copy
//   .delegator-panel-label      → timestamp rendered as a pill
//   .delegator-panel-stat       → big amount (neutral dark)
//   .delegator-panel-stat-sub   → raw TX count
//   .staking-panel-section × 2  → Parties, Transaction
//   .delegator-panel-footer     → View on Mintscan link
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

  const dotColor = TYPE_DOT_COLOR[event.type];
  const label = TYPE_LABELS[event.type];
  const prefix = AMOUNT_PREFIX[event.type];
  const pillClass = TYPE_PILL_CLASS[event.type];
  const validatorName = resolveValidator(event.validator, validators);
  const sourceName = event.sourceValidator ? resolveValidator(event.sourceValidator, validators) : null;

  return (
    <>
      <div className="staking-feed-panel-backdrop" onClick={onClose} />
      <div className="staking-feed-panel delegator-panel" role="dialog" aria-modal="true">
        <button type="button" className="staking-panel-close" onClick={onClose} aria-label="Close">
          ×
        </button>

        {/* ─── Header: 3 rows, mirrors DelegatorPanel exactly ─── */}
        <div className="delegator-panel-header">
          <div className="delegator-panel-rank">
            <span
              aria-hidden="true"
              style={{
                display: "inline-block",
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: dotColor,
                marginRight: 6,
                verticalAlign: "middle",
              }}
            />

            <span className="delegator-panel-rank-text">{label}</span>
          </div>
          {/* Row 2: prominent mono identifier — tx hash here, full address
              on the whale panel. Takes the same vertical space. */}
          <div className="delegator-panel-address-row">
            <a
              href={txExplorerUrl(event.txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="staking-panel-link staking-panel-mono delegator-panel-address"
              title="View transaction on Mintscan"
            >
              {event.txHash}
            </a>
            <CopyButton text={event.txHash} />
          </div>
          {/* Row 3: timestamp rendered as a label pill, matching the
              same pill style as the whale panel header label. */}
          <div className={`delegator-panel-label ${pillClass}`}>
            {formatFullTimestamp(event.timestamp)}
          </div>
        </div>

        {/* ─── Headline stat ─── */}
        <div className="delegator-panel-stat">
          {prefix}
          {formatEventAmount(event.amount)} TX
        </div>
        <div className="delegator-panel-stat-sub">
          {event.amount.toLocaleString()} TX · Block {event.height.toLocaleString()}
        </div>

        {/* ─── Section 1: Parties (delegator + validator) ─── */}
        <div className="staking-panel-section">
          <div className="staking-panel-label">Parties</div>
          <div className="staking-panel-value-row">
            <span className="staking-panel-mono staking-panel-sub">Delegator</span>
          </div>
          <div className="staking-panel-value-row">
            <span className="staking-panel-mono">{event.delegator}</span>
            <CopyButton text={event.delegator} />
          </div>

          {event.type === "redelegate" && sourceName ? (
            <>
              <div className="staking-panel-value-row" style={{ marginTop: 10 }}>
                <span className="staking-panel-mono staking-panel-sub">From Validator</span>
              </div>
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
              <div className="staking-panel-value-row" style={{ marginTop: 10 }}>
                <span className="staking-panel-mono staking-panel-sub">To Validator</span>
              </div>
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
            </>
          ) : (
            <>
              <div className="staking-panel-value-row" style={{ marginTop: 10 }}>
                <span className="staking-panel-mono staking-panel-sub">Validator</span>
              </div>
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
            </>
          )}
        </div>

        {/* ─── Footer: matches DelegatorPanel's "View on Mintscan ↗" exactly ─── */}
        <div className="delegator-panel-footer">
          <a
            href={txExplorerUrl(event.txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="staking-panel-link"
          >
            View on Mintscan ↗
          </a>
        </div>
      </div>
    </>
  );
}
