"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toPng, toBlob } from "html-to-image";

// Shareable: wraps any chart/card so it can be exported as a branded PNG.
//
// Pattern mirrors hl.eco's snapshot feature:
//   1. A camera button overlays the wrapped content (top-right).
//   2. Click opens a modal showing a purpose-built EXPORT CARD (fixed
//      width, clean layout, tx.silknodes.io footer) — not the live
//      widget. This keeps the shared image consistent regardless of
//      page theme/layout.
//   3. Copy (PNG to clipboard) + Download PNG.
//
// The export card re-renders `children` inside a controlled, fixed-width
// frame so charts that are fluid on the page become a stable shareable
// graphic. Caller passes the title/subtitle for the card header.
//
// Font note: html-to-image embeds computed styles but custom web fonts
// can fall back to system fonts in the raster. We accept a clean system
// fallback for v1 (looks ~95% identical for our mono/sans stack).
interface Props {
  title: string;
  subtitle?: string;
  // Optional caption line under the chart inside the export card.
  caption?: string;
  // The live content. Rendered both in-page (as-is) and inside the
  // export card. Keep it self-contained (no page-level layout deps).
  children: React.ReactNode;
  // Export PNG width in CSS px (height auto). Default 720 ≈ hl.eco.
  exportWidth?: number;
  // framed=true (default): wrap children in a branded card with its own
  //   heading + footer. Use for raw content (no card chrome of its own).
  // framed=false: children already bring their own card styling — render
  //   them as-is and append only a small tx.silknodes.io footer line.
  //   Use for the analytics chart cards (chart-card-v2 etc).
  framed?: boolean;
  // Camera button placement when the wrapped card has its own top-right
  // controls. Default top-right.
  cameraOffset?: { top?: number; right?: number };
}

export default function Shareable({
  title, subtitle, caption, children, exportWidth = 720, framed = true, cameraOffset,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`shareable ${framed ? "" : "shareable-fill"}`}>
      <button
        type="button"
        className="shareable-camera"
        aria-label="Share as image"
        title="Share as image"
        style={cameraOffset ? { top: cameraOffset.top, right: cameraOffset.right } : undefined}
        onClick={() => setOpen(true)}
      >
        <CameraIcon />
      </button>

      {children}

      {open && (
        <ShareModal
          title={title}
          subtitle={subtitle}
          caption={caption}
          exportWidth={exportWidth}
          framed={framed}
          onClose={() => setOpen(false)}
        >
          {children}
        </ShareModal>
      )}
    </div>
  );
}

function ShareModal({
  title, subtitle, caption, exportWidth, framed, children, onClose,
}: {
  title: string;
  subtitle?: string;
  caption?: string;
  exportWidth: number;
  framed: boolean;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lock scroll + Escape to close.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const todayStamp = useMemo(
    () => new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }),
    [],
  );

  // Build render options bound to the node's actual box. Passing an
  // explicit width/height stops html-to-image from clipping edges
  // (the footer / right column were getting cut without this). The
  // solid backgroundColor avoids transparent bleed in the PNG.
  const buildOpts = (node: HTMLElement) => {
    const rect = node.getBoundingClientRect();
    const pageBg =
      getComputedStyle(document.documentElement)
        .getPropertyValue("--bg-page")
        .trim() || "#0c0c0c";
    return {
      pixelRatio: 2,
      cacheBust: true,
      width: Math.ceil(rect.width),
      height: Math.ceil(rect.height),
      backgroundColor: pageBg,
      // Skip the camera button if it ever leaks into the export tree.
      filter: (n: HTMLElement) =>
        !(n.classList && n.classList.contains("shareable-camera")),
    };
  };

  // html-to-image's first pass often misses fonts/images that haven't
  // been inlined into its clone yet, producing a clipped or blank image
  // (this was the "image is not correct" bug). Two warm-up passes prime
  // the clone cache; the third render is reliable.
  const rasterize = async (node: HTMLElement) => {
    const opts = buildOpts(node);
    await toPng(node, opts);
    await toPng(node, opts);
    return toPng(node, opts);
  };

  const handleDownload = useCallback(async () => {
    if (!cardRef.current) return;
    setBusy(true); setError(null);
    try {
      const dataUrl = await withTimeout(rasterize(cardRef.current), 15000);
      const a = document.createElement("a");
      a.download = `tx-silknodes-${slugify(title)}-${Date.now()}.png`;
      a.href = dataUrl;
      a.click();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Render failed: ${msg.slice(0, 80)}`);
      console.warn("[shareable] download failed", e);
    } finally {
      setBusy(false);
    }
  }, [title]);

  const handleCopy = useCallback(async () => {
    if (!cardRef.current) return;
    setBusy(true); setError(null); setCopied(false);
    const node = cardRef.current;
    const opts = buildOpts(node);
    // CRITICAL: pass a Promise to ClipboardItem and call clipboard.write
    // synchronously inside the click handler. Rendering a dense card
    // (e.g. the 12-row staking feed) takes long enough that if we await
    // the blob FIRST and then call write(), the browser's transient
    // user-activation has expired and write() throws NotAllowedError.
    // Lightweight charts captured fast enough to sneak in; the feed did
    // not. The Promise form lets write() fire immediately and the
    // browser awaits the render while keeping the gesture valid.
    const blobPromise = (async () => {
      await toPng(node, opts); // warm-up passes prime font/image inlining
      await toPng(node, opts);
      const b = await toBlob(node, opts);
      if (!b) throw new Error("no blob");
      return b;
    })();
    try {
      // ClipboardItem-with-Promise: Chrome/Edge/Safari. Firefox lacks it
      // and lands in the catch with the Download fallback hint.
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blobPromise }),
      ]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // NotAllowedError / missing ClipboardItem → browser support issue.
      // Anything else is a render failure worth seeing.
      const isSupport = /NotAllowed|ClipboardItem|not defined|clipboard/i.test(msg);
      setError(isSupport ? "Copy not supported here — use Download." : `Copy failed: ${msg.slice(0, 70)}`);
      console.warn("[shareable] copy failed", e);
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="share-overlay" onClick={onClose} role="presentation">
      <div
        className="share-dialog"
        role="dialog"
        aria-label={`Share ${title}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="share-dialog-head">
          <div>
            <div className="share-dialog-title">{title}</div>
            {subtitle && <div className="share-dialog-sub">{subtitle}</div>}
            <div className="share-dialog-dims">PNG · 2x · tx.silknodes.io</div>
          </div>
          <button type="button" className="share-dialog-close" onClick={onClose} aria-label="Close">×</button>
        </header>

        {/* ── The export card (this exact node is rasterized) ── */}
        <div className="share-card-scroll">
          <div
            ref={cardRef}
            className={`share-card ${framed ? "" : "share-card-bare"}`}
            style={{ width: exportWidth }}
          >
            {framed && (
              <div className="share-card-header">
                <div className="share-card-heading">{title}</div>
                {subtitle && <div className="share-card-subheading">{subtitle}</div>}
              </div>
            )}
            <div className="share-card-body">{children}</div>
            {framed && caption && <div className="share-card-caption">{caption}</div>}
            <div className="share-card-footer">
              <span className="share-card-domain">tx.silknodes.io</span>
              <span className="share-card-stamp">{todayStamp}</span>
            </div>
          </div>
        </div>

        <footer className="share-dialog-actions">
          {error && <span className="share-dialog-error">{error}</span>}
          <button type="button" className="share-btn-secondary" onClick={handleCopy} disabled={busy}>
            {copied ? "Copied" : "Copy"}
          </button>
          <button type="button" className="share-btn-primary" onClick={handleDownload} disabled={busy}>
            {busy ? "Rendering…" : "Download PNG"}
          </button>
        </footer>
      </div>
    </div>
  );
}

// ─── Inline marks ──────────────────────────────────────────────────────
function CameraIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}
// Reject if a render takes longer than ms so the button never hangs
// silently on a stuck font/image fetch — surfaces a visible error.
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error(`timed out after ${ms / 1000}s`)), ms),
    ),
  ]);
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40);
}
