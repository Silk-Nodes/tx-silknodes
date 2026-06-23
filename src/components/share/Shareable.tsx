"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toPng, toBlob } from "html-to-image";
import { useFocusTrap } from "@/hooks/useFocusTrap";

// Shareable: wraps any chart/card so it can be exported as a branded PNG.
//
// Pattern mirrors hl.eco's snapshot feature:
//   1. A camera button overlays the wrapped content (top-right).
//   2. Click opens a modal showing a purpose-built EXPORT CARD (fixed
//      width, clean layout, tx.silknodes.io footer) - not the live
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
  // framed=false: children already bring their own card styling - render
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
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Move + trap + restore focus while the modal is open.
  const dialogRef = useFocusTrap<HTMLDivElement>(true);

  // Lock scroll + Escape to close. Also clears the "Copied" reset timer
  // on unmount so it can't fire on an unmounted component.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
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
      // skipFonts is the ROOT-CAUSE fix for `RangeError: Invalid string
      // length` on the large cards (staking feed, top delegators).
      // html-to-image serializes the clone + every node's inlined
      // computed style + base64-embedded web fonts into ONE string for
      // the SVG foreignObject. On a deep DOM the embedded font payload
      // pushes that string past V8's max length and toPng throws before
      // producing a blob. We already accept a system-font fallback in
      // exports, so embedding fonts is pure cost - skipping it removes
      // the largest contributor and also makes capture much faster.
      skipFonts: true,
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
  // (this was the "image is not correct" bug). One warm-up pass primes
  // the clone cache; the second render is reliable. Kept to two passes
  // (not three) so large cards - staking feed, top delegators - capture
  // well within the timeout instead of stacking 3 slow renders.
  const rasterize = async (node: HTMLElement) => {
    const opts = buildOpts(node);
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
    const blobPromise = withTimeout((async () => {
      await toPng(node, opts); // warm-up pass primes font/image inlining
      const b = await toBlob(node, opts);
      if (!b) throw new Error("no blob");
      return b;
    })(), 15000);
    try {
      // ClipboardItem-with-Promise: Chrome/Edge/Safari. Firefox lacks it
      // and lands in the catch with the Download fallback hint.
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blobPromise }),
      ]);
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // NotAllowedError / missing ClipboardItem → browser support issue.
      // Anything else is a render failure worth seeing.
      const isSupport = /NotAllowed|ClipboardItem|not defined|clipboard/i.test(msg);
      setError(isSupport ? "Copy not supported here. Use Download instead." : `Copy failed: ${msg.slice(0, 70)}`);
      console.warn("[shareable] copy failed", e);
    } finally {
      setBusy(false);
    }
  }, []);

  // Portal to <body>. CRITICAL: the modal is rendered inside the wrapped
  // card, and ancestors like .chart-card-v2 use backdrop-filter, which
  // establishes a containing block for position:fixed - without the
  // portal the "fixed" overlay is positioned relative to the card (low
  // on the page, cut off) instead of the viewport, hiding the action
  // buttons. Portaling to body escapes any such ancestor.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="share-overlay" data-theme="dark" onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        className="share-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Share ${title}`}
        aria-busy={busy}
        tabIndex={-1}
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
            // Always export the dark-themed card regardless of the page
            // theme, so shared images have one consistent look. The
            // data-theme="dark" attribute activates every [data-theme=
            // "dark"] rule + variable within this subtree.
            data-theme="dark"
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
              <span className="share-card-brand-name">All in ONE</span>
              <span className="share-card-brand-icon"><TxIcon /></span>
              <span className="share-card-domain">tx.silknodes.io</span>
              <span className="share-card-stamp">{todayStamp}</span>
            </div>
          </div>
        </div>

        <footer className="share-dialog-actions">
          <span className="share-dialog-status" role="status" aria-live="polite">
            {error ? <span className="share-dialog-error">{error}</span> : copied ? "Copied to clipboard" : ""}
          </span>
          <button type="button" className="share-btn-secondary" onClick={handleCopy} disabled={busy}>
            {copied ? "Copied" : "Copy"}
          </button>
          <button type="button" className="share-btn-primary" onClick={handleDownload} disabled={busy}>
            {busy ? "Rendering…" : "Download PNG"}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

// ─── Inline marks ──────────────────────────────────────────────────────
// The real tx-icon, inlined so the export is fully self-contained (no
// external <img> fetch for html-to-image to race or taint). Matches
// public/tx-icon.svg: dark-green tile + neon "tx" glyph.
function TxIcon() {
  return (
    <svg viewBox="0 0 501 501" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="500" height="500" transform="translate(0.710938 0.205078)" fill="#0F1B07" />
      <path
        d="M157.384 199.256H212.833V236.026H157.384V282.646C157.384 292.861 165.659 301.15 175.87 301.155H212.833V338.169H175.869C145.256 338.169 120.433 313.327 120.412 282.673V236.026H83.5869V199.256H120.412V162.704H157.384V199.256ZM219.386 199.256C235.511 199.256 250.362 204.782 262.136 214.042L298.896 241.601C304.652 245.837 309.138 249.451 316.99 249.451C324.866 249.451 329.391 245.809 335.136 241.544L372.101 213.611C383.781 204.61 398.42 199.256 414.299 199.256H416.92V236.027H414.299C406.562 236.027 399.715 239.196 393.458 243.588L361.105 268.436L387.696 288.787C395.611 294.837 403.677 301.143 414.299 301.143H416.92V337.919H414.299C398.167 337.919 383.322 332.394 371.547 323.127L335.037 294.896C329.398 290.59 324.779 286.957 316.99 286.957C308.986 286.957 304.249 290.818 298.473 295.207L262.137 323.127C250.363 332.386 235.518 337.919 219.386 337.919H216.765V301.143H219.386C227.186 301.143 234.217 298.182 240.147 293.649L272.593 268.72L240.163 243.543C234.06 239.075 227.141 236.027 219.386 236.027H216.765V199.256H219.386Z"
        fill="#B1FC03"
      />
    </svg>
  );
}
function CameraIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}
// Reject if a render takes longer than ms so the button never hangs
// silently on a stuck font/image fetch - surfaces a visible error.
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
