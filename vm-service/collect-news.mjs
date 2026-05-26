#!/usr/bin/env node

/**
 * Silk Nodes News Collector
 *
 * Pulls external TX-ecosystem news from three free sources and stores
 * them in `news_items`. The Today page feed reads from there. No API
 * keys required.
 *
 * Sources:
 *   twitter   cdn.syndication.twitter.com timeline (no auth, public
 *             embed endpoint). One pull = latest ~20 tweets for the
 *             configured screen_name.
 *   medium    medium.com/feed/@txEcosystem RSS. Tag-aware severity:
 *             posts tagged announcement/governance/partnership/roadmap/
 *             upgrade are flagged severity=high.
 *   tx_press  Scrapes tx.org/press-and-media every 6h. Regex-based, no
 *             cheerio dep. Fragile by nature; if the markup changes the
 *             collector logs a warning and keeps running.
 *
 * Dedupe: (source, external_id) UNIQUE. Idempotent — re-running on the
 * same data inserts nothing.
 *
 * Retention: 90 days, pruned on each tick.
 *
 * Required env vars: same as the other collectors (PGUSER, PGPASSWORD,
 * PGDATABASE). Optional:
 *   POLL_INTERVAL_MS   default 30 min
 *   TWITTER_HANDLE     default 'txEcosystem'
 *   MEDIUM_HANDLE      default '@txEcosystem'
 *   TX_PRESS_URL       default 'https://tx.org/press-and-media'
 *   LOG_LEVEL          default 'info'
 */

import { query } from "./db.mjs";

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 30 * 60_000;
const PRESS_INTERVAL_MS = 6 * 60 * 60_000; // 6h
const RETENTION_DAYS = 90;

const TWITTER_HANDLE = process.env.TWITTER_HANDLE || "txEcosystem";
const MEDIUM_HANDLE = process.env.MEDIUM_HANDLE || "@txEcosystem";
const TX_PRESS_URL = process.env.TX_PRESS_URL || "https://tx.org/press-and-media";

const HIGH_SEVERITY_TAGS = new Set([
  "announcement",
  "announcements",
  "governance",
  "partnership",
  "partnerships",
  "roadmap",
  "upgrade",
  "upgrades",
  "launch",
  "mainnet",
]);

const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const levels = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = levels[LOG_LEVEL] ?? 1;
function log(level, ...args) {
  if (levels[level] < currentLevel) return;
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${level.toUpperCase()}]`, ...args);
}

async function fetchText(url, attempt = 1) {
  try {
    const res = await fetch(url, {
      headers: {
        // Some upstream CDNs serve different bodies based on UA. Mimicking
        // a real browser is the safest default for the syndication
        // endpoint and the tx.org page.
        "user-agent":
          "Mozilla/5.0 (compatible; SilkNodesBot/1.0; +https://tx.silknodes.io)",
        accept: "text/html, application/json, application/xml, text/xml",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.text();
  } catch (err) {
    if (attempt >= 3) throw err;
    await new Promise((r) => setTimeout(r, 1000 * attempt));
    return fetchText(url, attempt + 1);
  }
}

// ── Twitter syndication ────────────────────────────────────────────────
// Public endpoint used by Twitter's own iframe embed widget. Returns
// JSON with the latest ~20 tweets. No auth, no rate limit headers
// observed at the cadence we run (every 30 min).
async function pullTwitter() {
  const url = `https://cdn.syndication.twitter.com/timeline/profile?screen_name=${encodeURIComponent(TWITTER_HANDLE)}&dnt=1&suppress_response_codes=true`;
  const body = await fetchText(url);
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error("Twitter syndication returned non-JSON body");
  }
  // Two response shapes are in the wild depending on Twitter's rollout:
  // { body: [...] } (HTML-style timeline) and { timeline: { entries: [...] } }
  // (newer). We normalize both into a list of tweet objects.
  let tweets = [];
  if (Array.isArray(json?.body)) {
    // Old shape — body is an array of pre-rendered entries with metadata.
    tweets = json.body;
  } else if (Array.isArray(json?.timeline?.entries)) {
    tweets = json.timeline.entries
      .map((e) => e?.content?.tweet || e?.tweet)
      .filter(Boolean);
  } else if (Array.isArray(json?.props?.pageProps?.contextProvider?.timeline?.entries)) {
    // Defensive: another shape seen via the Next.js-rendered variant.
    tweets = json.props.pageProps.contextProvider.timeline.entries
      .map((e) => e?.content?.tweet || e?.tweet)
      .filter(Boolean);
  }

  const items = [];
  for (const t of tweets) {
    const id = t?.id_str || t?.id || t?.tweet_id;
    if (!id) continue;
    const text = (t?.full_text || t?.text || "").trim();
    if (!text) continue;
    const createdAt = t?.created_at || t?.legacy?.created_at || null;
    const ts = createdAt ? new Date(createdAt) : new Date();
    items.push({
      source: "twitter",
      external_id: String(id),
      title: truncate(text, 220),
      url: `https://x.com/${TWITTER_HANDLE}/status/${id}`,
      summary: null,
      ts,
      severity: "normal",
      tags: null,
      raw: t,
    });
  }
  return items;
}

// ── Medium RSS ─────────────────────────────────────────────────────────
// Hand-rolled regex parser. Medium's feed is regular and well-formed
// across years of evolution; adding rss-parser is not worth the dep.
async function pullMedium() {
  const url = `https://medium.com/feed/${encodeURIComponent(MEDIUM_HANDLE)}`;
  const xml = await fetchText(url);
  const items = [];
  const itemBlocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
  for (const m of itemBlocks) {
    const block = m[1];
    const title = cdataOrText(block, "title");
    const link = cdataOrText(block, "link");
    const guid = cdataOrText(block, "guid") || link;
    const pubDate = cdataOrText(block, "pubDate");
    const ts = pubDate ? new Date(pubDate) : new Date();
    if (!title || !link) continue;
    const tagMatches = [...block.matchAll(/<category>([\s\S]*?)<\/category>/g)];
    const tags = tagMatches
      .map((t) => stripCdata(t[1]).trim().toLowerCase())
      .filter(Boolean);
    const severity = tags.some((t) => HIGH_SEVERITY_TAGS.has(t))
      ? "high"
      : "normal";
    items.push({
      source: "medium",
      external_id: guid,
      title: truncate(title, 220),
      url: link,
      summary: null,
      ts,
      severity,
      tags,
      raw: { tags, pubDate },
    });
  }
  return items;
}

// ── tx.org press scrape ────────────────────────────────────────────────
// The press page is a static marketing page. We extract <a href=...>...</a>
// blocks that look like press articles, plus their nearby date if visible.
// If the markup changes, we log a warning and keep going (no exception
// bubbles up since this source is best-effort).
//
// Heuristics:
//   - candidate links whose path starts with /press/, /news/, /blog/,
//     /post/, or /press-and-media/
//   - title from anchor text, trimmed and de-duped on URL
async function pullTxPress() {
  let html;
  try {
    html = await fetchText(TX_PRESS_URL);
  } catch (err) {
    log("warn", `tx.org press fetch failed: ${err.message}`);
    return [];
  }

  const items = [];
  const seen = new Set();
  const linkRe = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/g;
  const pressPathRe = /\/(press|news|blog|post|press-and-media|press-release)\//i;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const hrefRaw = m[1];
    const inner = stripTags(m[2]).trim();
    if (!hrefRaw || !inner || inner.length < 10 || inner.length > 220) continue;
    if (!pressPathRe.test(hrefRaw)) continue;
    const url = normalizeUrl(hrefRaw, TX_PRESS_URL);
    if (seen.has(url)) continue;
    seen.add(url);
    const id = sha1Hex(url);
    items.push({
      source: "tx_press",
      external_id: id,
      title: truncate(inner, 220),
      url,
      summary: null,
      // We can't reliably extract a publish date without a real parser,
      // so use first-seen time. On subsequent ticks the UNIQUE constraint
      // means we don't overwrite, so this stays stable as "when we saw
      // it" which is acceptable for a press feed.
      ts: new Date(),
      severity: "high", // press releases are by nature announcement-grade
      tags: ["press"],
      raw: null,
    });
  }
  if (items.length === 0) {
    log(
      "warn",
      `tx.org press scrape returned 0 items — selector may need updating`,
    );
  }
  return items;
}

// ── DB write + retention ───────────────────────────────────────────────
async function upsertItems(items) {
  if (items.length === 0) return { inserted: 0 };
  let inserted = 0;
  for (const it of items) {
    // ON CONFLICT DO NOTHING so re-runs are no-ops. If we ever want to
    // refresh content (e.g. corrected titles) we'd swap to DO UPDATE.
    const res = await query(
      `INSERT INTO news_items
         (source, external_id, title, url, summary, ts, severity, tags, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (source, external_id) DO NOTHING`,
      [
        it.source,
        it.external_id,
        it.title,
        it.url,
        it.summary,
        it.ts,
        it.severity,
        it.tags ? JSON.stringify(it.tags) : null,
        it.raw ? JSON.stringify(it.raw) : null,
      ],
    );
    if (res.rowCount > 0) inserted++;
  }
  return { inserted };
}

async function pruneOldNews() {
  const res = await query(
    `DELETE FROM news_items WHERE ts < NOW() - INTERVAL '${RETENTION_DAYS} days'`,
  );
  return res.rowCount;
}

// ── Helpers ────────────────────────────────────────────────────────────
function cdataOrText(block, tag) {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`);
  const m = block.match(re);
  if (!m) return "";
  return stripCdata(m[1]).trim();
}
function stripCdata(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}
function stripTags(s) {
  return s.replace(/<[^>]+>/g, "");
}
function truncate(s, n) {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}
function normalizeUrl(href, base) {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}
function sha1Hex(s) {
  // Deterministic, dep-free 32-bit hash. Not cryptographic — only used
  // as a dedupe key for the scrape, where collision risk is negligible
  // at the volume of a press page.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// ── Main loop ──────────────────────────────────────────────────────────
let lastPressPullAt = 0;

async function tick() {
  const tickStart = Date.now();
  let twInserted = 0;
  let mdInserted = 0;
  let prInserted = 0;
  let pruned = 0;

  try {
    const tw = await pullTwitter();
    const r = await upsertItems(tw);
    twInserted = r.inserted;
    log("info", `twitter: pulled=${tw.length} inserted=${twInserted}`);
  } catch (err) {
    log("error", `twitter pull failed: ${err.message}`);
  }

  try {
    const md = await pullMedium();
    const r = await upsertItems(md);
    mdInserted = r.inserted;
    log("info", `medium: pulled=${md.length} inserted=${mdInserted}`);
  } catch (err) {
    log("error", `medium pull failed: ${err.message}`);
  }

  if (Date.now() - lastPressPullAt >= PRESS_INTERVAL_MS) {
    try {
      const pr = await pullTxPress();
      const r = await upsertItems(pr);
      prInserted = r.inserted;
      lastPressPullAt = Date.now();
      log("info", `tx_press: pulled=${pr.length} inserted=${prInserted}`);
    } catch (err) {
      log("error", `tx_press scrape failed: ${err.message}`);
    }
  }

  try {
    pruned = await pruneOldNews();
    if (pruned > 0) log("info", `pruned ${pruned} rows older than ${RETENTION_DAYS}d`);
  } catch (err) {
    log("error", `prune failed: ${err.message}`);
  }

  const ms = Date.now() - tickStart;
  log(
    "info",
    `tick done in ${ms}ms — twitter+${twInserted} medium+${mdInserted} press+${prInserted} pruned-${pruned}`,
  );
}

async function main() {
  log("info", `starting news collector (poll ${POLL_INTERVAL_MS / 60_000}m)`);
  // Initial tick, then steady cadence. setInterval is fine since we
  // don't await inside it — overlap is unlikely at 30 min cadence.
  await tick();
  setInterval(() => {
    tick().catch((err) => log("error", `tick failed: ${err.message}`));
  }, POLL_INTERVAL_MS);
}

main().catch((err) => {
  log("error", `fatal: ${err.message}`);
  process.exit(1);
});
