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
// Public endpoint that backs Twitter's own iframe embed widget. As of
// 2026 the syndication CDN serves a pre-rendered Next.js HTML page (no
// JSON variant exists anymore at /timeline/profile?screen_name=...).
// We parse the embedded `<script id="__NEXT_DATA__" type="application/json">`
// blob and walk to `props.pageProps.timeline.entries[].content.tweet`.
//
// No auth, no API key. The HTML response is ~130KB and we hit it once
// per 30 min, well under any reasonable rate limit.
async function pullTwitter() {
  const url = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${encodeURIComponent(TWITTER_HANDLE)}?dnt=1&showHeader=false&showBorder=false`;
  const html = await fetchText(url);
  const scriptMatch = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
  );
  if (!scriptMatch) {
    throw new Error("Twitter syndication: __NEXT_DATA__ script not found");
  }
  let data;
  try {
    data = JSON.parse(scriptMatch[1]);
  } catch (err) {
    throw new Error(`Twitter syndication: __NEXT_DATA__ parse failed: ${err.message}`);
  }
  const entries =
    data?.props?.pageProps?.timeline?.entries ??
    data?.props?.pageProps?.contextProvider?.timeline?.entries ??
    [];
  const tweets = entries
    .map((e) => e?.content?.tweet || e?.tweet)
    .filter(Boolean);

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
// tx.org/press-and-media is a React SPA. The press item titles render
// into the static HTML as <h6 class="css-... css-...">TITLE</h6> with a
// publish date string in a sibling element, but the destination URLs
// to the original articles are hydrated client-side and are NOT present
// in the SSR response. So we scrape title + date, dedupe by title hash,
// and link every item back to tx.org/press-and-media itself. The user
// lands on the list with all press releases in one place.
//
// If the page structure ever changes (class names are CSS-in-JS hashes
// that survive across deploys but could rotate on a redesign), we log
// a warning instead of throwing.
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
  // The h6 class is two CSS-in-JS hashes. We anchor on the visible
  // tag name + a class= attribute and let the inner text be anything.
  // Matches the real markup as of 2026-05; if it ever stops matching,
  // the empty-items warning at the bottom fires.
  const titleRe = /<h6\s+class="css-[^"]+"[^>]*>([^<]{10,220})<\/h6>/g;
  // Dates render as plain text like "Apr 19, 2026" near each title.
  // We do a windowed search after each title for the next date string.
  const dateRe = /\b([A-Z][a-z]{2})\s+(\d{1,2}),\s+(20\d{2})\b/;
  let m;
  while ((m = titleRe.exec(html)) !== null) {
    const rawTitle = decodeHtmlEntities(m[1]).trim();
    if (!rawTitle) continue;
    // First title on the page is the "Press & media" page header — skip.
    if (/^press\s*&?\s*media$/i.test(rawTitle)) continue;
    if (seen.has(rawTitle.toLowerCase())) continue;
    seen.add(rawTitle.toLowerCase());

    // Pull a publish date from the 600 chars immediately following the
    // title. Falls back to "now" if not found.
    const tail = html.slice(m.index + m[0].length, m.index + m[0].length + 600);
    const dateMatch = tail.match(dateRe);
    const ts = dateMatch
      ? new Date(`${dateMatch[1]} ${dateMatch[2]}, ${dateMatch[3]} 12:00:00 UTC`)
      : new Date();

    const id = sha1Hex(rawTitle);
    items.push({
      source: "tx_press",
      external_id: id,
      title: truncate(rawTitle, 220),
      url: TX_PRESS_URL,
      summary: null,
      ts,
      severity: "high", // press releases are announcement-grade by nature
      tags: ["press"],
      raw: { titleHash: id },
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

function decodeHtmlEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) =>
      String.fromCharCode(parseInt(code, 16)),
    );
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
