"use client";

import type { StakingEvent } from "@/lib/staking-events";
import {
  formatEventAmount,
  formatEventTime,
  formatRelativeTime,
  truncateAddress,
  isWhaleEvent,
  resolveValidator,
} from "@/lib/staking-events";

interface StakingFeedRowProps {
  event: StakingEvent;
  validators: Record<string, string>;
  now: number;
  onClick: (event: StakingEvent) => void;
}

const TYPE_LABELS: Record<StakingEvent["type"], string> = {
  delegate: "DELEGATE",
  undelegate: "UNDELEGATE",
  redelegate: "REDELEGATE",
};

const AMOUNT_PREFIX: Record<StakingEvent["type"], string> = {
  delegate: "+",
  undelegate: "-",
  redelegate: "",
};

export default function StakingFeedRow({ event, validators, now, onClick }: StakingFeedRowProps) {
  const whale = isWhaleEvent(event);
  const validatorName = resolveValidator(event.validator, validators);
  const sourceName = event.sourceValidator ? resolveValidator(event.sourceValidator, validators) : null;

  return (
    <div
      className={`staking-feed-row type-${event.type} ${whale ? "whale" : ""}`}
      onClick={() => onClick(event)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(event);
        }
      }}
    >
      <span className="staking-feed-row-time">{formatEventTime(event.timestamp)}</span>
      <span className={`staking-feed-row-type type-${event.type}`}>{TYPE_LABELS[event.type]}</span>
      <span className="staking-feed-row-amount">
        {AMOUNT_PREFIX[event.type]}
        {formatEventAmount(event.amount)} TX
      </span>
      <span className="staking-feed-row-parties">
        <span className="staking-feed-row-delegator">{truncateAddress(event.delegator)}</span>
        <span className="staking-feed-row-arrow">
          {event.type === "redelegate" && sourceName ? ` ${sourceName} → ` : " → "}
        </span>
        <span className="staking-feed-row-validator">{validatorName}</span>
      </span>
      <span className="staking-feed-row-ago">{formatRelativeTime(event.timestamp, now)}</span>
    </div>
  );
}
