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
import type {
  TopDelegatorEntry,
  TopDelegatorLabel,
  WhaleChangesPayload,
} from "@/hooks/useWhaleData";

interface WhaleTrackerProps {
  topDelegators: TopDelegatorEntry[];
  whaleChanges: WhaleChangesPayload;
  events: StakingEvent[];
  validators: Record<string, string>;
  now: number;
  onEventClick: (e: StakingEvent) => void;
  /**
   * Row click handler — lifted to the parent (StakingFeed) so the
   * DelegatorPanel overlay can render at the top level, OUTSIDE the
   * ancestor `.chart-card-v2` whose `backdrop-filter` would otherwise
   * trap the panel's `position: fixed` inside the card bounds.
   */
  onDelegatorClick: (entry: TopDelegatorEntry) => void;
  /**
   * Optional: open the delegator panel by address alone (used by the
   * "Whales on the Move" section where we only have an address + label,
   * not a full TopDelegatorEntry — we synthesize a minimal entry so
   * the panel can still render correctly).
   */
  onAddressClick: (address: string, label: TopDelegatorLabel | null, stake: number, rank: number) => void;
}

const PAGE_SIZE = 10;
const WINDOW_SIZE = 1; // pages shown on either side of current before ellipsis
const MOVERS_PER_LIST = 5; // how many rows per mover sub-list in "Whales on the Move"

// Build a compact page list like [0, "…", 5, 6, 7, "…", 49]. Keeps the
// pager to ~7-9 buttons regardless of total page count.
function buildPageList(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i);
  const pages: (number | "…")[] = [];
  const firstRange = Math.max(0, current - WINDOW_SIZE);
  const lastRange = Math.min(total - 1, current + WINDOW_SIZE);

  pages.push(0);
  if (firstRange > 1) pages.push("…");
  for (let i = Math.max(1, firstRange); i <= Math.min(total - 2, lastRange); i++) {
    pages.push(i);
  }
  if (lastRange < total - 2) pages.push("…");
  pages.push(total - 1);
  return pages;
}

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
  whaleChanges,
  events,
  validators,
  now,
  onEventClick,
  onDelegatorClick,
  onAddressClick,
}: WhaleTrackerProps) {
  const [page, setPage] = useState(0);

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
                onClick={() => onDelegatorClick(entry)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onDelegatorClick(entry);
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
            {/* Smart ellipsis pagination: with up to 50 pages we can't render
                all of them. Show first + last + a sliding window around current.
                Ellipsis fills the gaps. */}
            {buildPageList(clampedPage, totalPages).map((item, idx) =>
              item === "…" ? (
                <span key={`gap-${idx}`} className="whale-pager-gap" aria-hidden="true">…</span>
              ) : (
                <button
                  key={item}
                  type="button"
                  className={`whale-pager-btn ${item === clampedPage ? "active" : ""}`}
                  onClick={() => setPage(item)}
                  aria-current={item === clampedPage ? "page" : undefined}
                  aria-label={`Go to page ${item + 1}`}
                >
                  {item + 1}
                </button>
              ),
            )}
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

      {/* ─── Section B: Whales on the Move ─── */}
      {/* Diff between the current 6h refresh and the previous one. Shows up
          to MOVERS_PER_LIST items per category so the section stays compact
          even when there are many changes. Each card clicks through to the
          delegator panel for that address. */}
      {(() => {
        const { arrivals, exits, rankMovers, stakeMovers } = whaleChanges;
        const hasAny =
          arrivals.length + exits.length + rankMovers.length + stakeMovers.length > 0;
        if (!hasAny) return null;

        return (
          <div className="whale-section">
            <div className="whale-section-header">
              <span className="whale-section-title">Whales on the Move</span>
              <span className="whale-section-sub">since last 6 h refresh</span>
            </div>
            <div className="whale-movers-grid">
              {rankMovers.length > 0 && (
                <div className="whale-movers-card">
                  <div className="whale-movers-card-title">
                    🚀 Rank Movers <span className="whale-movers-count">{rankMovers.length}</span>
                  </div>
                  {rankMovers.slice(0, MOVERS_PER_LIST).map((m) => {
                    const up = m.rankDelta > 0;
                    return (
                      <div
                        key={m.address}
                        className="whale-movers-row"
                        role="button"
                        tabIndex={0}
                        onClick={() => onAddressClick(m.address, m.label, m.totalStake, m.currentRank)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onAddressClick(m.address, m.label, m.totalStake, m.currentRank);
                          }
                        }}
                      >
                        <span className="whale-movers-addr">
                          {m.label?.text ?? truncateAddress(m.address, 8, 6)}
                        </span>
                        <span className={`whale-movers-delta ${up ? "up" : "down"}`}>
                          {up ? "↑" : "↓"} {Math.abs(m.rankDelta)}
                        </span>
                        <span className="whale-movers-rank">
                          #{m.previousRank} → #{m.currentRank}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {stakeMovers.length > 0 && (
                <div className="whale-movers-card">
                  <div className="whale-movers-card-title">
                    💰 Stake Movers <span className="whale-movers-count">{stakeMovers.length}</span>
                  </div>
                  {stakeMovers.slice(0, MOVERS_PER_LIST).map((m) => {
                    const up = m.stakeDelta > 0;
                    return (
                      <div
                        key={m.address}
                        className="whale-movers-row"
                        role="button"
                        tabIndex={0}
                        onClick={() => onAddressClick(m.address, m.label, m.currentStake, m.currentRank)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onAddressClick(m.address, m.label, m.currentStake, m.currentRank);
                          }
                        }}
                      >
                        <span className="whale-movers-addr">
                          {m.label?.text ?? truncateAddress(m.address, 8, 6)}
                        </span>
                        <span className={`whale-movers-delta ${up ? "up" : "down"}`}>
                          {up ? "+" : "−"}{formatEventAmount(Math.abs(m.stakeDelta))} TX
                        </span>
                        <span className="whale-movers-rank">#{m.currentRank}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {arrivals.length > 0 && (
                <div className="whale-movers-card">
                  <div className="whale-movers-card-title">
                    🆕 New Arrivals <span className="whale-movers-count">{arrivals.length}</span>
                  </div>
                  {arrivals.slice(0, MOVERS_PER_LIST).map((a) => (
                    <div
                      key={a.address}
                      className="whale-movers-row"
                      role="button"
                      tabIndex={0}
                      onClick={() => onAddressClick(a.address, a.label, a.totalStake, a.rank)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onAddressClick(a.address, a.label, a.totalStake, a.rank);
                        }
                      }}
                    >
                      <span className="whale-movers-addr">
                        {a.label?.text ?? truncateAddress(a.address, 8, 6)}
                      </span>
                      <span className="whale-movers-delta up">
                        {formatEventAmount(a.totalStake)} TX
                      </span>
                      <span className="whale-movers-rank">#{a.rank}</span>
                    </div>
                  ))}
                </div>
              )}

              {exits.length > 0 && (
                <div className="whale-movers-card">
                  <div className="whale-movers-card-title">
                    👋 Exits <span className="whale-movers-count">{exits.length}</span>
                  </div>
                  {exits.slice(0, MOVERS_PER_LIST).map((x) => (
                    <div
                      key={x.address}
                      className="whale-movers-row"
                      role="button"
                      tabIndex={0}
                      onClick={() => onAddressClick(x.address, x.label, x.lastStake, x.lastRank)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onAddressClick(x.address, x.label, x.lastStake, x.lastRank);
                        }
                      }}
                    >
                      <span className="whale-movers-addr">
                        {x.label?.text ?? truncateAddress(x.address, 8, 6)}
                      </span>
                      <span className="whale-movers-delta down">
                        was {formatEventAmount(x.lastStake)} TX
                      </span>
                      <span className="whale-movers-rank">was #{x.lastRank}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ─── Section C: Recent Whale Moves ─── */}
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
  );
}
