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
} from "@/lib/staking-events";
import StakingFeedRow from "./StakingFeedRow";
import StakingFeedPanel from "./StakingFeedPanel";

export default function StakingFeed() {
  const { events, validators, updatedAt, now } = useStakingFeed();
  const [activeTier, setActiveTier] = useState<FeedTier>("all");
  const [selectedEvent, setSelectedEvent] = useState<StakingEvent | null>(null);

  const filteredEvents = useMemo(() => filterByTier(events, activeTier), [events, activeTier]);

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
            <div className="staking-feed-empty-tier">No events in this tier</div>
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
          Showing {filteredEvents.length} of {events.length} events (last 30 days, 5,000+ TX)
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
