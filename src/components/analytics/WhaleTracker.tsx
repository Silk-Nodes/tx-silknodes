"use client";

import { useMemo, useState } from "react";
import type { StakingEvent } from "@/lib/staking-events";
import {
  formatEventAmount,
  formatEventTime,
  formatRelativeTime,
  truncateAddress,
  resolveValidator,
  isWhaleEvent,
} from "@/lib/staking-events";
import type { TopDelegatorEntry, TopDelegatorLabel } from "@/hooks/useWhaleData";
import DelegatorPanel from "./DelegatorPanel";

interface WhaleTrackerProps {
  topDelegators: TopDelegatorEntry[];
  events: StakingEvent[];
  validators: Record<string, string>;
  now: number;
  onEventClick: (e: StakingEvent) => void;
}

const PAGE_SIZE = 10;

// Type → display prefix. We show labels as concise tokens so the rank row
// stays scannable even with long monikers.
function labelIcon(type: string | undefined): string {
  if (!type) return "🐋";
  if (type.startsWith("validator")) return "🏛";
  if (type === "pse-excluded" || type === "validator+pse") return "⚙️";
  if (type === "cex") return "🏦";
  if (type === "individual") return "👤";
  return "🐋";
}

function LabelBadge({ label }: { label: TopDelegatorLabel | null }) {
  if (!label) {
    return <span className="whale-label whale-label-unlabeled">🐋 unlabeled</span>;
  }
  return (
    <span className={`whale-label whale-label-${label.type.replace("+", "-")}`} title={label.text}>
      <span className="whale-label-icon">{labelIcon(label.type)}</span>
      <span className="whale-label-text">{label.text}</span>
    </span>
  );
}

export default function WhaleTracker({
  topDelegators,
  events,
  validators,
  now,
  onEventClick,
}: WhaleTrackerProps) {
  const [page, setPage] = useState(0);
  const [selectedDelegator, setSelectedDelegator] = useState<TopDelegatorEntry | null>(null);

  const totalPages = Math.max(1, Math.ceil(topDelegators.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages - 1);
  const pageEntries = topDelegators.slice(clampedPage * PAGE_SIZE, (clampedPage + 1) * PAGE_SIZE);

  // Recent whale moves: filter staking events to ≥ 1M TX threshold. The
  // `isWhaleEvent` helper lives in lib/staking-events.ts so we stay aligned
  // with whatever whale threshold the rest of the UI uses.
  const whaleMoves = useMemo(
    () => events.filter(isWhaleEvent).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    [events],
  );

  // Total bonded stake across top-N (for the % of network column). If the
  // file is empty we show nothing to avoid divide-by-zero nonsense.
  const topTotalTX = topDelegators.reduce((sum, e) => sum + e.totalStake, 0);

  if (topDelegators.length === 0) {
    return (
      <div className="whale-empty">
        <div className="whale-empty-icon">🐋</div>
        <div className="whale-empty-text">Top delegators data is not available yet.</div>
        <div className="whale-empty-sub">
          The VM refreshes this every 6 hours. First write happens on the next collector restart.
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="whale-tracker">
      {/* ─── Section A: Top Delegators ─── */}
      <div className="whale-section">
        <div className="whale-section-header">
          <span className="whale-section-title">Top Delegators</span>
          <span className="whale-section-sub">{topDelegators.length} ranked</span>
        </div>

        <div className="whale-table">
          <div className="whale-table-head">
            <span className="whale-col-rank">#</span>
            <span className="whale-col-addr">Address</span>
            <span className="whale-col-label">Label</span>
            <span className="whale-col-stake">Stake</span>
            <span className="whale-col-pct">% of top</span>
            <span className="whale-col-vals">Validators</span>
          </div>

          {pageEntries.map((entry) => {
            const pct = topTotalTX > 0 ? (entry.totalStake / topTotalTX) * 100 : 0;
            // Whole row is a button that opens the side panel. Keyboard
            // users get Enter/Space; screen readers announce as button with
            // address text as its accessible name.
            return (
              <div
                key={entry.address}
                className="whale-table-row whale-table-row-clickable"
                role="button"
                tabIndex={0}
                onClick={() => setSelectedDelegator(entry)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedDelegator(entry);
                  }
                }}
                aria-label={`Open details for ${entry.label?.text || "unlabeled address"} ${entry.address}`}
                title={entry.address}
              >
                <span className="whale-col-rank">#{entry.rank}</span>
                <span className="whale-col-addr">{truncateAddress(entry.address, 10, 6)}</span>
                <span className="whale-col-label">
                  <LabelBadge label={entry.label} />
                </span>
                <span className="whale-col-stake">{formatEventAmount(entry.totalStake)} TX</span>
                <span className="whale-col-pct">{pct.toFixed(2)}%</span>
                <span className="whale-col-vals">{entry.validatorCount}</span>
              </div>
            );
          })}
        </div>

        {totalPages > 1 && (
          <div className="whale-pager" role="navigation" aria-label="Top delegators pagination">
            <button
              type="button"
              className="whale-pager-btn"
              disabled={clampedPage === 0}
              onClick={() => setPage(clampedPage - 1)}
              aria-label="Previous page"
            >
              «
            </button>
            {Array.from({ length: totalPages }).map((_, i) => (
              <button
                key={i}
                type="button"
                className={`whale-pager-btn ${i === clampedPage ? "active" : ""}`}
                onClick={() => setPage(i)}
                aria-current={i === clampedPage ? "page" : undefined}
              >
                {i + 1}
              </button>
            ))}
            <button
              type="button"
              className="whale-pager-btn"
              disabled={clampedPage >= totalPages - 1}
              onClick={() => setPage(clampedPage + 1)}
              aria-label="Next page"
            >
              »
            </button>
          </div>
        )}
      </div>

      {/* ─── Section B: Recent Whale Moves ─── */}
      <div className="whale-section">
        <div className="whale-section-header">
          <span className="whale-section-title">Recent Whale Moves</span>
          <span className="whale-section-sub">≥ 1M TX · {whaleMoves.length} in last 3 months</span>
        </div>

        {whaleMoves.length === 0 ? (
          <div className="whale-empty-sub whale-empty-moves">
            No 1M+ staking moves in the current window.
          </div>
        ) : (
          <div className="whale-moves">
            {whaleMoves.slice(0, 15).map((event) => {
              const prefix =
                event.type === "delegate" ? "+" : event.type === "undelegate" ? "-" : "";
              const validatorName = resolveValidator(event.validator, validators);
              const sourceName = event.sourceValidator
                ? resolveValidator(event.sourceValidator, validators)
                : null;
              return (
                <div
                  key={event.txHash + event.type + event.height}
                  className={`whale-move whale-move-${event.type}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onEventClick(event)}
                  onKeyDown={(k) => {
                    if (k.key === "Enter" || k.key === " ") {
                      k.preventDefault();
                      onEventClick(event);
                    }
                  }}
                >
                  <span className="whale-move-time">{formatEventTime(event.timestamp)}</span>
                  <span className={`whale-move-type type-${event.type}`}>
                    {event.type.toUpperCase()}
                  </span>
                  <span className="whale-move-amount">
                    {prefix}
                    {formatEventAmount(event.amount)} TX
                  </span>
                  <span className="whale-move-parties">
                    {truncateAddress(event.delegator)}
                    <span className="whale-move-arrow">
                      {event.type === "redelegate" && sourceName ? ` ${sourceName} → ` : " → "}
                    </span>
                    {validatorName}
                  </span>
                  <span className="whale-move-ago">
                    {formatRelativeTime(event.timestamp, now)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>

    <DelegatorPanel
      entry={selectedDelegator}
      events={events}
      validators={validators}
      now={now}
      onClose={() => setSelectedDelegator(null)}
    />
    </>
  );
}
