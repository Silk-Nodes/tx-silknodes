"use client";

import { useMemo, useState } from "react";
import { useStakingFeed } from "@/hooks/useStakingFeed";
import {
  FEED_TIERS,
  TIER_LABELS,
  filterByTier,
  formatRelativeTime,
  type FeedTier,
  type StakingEvent,
  type StakingEventType,
} from "@/lib/staking-events";
import StakingFeedRow from "./StakingFeedRow";
import StakingFeedPanel from "./StakingFeedPanel";

const TYPE_FILTERS: { type: StakingEventType; label: string; color: string }[] = [
  { type: "delegate", label: "Delegations", color: "#4a7a1a" },
  { type: "undelegate", label: "Undelegations", color: "#b44a3e" },
  { type: "redelegate", label: "Redelegations", color: "#d88a3a" },
];

const ALL_TYPES: ReadonlySet<StakingEventType> = new Set<StakingEventType>([
  "delegate",
  "undelegate",
  "redelegate",
]);

export default function StakingFeed() {
  const { events, validators, updatedAt, now } = useStakingFeed();
  const [activeTier, setActiveTier] = useState<FeedTier>("all");
  const [activeTypes, setActiveTypes] = useState<Set<StakingEventType>>(() => new Set(ALL_TYPES));
  const [selectedEvent, setSelectedEvent] = useState<StakingEvent | null>(null);

  const filteredEvents = useMemo(() => {
    const byTier = filterByTier(events, activeTier);
    return byTier.filter((e) => activeTypes.has(e.type));
  }, [events, activeTier, activeTypes]);

  const toggleType = (type: StakingEventType) => {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        // Don't let the user disable every type (would show empty state with no way back)
        if (next.size === 1) return prev;
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  if (events.length === 0) {
    return (
      <div className="chart-card-v2 staking-feed-card">
        <div className="staking-feed-empty">Waiting for staking activity...</div>
      </div>
    );
  }

  return (
    <>
      <div className="chart-card-v2 staking-feed-card">
        <div className="staking-feed-header">
          <div className="staking-feed-title-group">
            <span className="chart-card-v2-title">Staking Activity</span>
            <span className="live-pulse-small" title="Live" />
            <span className="staking-feed-count">{filteredEvents.length} events</span>
          </div>
          <span className="staking-feed-updated">Updated {formatRelativeTime(updatedAt, now)}</span>
        </div>

        <div className="staking-feed-type-filter" role="group" aria-label="Filter by event type">
          {TYPE_FILTERS.map(({ type, label, color }) => {
            const active = activeTypes.has(type);
            return (
              <button
                key={type}
                type="button"
                className={`staking-type-chip ${active ? "active" : ""}`}
                onClick={() => toggleType(type)}
                aria-pressed={active}
                title={active ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
              >
                <span
                  className="staking-type-chip-dot"
                  style={{ background: active ? color : "transparent", borderColor: color }}
                />
                <span className="staking-type-chip-label">{label}</span>
              </button>
            );
          })}
        </div>

        <div className="staking-feed-tiers">
          {FEED_TIERS.map((tier) => (
            <button
              key={tier}
              className={`time-pill ${activeTier === tier ? "active" : ""}`}
              onClick={() => setActiveTier(tier)}
            >
              {TIER_LABELS[tier]}
            </button>
          ))}
        </div>

        <div className="staking-feed-container">
          {filteredEvents.length === 0 ? (
            <div className="staking-feed-empty-tier">No events match these filters</div>
          ) : (
            filteredEvents.map((event) => (
              <StakingFeedRow
                key={event.txHash + event.type + event.height}
                event={event}
                validators={validators}
                now={now}
                onClick={setSelectedEvent}
              />
            ))
          )}
        </div>

        <div className="staking-feed-footer">
          Showing {filteredEvents.length} of {events.length} events (last 3 months, 5,000+ TX)
        </div>
      </div>

      <StakingFeedPanel
        event={selectedEvent}
        validators={validators}
        onClose={() => setSelectedEvent(null)}
      />
    </>
  );
}
