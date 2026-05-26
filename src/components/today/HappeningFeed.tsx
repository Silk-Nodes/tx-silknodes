"use client";

import { useEffect, useMemo, useState } from "react";
import type { Proposal } from "@/lib/governance";
import type { NextPSECycle } from "@/hooks/useNextPSECycle";
import FeedItemPanel, { type PanelItem } from "./FeedItemPanel";

// ── API contract (must match /api/today/feed route.ts) ─────────────────
type FeedSource =
  | "chain"
  | "twitter"
  | "medium"
  | "tx_press"
  | "governance";
type Severity = "low" | "normal" | "high";

type FeedItem = {
  source: FeedSource;
  type: string;
  severity: Severity;
  ts: string;
  title: string;
  sub?: string;
  url?: string;
  tag: string;
  tags?: string[];
  body?: string;
};

interface Props {
  proposals: Proposal[];
  cycle: NextPSECycle | null;
}

// HappeningFeed: vertical timeline rail of recent activity. Merges three
// streams into one list:
//   1. /api/today/feed: chain_events (whale, large_unbond, pse) + news
//      (txEcosystem twitter, medium, tx.org press)
//   2. Governance: live + recently-decided proposals (read on the client
//      because the existing useGovernance hook already loads them and we
//      don't want to duplicate that fetch on the server)
//   3. PSE fallback: if chain_events has no pse_distributed rows yet
//      (fresh deploy, deriver hasn't run), fall back to cycle.schedule
//      so we never show a blank feed
//
// The visual rhythm differs from TodaySignals on purpose: this is a news
// ticker (left rail with dots + connecting line), Signals is a numbers
// column. Same width, different shape = readable as two different things.
export default function HappeningFeed({ proposals, cycle }: Props) {
  const [feedItems, setFeedItems] = useState<FeedItem[] | null>(null);
  const [feedError, setFeedError] = useState(false);
  const [panelItem, setPanelItem] = useState<PanelItem | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/today/feed")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((j: { items: FeedItem[] }) => {
        if (cancelled) return;
        setFeedItems(j.items || []);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("[today-feed] fetch failed", err);
        setFeedError(true);
        setFeedItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Governance events derived client-side from the existing proposals
  // list. Shape matches FeedItem so the merge is just an array spread.
  const govItems: FeedItem[] = useMemo(() => {
    const out: FeedItem[] = [];
    for (const p of proposals) {
      if (p.status === "voting" || p.status === "deposit") {
        const t = p.votingStartTime
          ? new Date(p.votingStartTime).getTime()
          : p.submitTime
          ? new Date(p.submitTime).getTime()
          : 0;
        if (!t) continue;
        out.push({
          source: "governance",
          type: p.status === "voting" ? "proposal_voting" : "proposal_deposit",
          severity: "high",
          ts: new Date(t).toISOString(),
          title:
            p.status === "voting"
              ? `Proposal #${p.id} entered voting`
              : `Proposal #${p.id} is in deposit period`,
          sub: p.title,
          url: `/governance/${p.id}`,
          tag: "GOVERNANCE",
        });
        continue;
      }
      if (p.status === "passed" || p.status === "rejected" || p.status === "failed") {
        const t = p.votingEndTime ? new Date(p.votingEndTime).getTime() : 0;
        if (!t) continue;
        const verb =
          p.status === "passed"
            ? "passed"
            : p.status === "rejected"
            ? "was rejected"
            : "failed";
        out.push({
          source: "governance",
          type: `proposal_${p.status}`,
          severity: p.status === "passed" ? "high" : "normal",
          ts: new Date(t).toISOString(),
          title: `Proposal #${p.id} ${verb}`,
          sub: p.title,
          url: `/governance/${p.id}`,
          tag: "GOVERNANCE",
        });
      }
    }
    return out;
  }, [proposals]);

  // PSE fallback: only used when the server feed has zero pse_distributed
  // rows. Once derive-chain-events.mjs runs, the server version takes
  // over with real recipient counts and amounts.
  const pseFallback: FeedItem[] = useMemo(() => {
    if (!cycle?.schedule?.length) return [];
    if (feedItems == null) return [];
    const hasServerPse = feedItems.some(
      (it) => it.source === "chain" && it.type === "pse_distributed",
    );
    if (hasServerPse) return [];
    const nowSec = Math.floor(Date.now() / 1000);
    const past = cycle.schedule
      .map((t, i) => ({ t, i }))
      .filter((x) => x.t <= nowSec)
      .slice(-5);
    return past.map(({ t, i }) => ({
      source: "chain" as const,
      type: "pse_distributed",
      severity: "high" as const,
      ts: new Date(t * 1000).toISOString(),
      title: `PSE cycle ${i + 1} distributed`,
      sub: `Distribution timestamp from PSE schedule`,
      url: "/pse",
      tag: "PSE",
    }));
  }, [cycle, feedItems]);

  const merged = useMemo(() => {
    if (feedItems == null) return null;
    const all = [...feedItems, ...govItems, ...pseFallback];
    all.sort(
      (a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime(),
    );
    return all.slice(0, 6);
  }, [feedItems, govItems, pseFallback]);

  return (
    <section className="today-section happening-feed">
      <div className="today-section-label">What&apos;s happening</div>
      {merged == null && (
        <div className="happening-feed-empty">Loading activity…</div>
      )}
      {merged != null && merged.length === 0 && (
        <div className="happening-feed-empty">
          {feedError
            ? "Activity feed temporarily unavailable."
            : "No recent activity yet."}
        </div>
      )}
      {merged != null && merged.length > 0 && (
        <ol className="happening-rail" role="list">
          {merged.map((it, idx) => (
            <FeedRow
              key={`${it.source}-${it.type}-${it.ts}-${idx}`}
              item={it}
              isLast={idx === merged.length - 1}
              onOpen={() => setPanelItem(it)}
            />
          ))}
        </ol>
      )}
      <FeedItemPanel item={panelItem} onClose={() => setPanelItem(null)} />
    </section>
  );
}

// Every row opens the side panel — clicking a Medium teaser, a tweet,
// a press release, an on-chain event or a governance row pops the
// drawer with the full body + an "Open original" CTA inside. This
// avoids accidentally navigating away from Today (especially valuable
// for the external sources where we'd otherwise lose context).
function FeedRow({
  item, isLast, onOpen,
}: { item: FeedItem; isLast: boolean; onOpen: () => void }) {
  return (
    <li className="happening-row">
      <button
        type="button"
        className="happening-row-link happening-row-button"
        onClick={onOpen}
      >
        <span className="happening-rail-rail" aria-hidden="true">
          <span className={`happening-rail-dot tone-${item.severity}`} />
          {!isLast && <span className="happening-rail-line" />}
        </span>
        <span className="happening-row-body">
          <span className="happening-row-meta">
            <span
              className={`happening-row-tag source-${item.source} ${
                item.severity === "high" ? "high" : ""
              }`}
            >
              {item.tag}
            </span>
            <span className="happening-row-time">{relTimeShort(item.ts)}</span>
          </span>
          <span className="happening-row-title">{item.title}</span>
          {item.sub && <span className="happening-row-sub">{item.sub}</span>}
        </span>
      </button>
    </li>
  );
}

function relTimeShort(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "scheduled";
  const days = Math.floor(ms / 86_400_000);
  if (days >= 30) {
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
  }
  if (days > 0) return `${days}d ago`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours > 0) return `${hours}h ago`;
  const mins = Math.floor(ms / 60_000);
  if (mins > 0) return `${mins}m ago`;
  return "just now";
}
