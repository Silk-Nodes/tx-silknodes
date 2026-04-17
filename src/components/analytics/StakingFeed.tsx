"use client";

import { useEffect, useMemo, useState } from "react";
import { useStakingFeed } from "@/hooks/useStakingFeed";
import { useWhaleData } from "@/hooks/useWhaleData";
import {
  FEED_TIERS,
  TIER_LABELS,
  filterByTier,
  formatRelativeTime,
  isWhaleEvent,
  type FeedTier,
  type StakingEvent,
  type StakingEventType,
} from "@/lib/staking-events";
import StakingFeedRow from "./StakingFeedRow";
import StakingFeedPanel from "./StakingFeedPanel";
import WhaleTracker from "./WhaleTracker";
import DelegatorPanel from "./DelegatorPanel";
import type { TopDelegatorEntry } from "@/hooks/useWhaleData";

type ActiveTab = "activity" | "whales";

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

// Kept the file name (StakingFeed) to avoid breaking the import in
// AnalyticsTab, but the card now presents itself as "Network Activity"
// with two tabs: Staking Activity (original feed) and Whale Tracker
// (ranked top delegators + recent ≥1M TX moves).
export default function StakingFeed() {
  const { events, validators, updatedAt, now, isStale, fetchError } = useStakingFeed();
  const { topDelegators } = useWhaleData();

  const [activeTab, setActiveTab] = useState<ActiveTab>("activity");
  const [activeTier, setActiveTier] = useState<FeedTier>("all");
  const [activeTypes, setActiveTypes] = useState<Set<StakingEventType>>(() => new Set(ALL_TYPES));
  const [selectedEvent, setSelectedEvent] = useState<StakingEvent | null>(null);
  // Selected delegator state is LIFTED here from WhaleTracker. Why? The
  // parent <div className="chart-card-v2"> has `backdrop-filter: blur(20px)`
  // which creates a new containing block for `position: fixed` descendants.
  // That means any panel rendered INSIDE the card gets clipped to the
  // card's bounds instead of the viewport. DelegatorPanel must be a
  // sibling of the card (not nested) to render as a full-viewport overlay
  // — same pattern we already use for StakingFeedPanel.
  const [selectedDelegator, setSelectedDelegator] = useState<TopDelegatorEntry | null>(null);

  // Sync tab with URL hash so people can link to #whales directly.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash.replace("#", "");
    if (hash === "whales") setActiveTab("whales");
    const onHashChange = () => {
      const h = window.location.hash.replace("#", "");
      if (h === "whales") setActiveTab("whales");
      else if (h === "activity") setActiveTab("activity");
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const setTab = (tab: ActiveTab) => {
    setActiveTab(tab);
    if (typeof window !== "undefined") {
      // Write the hash without triggering a scroll jump.
      const newHash = tab === "whales" ? "#whales" : "";
      if (window.location.hash !== newHash) {
        history.replaceState(null, "", newHash || window.location.pathname + window.location.search);
      }
    }
  };

  const filteredEvents = useMemo(() => {
    const byTier = filterByTier(events, activeTier);
    return byTier.filter((e) => activeTypes.has(e.type));
  }, [events, activeTier, activeTypes]);

  const whaleMoveCount = useMemo(() => events.filter(isWhaleEvent).length, [events]);

  const toggleType = (type: StakingEventType) => {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
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
            <span className="chart-card-v2-title">Network Activity</span>
            <span className="live-pulse-small" title="Live" />
          </div>
          <span className="staking-feed-updated">Updated {formatRelativeTime(updatedAt, now)}</span>
        </div>

        {(isStale || fetchError) && (
          <div className="staking-feed-stale-banner" role="status">
            <span className="staking-feed-stale-icon">⚠️</span>
            <span>
              {fetchError
                ? "Cannot reach the feed. Retrying every minute..."
                : `Feed appears stale. Last update was ${formatRelativeTime(updatedAt, now)}.`}
            </span>
          </div>
        )}

        {/* ─── Tabs ─── */}
        <div className="network-activity-tabs" role="tablist" aria-label="Network activity views">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "activity"}
            className={`network-activity-tab ${activeTab === "activity" ? "active" : ""}`}
            onClick={() => setTab("activity")}
          >
            Staking Activity
            <span className="network-activity-tab-count">{filteredEvents.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "whales"}
            className={`network-activity-tab ${activeTab === "whales" ? "active" : ""}`}
            onClick={() => setTab("whales")}
          >
            Whale Tracker
            <span className="network-activity-tab-count">
              {topDelegators.entries.length || whaleMoveCount}
            </span>
          </button>
        </div>

        {/* ─── Body: activity or whales ─── */}
        {activeTab === "activity" ? (
          <>
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
          </>
        ) : (
          <WhaleTracker
            topDelegators={topDelegators.entries}
            events={events}
            validators={validators}
            now={now}
            onEventClick={setSelectedEvent}
            onDelegatorClick={setSelectedDelegator}
          />
        )}
      </div>

      {/* Both panels are siblings of the card so their `position: fixed`
          escapes the card's backdrop-filter stacking context and fills
          the viewport identically. */}
      <StakingFeedPanel
        event={selectedEvent}
        validators={validators}
        onClose={() => setSelectedEvent(null)}
      />
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
