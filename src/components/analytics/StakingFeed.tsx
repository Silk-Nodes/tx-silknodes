"use client";

import { useEffect, useMemo, useState } from "react";
import { useStakingFeed } from "@/hooks/useStakingFeed";
import { useWhaleData } from "@/hooks/useWhaleData";
import {
  FEED_TIERS,
  TIER_LABELS,
  filterByTiers,
  computeNetStakeFlow,
  formatRelativeTime,
  isWhaleEvent,
  type FeedTier,
  type StakingEvent,
  type StakingEventType,
} from "@/lib/staking-events";
import { formatLargeNumber } from "@/lib/analytics-utils";
import StakingFeedRow from "./StakingFeedRow";
import StakingFeedPanel from "./StakingFeedPanel";
import WhaleTracker from "./WhaleTracker";
import DelegatorPanel from "./DelegatorPanel";
import type { TopDelegatorEntry } from "@/hooks/useWhaleData";

type ActiveTab = "activity" | "whales";

const TYPE_FILTERS: { type: StakingEventType; label: string; color: string }[] = [
  { type: "delegate", label: "Delegations", color: "var(--accent-olive)" },
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
  const { topDelegators, whaleChanges, whaleHistory } = useWhaleData();

  const [activeTab, setActiveTab] = useState<ActiveTab>("activity");
  // Multi-select tier filter. Empty set OR a set containing "all"
  // means show everything (e.g. user clicked the "All" chip). When
  // the user clicks a specific tier, "all" toggles off and the
  // chosen tier is added to the active set; clicking it again
  // removes it. Picking 100K-1M + 1M+ together is the common combo.
  const [activeTiers, setActiveTiers] = useState<Set<FeedTier>>(() => new Set());
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

  // Sync tab with URL hash so both tabs have shareable custom links:
  //   /#staking  → Staking Activity (also accepts "activity" as an alias)
  //   /#whales   → Whale Tracker
  // A bare URL (no hash) defaults to Staking Activity to preserve the
  // "landing page" feel for first-time visitors.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const readTab = (): ActiveTab | null => {
      const h = window.location.hash.replace("#", "");
      if (h === "whales") return "whales";
      if (h === "staking" || h === "activity") return "activity";
      return null; // no recognized hash → keep current tab state
    };
    const initial = readTab();
    if (initial) setActiveTab(initial);
    const onHashChange = () => {
      const t = readTab();
      if (t) setActiveTab(t);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const setTab = (tab: ActiveTab) => {
    setActiveTab(tab);
    if (typeof window !== "undefined") {
      // Both tabs now get an explicit hash so the URL always reflects
      // current state after user interaction. replaceState (not
      // pushState) so tab switching doesn't clutter browser history.
      const newHash = tab === "whales" ? "#whales" : "#staking";
      if (window.location.hash !== newHash) {
        history.replaceState(null, "", newHash);
      }
    }
  };

  const filteredEvents = useMemo(() => {
    const byTier = filterByTiers(events, activeTiers);
    return byTier.filter((e) => activeTypes.has(e.type));
  }, [events, activeTiers, activeTypes]);

  // Net stake flow over the filtered slice (delegates positive,
  // undelegates negative, redelegates neutral). Updates as filters
  // change so the user sees "net of what I'm currently looking at",
  // not net of everything.
  const netFlow = useMemo(() => computeNetStakeFlow(filteredEvents), [filteredEvents]);

  const showAllTiers = activeTiers.size === 0 || activeTiers.has("all");
  const toggleTier = (tier: FeedTier) => {
    setActiveTiers((prev) => {
      // The "All" chip is a clear-all. Empty set means all events
      // pass through filterByTiers, so nothing else needs to change.
      if (tier === "all") return new Set<FeedTier>();
      const next = new Set(prev);
      // Drop a stray "all" if it was somehow set.
      next.delete("all");
      if (next.has(tier)) next.delete(tier);
      else next.add(tier);
      return next;
    });
  };

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
            <span className="staking-feed-stale-icon" aria-hidden="true">!</span>
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
              {FEED_TIERS.map((tier) => {
                const isActive = tier === "all" ? showAllTiers : activeTiers.has(tier);
                return (
                  <button
                    key={tier}
                    className={`time-pill ${isActive ? "active" : ""}`}
                    onClick={() => toggleTier(tier)}
                  >
                    {TIER_LABELS[tier]}
                  </button>
                );
              })}
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
              {filteredEvents.length > 0 && (
                <>
                  {" · "}
                  <span className={netFlow >= 0 ? "staking-feed-net-positive" : "staking-feed-net-negative"}>
                    Net {netFlow >= 0 ? "+" : "−"}{formatLargeNumber(Math.abs(netFlow))} TX
                  </span>
                </>
              )}
            </div>
          </>
        ) : (
          <WhaleTracker
            topDelegators={topDelegators.entries}
            whaleChanges={whaleChanges}
            whaleHistory={whaleHistory}
            events={events}
            validators={validators}
            now={now}
            onEventClick={setSelectedEvent}
            onDelegatorClick={setSelectedDelegator}
            onAddressClick={(address, label, stake, rank) => {
              // Synthesize a minimal TopDelegatorEntry for addresses surfaced
              // by the diff feed that may not be in the current top-500 list
              // (e.g. exits, or arrivals whose full entry hasn't been paged to).
              // The panel fetches real stake distribution on demand, so the
              // synthesized totalStake/validatorCount are just placeholders.
              const existing = topDelegators.entries.find((e) => e.address === address);
              setSelectedDelegator(
                existing ?? {
                  rank,
                  address,
                  totalStake: stake,
                  validatorCount: 0,
                  label,
                },
              );
            }}
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
