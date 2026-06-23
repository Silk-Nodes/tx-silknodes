#!/usr/bin/env node

/**
 * Pin (or unpin) an official announcement on the Today page feed.
 *
 * Inserts a high-severity row into news_items so it gets featured at the
 * top of "What's happening" immediately, independent of the Twitter /
 * Medium / press collectors (useful on launch day when the news is on X
 * and the syndication endpoint is rate-limited, or when you just want
 * editorial control over the top slot).
 *
 * The source is auto-detected from the URL so the feed renders the right
 * chip and open-behavior:
 *   x.com / twitter.com  -> 'twitter'  (opens the side panel, "Open on X")
 *   medium.com           -> 'medium'
 *   anything else        -> 'tx_press'
 *
 * Idempotent: re-running with the same --id updates the existing row, so
 * you can fix a typo or swap the link without creating duplicates.
 *
 * Usage:
 *   node vm-service/pin-announcement.mjs \
 *     --title "The TX Super App is live" \
 *     --url   "https://x.com/txEcosystem/status/123..." \
 *     --summary "One mobile app for self-custody, staking and DeFi mini-apps." \
 *     [--id tx-super-app-launch] [--ts 2026-06-23T09:00:00Z]
 *
 *   # remove a pinned announcement:
 *   node vm-service/pin-announcement.mjs --remove --id tx-super-app-launch
 *
 * Env: same PG vars as the collectors (db.mjs auto-loads ~/.silknodes-db.env).
 */

import { query, closePool } from "./db.mjs";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    if (key === "remove") { out.remove = true; continue; }
    const val = argv[i + 1];
    if (val === undefined || val.startsWith("--")) { out[key] = true; continue; }
    out[key] = val;
    i++;
  }
  return out;
}

function detectSource(url) {
  if (/(^|\.)x\.com\//i.test(url) || /twitter\.com\//i.test(url)) return "twitter";
  if (/medium\.com\//i.test(url)) return "medium";
  return "tx_press";
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.remove) {
    const id = args.id;
    if (!id) {
      console.error("--remove requires --id <external_id>");
      process.exit(1);
    }
    const res = await query(
      `DELETE FROM news_items WHERE external_id = $1`,
      [id],
    );
    console.log(res.rowCount > 0 ? `Removed announcement "${id}".` : `No announcement with id "${id}".`);
    return;
  }

  const title = args.title;
  const url = args.url;
  if (!title || !url) {
    console.error("Required: --title \"...\" --url \"https://...\"");
    console.error("Optional: --summary \"...\" --id <slug> --ts <ISO> --source twitter|medium|tx_press");
    process.exit(1);
  }
  const source = args.source || detectSource(url);
  if (!["twitter", "medium", "tx_press"].includes(source)) {
    console.error(`Invalid --source "${source}" (must be twitter | medium | tx_press)`);
    process.exit(1);
  }
  const id = args.id || slugify(title);
  const summary = args.summary || null;
  const ts = args.ts ? new Date(args.ts) : new Date();
  if (Number.isNaN(ts.getTime())) {
    console.error(`Invalid --ts "${args.ts}" (use an ISO timestamp)`);
    process.exit(1);
  }

  // ON CONFLICT updates the row so re-running edits in place. severity is
  // forced to 'high' so the feed pins + features it. tags carry "launch"
  // and "pinned" so it's identifiable.
  const res = await query(
    `INSERT INTO news_items
       (source, external_id, title, url, summary, ts, severity, tags)
     VALUES ($1,$2,$3,$4,$5,$6,'high',$7)
     ON CONFLICT (source, external_id) DO UPDATE
       SET title = EXCLUDED.title,
           url = EXCLUDED.url,
           summary = EXCLUDED.summary,
           ts = EXCLUDED.ts,
           severity = 'high',
           tags = EXCLUDED.tags`,
    [source, id, title, url, summary, ts, JSON.stringify(["announcement", "pinned"])],
  );

  console.log(
    `Pinned announcement (${res.rowCount > 0 ? "ok" : "no change"}):\n` +
    `  source: ${source}\n  id:     ${id}\n  title:  ${title}\n  url:    ${url}\n` +
    `It will feature at the top of the Today feed within ~60s (feed cache).`,
  );
}

main()
  .catch((err) => {
    console.error(`pin-announcement failed: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => closePool());
