// GET /api/today/feed
//
// Powers the Today page "What's happening" timeline. Merges three
// time-anchored streams into one feed:
//
//   chain_events   derived on-chain activity (whale_delegate, large_unbond,
//                  pse_distributed) — populated by vm-service/derive-chain-events.mjs
//   news_items     external sources (twitter, medium, tx_press) — populated
//                  by vm-service/collect-news.mjs
//   governance     live + recently-decided proposals, loaded straight from
//                  the existing governance source-of-truth so we don't have
//                  to duplicate proposal state into chain_events
//
// Response shape (one row per feed item, sorted desc by ts):
//   {
//     updatedAt: ISO string,
//     items: FeedItem[]
//   }
//
//   FeedItem = {
//     source: 'chain' | 'twitter' | 'medium' | 'tx_press' | 'governance'
//     type:   string            // e.g. 'whale_delegate', 'medium_post', 'proposal_voting'
//     severity: 'low' | 'normal' | 'high'
//     ts:     ISO string
//     title:  string            // headline
//     sub?:   string            // optional second line
//     url?:   string            // outbound link (governance items return internal route)
//     tag:    string            // UI chip label
//     tags?:  string[]          // medium tags etc, used for ANNOUNCEMENT badge
//   }
//
// Cache: 60s in-process to keep the page snappy without hammering the
// DB. Acceptable staleness for a feed that turns over on news + on-chain
// cadence.

import { NextResponse } from "next/server";
import { QueryTypes } from "sequelize";
import { sequelize } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const FEED_LIMIT = 6;
const CACHE_TTL_MS = 60_000;

type Severity = "low" | "normal" | "high";
type FeedSource =
  | "chain"
  | "twitter"
  | "medium"
  | "tx_press"
  | "governance";

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
};

type NewsRow = {
  source: "twitter" | "medium" | "tx_press";
  external_id: string;
  title: string;
  url: string;
  ts: Date;
  severity: Severity;
  tags: string[] | null;
};

type ChainRow = {
  type: string;
  severity: Severity;
  ts: Date;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: Record<string, any>;
};

// Module-scoped cache. Survives hot reloads via the same globalThis
// pattern as the Sequelize singleton — we don't need that here because
// stale 60s on dev is fine.
let cached: { at: number; body: { updatedAt: string; items: FeedItem[] } } | null = null;

export async function GET() {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json(cached.body, {
      headers: { "x-cache": "HIT" },
    });
  }

  // News + chain pulled in parallel — independent queries, both bounded
  // by ORDER BY ts DESC LIMIT N so the DB never returns more than we'd
  // ever surface.
  const [news, chain] = await Promise.all([
    sequelize
      .query<NewsRow>(
        `SELECT source, external_id, title, url, ts, severity, tags
           FROM news_items
          ORDER BY ts DESC
          LIMIT 30`,
        { type: QueryTypes.SELECT },
      )
      .catch((err) => {
        console.warn(`[today-feed] news_items query failed: ${err?.message}`);
        return [] as NewsRow[];
      }),
    sequelize
      .query<ChainRow>(
        `SELECT type, severity, ts, payload
           FROM chain_events
          ORDER BY ts DESC
          LIMIT 30`,
        { type: QueryTypes.SELECT },
      )
      .catch((err) => {
        console.warn(`[today-feed] chain_events query failed: ${err?.message}`);
        return [] as ChainRow[];
      }),
  ]);

  const items: FeedItem[] = [];

  for (const n of news) {
    items.push(mapNews(n));
  }
  for (const c of chain) {
    items.push(mapChain(c));
  }

  items.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  const top = items.slice(0, FEED_LIMIT);

  const body = {
    updatedAt: new Date().toISOString(),
    items: top,
  };
  cached = { at: Date.now(), body };
  return NextResponse.json(body, { headers: { "x-cache": "MISS" } });
}

function mapNews(n: NewsRow): FeedItem {
  const ts = new Date(n.ts).toISOString();
  if (n.source === "twitter") {
    return {
      source: "twitter",
      type: "tweet",
      severity: n.severity,
      ts,
      title: n.title,
      url: n.url,
      tag: "TX NEWS",
      tags: n.tags ?? undefined,
    };
  }
  if (n.source === "medium") {
    return {
      source: "medium",
      type: "medium_post",
      severity: n.severity,
      ts,
      title: n.title,
      url: n.url,
      tag: n.severity === "high" ? "ANNOUNCEMENT" : "MEDIUM",
      tags: n.tags ?? undefined,
    };
  }
  // tx_press
  return {
    source: "tx_press",
    type: "press_release",
    severity: n.severity,
    ts,
    title: n.title,
    url: n.url,
    tag: "PRESS",
    tags: n.tags ?? undefined,
  };
}

function mapChain(c: ChainRow): FeedItem {
  const ts = new Date(c.ts).toISOString();
  // Each chain_event type renders into a one-line headline + an optional
  // sub. Keep these terse — the UI shows them in a compact row.
  switch (c.type) {
    case "whale_delegate": {
      const amount = Number(c.payload?.amount_tx) || 0;
      return {
        source: "chain",
        type: "whale_delegate",
        severity: c.severity,
        ts,
        title: `${formatTx(amount)} TX delegated`,
        sub: `to validator ${shortVal(c.payload?.validator)}`,
        tag: "WHALE",
      };
    }
    case "large_unbond": {
      const amount = Number(c.payload?.amount_tx) || 0;
      return {
        source: "chain",
        type: "large_unbond",
        severity: c.severity,
        ts,
        title: `${formatTx(amount)} TX unbonded`,
        sub: `from validator ${shortVal(c.payload?.validator)}`,
        tag: "WHALE",
      };
    }
    case "pse_distributed": {
      const amount = Number(c.payload?.amount_tx) || 0;
      const recipients = Number(c.payload?.recipient_count) || 0;
      return {
        source: "chain",
        type: "pse_distributed",
        severity: "high",
        ts,
        title: `PSE cycle distributed`,
        sub: `${formatTx(amount)} TX to ${recipients.toLocaleString()} stakers`,
        tag: "PSE",
      };
    }
    default:
      return {
        source: "chain",
        type: c.type,
        severity: c.severity,
        ts,
        title: c.type,
        tag: "CHAIN",
      };
  }
}

// ── Helpers ────────────────────────────────────────────────────────────
function formatTx(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}
function shortVal(op: string | undefined): string {
  if (!op) return "?";
  if (op.length <= 14) return op;
  return `${op.slice(0, 8)}…${op.slice(-4)}`;
}
