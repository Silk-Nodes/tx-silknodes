-- ─── news_items.content_html ─────────────────────────────────────────
-- Optional full-post HTML so the Today page side panel can render the
-- full Medium article in-place instead of just the teaser. Stored as
-- raw HTML; sanitised on the read side before rendering to the DOM.
--
-- Only Medium populates this today. Twitter/tx_press leave it NULL.
-- 30KB hard cap is enforced in the collector to keep payloads bounded
-- and prevent a giant post from blowing up the row.
ALTER TABLE news_items
  ADD COLUMN IF NOT EXISTS content_html TEXT;
