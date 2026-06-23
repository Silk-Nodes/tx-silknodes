# Today page: news feed + automation

Branch: `feat/governance-page` in worktree `confident-feynman-dc5359`.

## Problem

`TodayTab.tsx` has two side-by-side columns ("Today's signals" and "What's happening") that use the same row template, so they read as duplicate UI. The right column only has two data sources (governance + PSE), and PSE amounts are hardcoded to ~14.20M TX. No external news context.

## Decisions

1. News sources (all free):
   - Twitter syndication endpoint for `@txEcosystem`: `https://cdn.syndication.twitter.com/timeline/profile?screen_name=txEcosystem`
   - Medium full feed: `https://medium.com/feed/@txEcosystem` (option C: pull all, boost severity for `announcement`, `governance`, `partnership`, `roadmap`, `upgrade` tags)
   - Scrape `https://tx.org/press-and-media` every 6h with cheerio
2. Retention: 90 days, pruned on each collector tick
3. Feed cap: 6 visible (no expander for now)
4. No LLM. Templated strings only.

## Plan

- [ ] Migration 010: `news_items` table (id, source, external_id, title, url, summary, ts, severity, tags jsonb, raw jsonb)
- [ ] Migration 011: `chain_events` table (id, type, severity, ts, payload jsonb, dedupe_key UNIQUE)
- [ ] `vm-service/collect-news.mjs` daemon (30 min loop)
  - Twitter syndication pull, dedupe by tweet id
  - Medium RSS pull, dedupe by guid, tag-aware severity
  - tx.org/press-and-media scrape (cheerio), dedupe by url hash, 6h interval
  - 90d prune at the end of each tick
- [ ] `vm-service/derive-chain-events.mjs` daemon (5 min loop)
  - whale_delegate / large_unbond from staking_events (threshold: top 99th percentile of last 30d, min 100k TX)
  - validator_joined / validator_left from validator set diffs
  - commission_changed > 1pp from validator history
  - jailed / unjailed from validator status diffs
  - pse_distributed: real amount paid out on each PSE cycle timestamp from staking_events
- [ ] `src/app/api/today/feed/route.ts`
  - Reads `news_items` + `chain_events` + governance proposals + PSE schedule
  - Sorts desc by ts, caps at 6
  - 60s in-process cache
- [ ] `src/components/today/HappeningFeed.tsx`
  - Vertical timeline rail (left gutter: dot + connecting line)
  - Source-colored chip (GOVERNANCE / PSE / WHALE / VALIDATOR / TX-NEWS / MEDIUM)
  - `ANNOUNCEMENT` badge for high-severity Medium tags
  - Relative time, headline, optional sub
- [ ] Refactor `TodaySignals.tsx`: number-led rows (big number left, headline right) so it stops mirroring the feed visually
- [ ] Wire `HappeningFeed` into `TodayTab.tsx`, remove inline `WhatsHappeningFeed`
- [ ] Real PSE distribution amounts in chain_events (kills the hardcoded 14.20M)
- [ ] Add CSS for timeline rail + restyled signals
- [ ] Smoke test locally: dev server, `/api/today/feed`, eyeball page
- [ ] Commit + push branch, new PR

## Review

(To be filled after implementation.)

## Lessons captured

(To be filled after corrections.)
