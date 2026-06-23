"use client";

import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { relativeTimeShort } from "@/lib/ui-format";
import { sanitizeHtmlClient } from "@/lib/sanitize-html-client";

type FeedSource =
  | "chain"
  | "twitter"
  | "medium"
  | "tx_press"
  | "governance";
type Severity = "low" | "normal" | "high";

export type PanelItem = {
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
  bodyHtml?: string;
  featured?: boolean;
};

// FeedItemPanel: slide-in right-edge drawer that opens when the user
// clicks a row in HappeningFeed. Shows the full body that doesn't fit
// in the compact row, plus an "Open original" CTA that drops to the
// external source (X, Medium, governance detail, etc).
//
// Implementation notes:
//   - Closes on Escape, on click outside, and on the X button.
//   - Body scroll is locked while the panel is open so the underlying
//     Today page doesn't double-scroll on mobile.
//   - For governance items the deep-link is internal (/governance/N)
//     so we use next/link; for everything else we open a new tab so
//     the user doesn't lose Today-page context.
export default function FeedItemPanel({
  item, onClose,
}: { item: PanelItem | null; onClose: () => void }) {
  // Move + trap + restore focus while the drawer is open.
  const panelRef = useFocusTrap<HTMLElement>(!!item);

  // Lock body scroll + handle Escape.
  useEffect(() => {
    if (!item) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [item, onClose]);

  // Sanitize Medium HTML on the client as defense-in-depth (the server
  // already sanitizes). Memoized so it doesn't re-run every render.
  const safeHtml = useMemo(
    () => (item?.bodyHtml ? sanitizeHtmlClient(item.bodyHtml) : ""),
    [item?.bodyHtml],
  );

  if (!item) return null;
  if (typeof document === "undefined") return null;

  const isExternal = item.url ? /^https?:\/\//.test(item.url) : false;
  const sourceLabel = sourceLabelFor(item.source);

  return createPortal(
    <div className="fi-panel-overlay" onClick={onClose} role="presentation">
      <aside
        ref={panelRef}
        className="fi-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`${sourceLabel}: ${item.title}`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <header className="fi-panel-header">
          <div className="fi-panel-meta">
            <span className={`fi-panel-source source-${item.source}`}>
              {sourceLabel}
            </span>
            <span className="fi-panel-time">{relativeTimeShort(item.ts)}</span>
          </div>
          <button
            type="button"
            className="fi-panel-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        {/* ── Title ── */}
        <h2 className="fi-panel-title">{item.title}</h2>

        {/* ── Sub line (e.g. proposal subtitle) ── */}
        {item.sub && <div className="fi-panel-sub">{item.sub}</div>}

        {/* ── Body ──
            HTML body (Medium) wins over plain text (tweets, chain events).
            HTML is allowlist-sanitized server-side AND again on the client
            (sanitizeHtmlClient) before this dangerouslySetInnerHTML sink. */}
        {safeHtml ? (
          <article
            className="fi-panel-body fi-panel-body-html"
            dangerouslySetInnerHTML={{ __html: safeHtml }}
          />
        ) : item.body ? (
          <div className="fi-panel-body">
            {item.body.split("\n").map((line, i) => (
              <p key={i} className="fi-panel-body-p">{line}</p>
            ))}
          </div>
        ) : (
          <div className="fi-panel-body fi-panel-body-empty">
            No preview text available. Open the original to read the full post.
          </div>
        )}

        {/* ── Tags (Medium only) ── */}
        {item.tags && item.tags.length > 0 && (
          <div className="fi-panel-tags">
            {item.tags.slice(0, 6).map((t) => (
              <span key={t} className="fi-panel-tag">#{t}</span>
            ))}
          </div>
        )}

        {/* ── CTA ── */}
        <footer className="fi-panel-footer">
          {item.url ? (
            isExternal ? (
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="fi-panel-cta-primary"
              >
                {openLabelFor(item.source)}
                <span className="fi-panel-cta-arrow">↗</span>
              </a>
            ) : (
              <Link href={item.url} className="fi-panel-cta-primary" onClick={onClose}>
                {openLabelFor(item.source)}
                <span className="fi-panel-cta-arrow">→</span>
              </Link>
            )
          ) : null}
          <button
            type="button"
            className="fi-panel-cta-secondary"
            onClick={onClose}
          >
            Close
          </button>
        </footer>
      </aside>
    </div>,
    document.body,
  );
}

function sourceLabelFor(s: FeedSource): string {
  switch (s) {
    case "twitter": return "TX on X";
    case "medium": return "Medium";
    case "tx_press": return "tx.org press";
    case "governance": return "Governance";
    case "chain": return "On-chain";
  }
}
function openLabelFor(s: FeedSource): string {
  switch (s) {
    case "twitter": return "Open on X";
    case "medium": return "Read on Medium";
    case "tx_press": return "View on tx.org";
    case "governance": return "Open proposal";
    case "chain": return "View detail";
  }
}
