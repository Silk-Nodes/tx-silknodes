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

const TYPE_COLOR: Record<StakingEvent["type"], string> = {
  delegate: "#4a7a1a",
  undelegate: "#b44a3e",
  redelegate: "#d88a3a",
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
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

  const color = TYPE_COLOR[event.type];
  const validatorName = resolveValidator(event.validator, validators);
  const sourceName = event.sourceValidator ? resolveValidator(event.sourceValidator, validators) : null;

  return (
    <>
      <div className="staking-feed-panel-backdrop" onClick={onClose} />
      <div className="staking-feed-panel" role="dialog" aria-modal="true">
        <button type="button" className="staking-panel-close" onClick={onClose} aria-label="Close">
          ×
        </button>

        <div className="staking-panel-header">
          <span className="staking-panel-type" style={{ color }}>
            {TYPE_LABELS[event.type]}
          </span>
          <span className="staking-panel-timestamp">{formatFullTimestamp(event.timestamp)}</span>
        </div>

        <div className="staking-panel-amount" style={{ color }}>
          {event.type === "delegate" ? "+" : event.type === "undelegate" ? "-" : ""}
          {formatEventAmount(event.amount)} TX
        </div>
        <div className="staking-panel-amount-raw">{event.amount.toLocaleString()} TX</div>

        <div className="staking-panel-section">
          <div className="staking-panel-label">Delegator</div>
          <div className="staking-panel-value-row">
            <span className="staking-panel-mono">{event.delegator}</span>
            <CopyButton text={event.delegator} />
          </div>
        </div>

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

        <div className="staking-panel-section">
          <div className="staking-panel-label">Transaction Hash</div>
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
        </div>

        <div className="staking-panel-section">
          <div className="staking-panel-label">Block Height</div>
          <div className="staking-panel-mono">{event.height.toLocaleString()}</div>
        </div>
      </div>
    </>
  );
}
