"use client";

// The loading card for /stablecoins, /analytics and /passport.
//
// Shown at most once a day per page, and only if the data takes longer than
// SHOW_AFTER_MS, so a fast load never shows it. The page's skeleton stays
// visible, blurred, behind it.
//
// It does not vanish when the page is ready: it says so ("Page is ready",
// the bar fills, the blur eases so the finished page shows through) and
// offers a "Show the page" button, so anyone reading a tip can finish it or
// keep browsing tips. A click outside the card, Escape or the close button
// also dismisses it, and "Don't show tips" turns it off in this browser.
//
// Hints come from /api/hints (lib/hints): this page's own first, live ones
// before standing facts. A visitor is not shown the same hint twice until
// they have seen them all.
//
// Outside production, ?hints=demo opens it at once and turns it to ready
// after DEMO_READY_MS, ignoring the daily limit, for checking on a fast
// local server.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";

type HintPage = "stablecoins" | "analytics" | "passport";
interface Hint { id: string; kind: "live" | "learn"; title: string; body: string; cta?: { label: string; href: string } }

const SHOW_AFTER_MS = 700;
const DEMO_READY_MS = 3_000;
const OFF_KEY = "tx-hints-off";
const CHANGE_EVENT = "tx-hints-change";
const UNDO_MS = 6_000;

function setTipsOff(off: boolean) {
  try { if (off) localStorage.setItem(OFF_KEY, "1"); else localStorage.removeItem(OFF_KEY); } catch { /* storage blocked */ }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
function tipsOff(): boolean {
  try { return localStorage.getItem(OFF_KEY) === "1"; } catch { return false; }
}
const FADE_MS = 220;
const SEEN_KEY = "tx-hints-seen";

const STYLES = `
  .lh-layer { position: fixed; left: 0; right: 0; bottom: 0; top: var(--nav-bottom, 70px); z-index: 900;
    display: flex; align-items: center; justify-content: center; padding: 16px;
    background: color-mix(in srgb, var(--nav-solid-bg) 35%, transparent);
    -webkit-backdrop-filter: blur(7px); backdrop-filter: blur(7px);
    animation: lh-in 200ms ease-out both; }
  .lh-layer.closing { animation: lh-out ${FADE_MS}ms ease-in both; }
  @keyframes lh-in { from { opacity: 0; } to { opacity: 1; } }
  @keyframes lh-out { from { opacity: 1; } to { opacity: 0; } }
  .lh-card { position: relative; width: 100%; max-width: 470px; padding: 24px 26px 22px; border-radius: 22px;
    background: var(--nav-solid-bg); border: 1px solid var(--glass-border); box-shadow: 0 24px 60px rgba(0,0,0,0.28);
    animation: lh-rise 260ms cubic-bezier(.2,.8,.2,1) both; }
  @keyframes lh-rise { from { transform: translateY(14px) scale(0.98); opacity: 0; } to { transform: none; opacity: 1; } }
  .lh-top { display: flex; align-items: center; gap: 10px; font-family: var(--font-mono); font-size: 0.74rem; color: var(--text-light); padding-right: 30px; }
  .lh-bar { flex: 1; height: 3px; border-radius: 2px; background: rgba(128,128,128,0.2); overflow: hidden; position: relative; }
  .lh-bar i { position: absolute; top: 0; bottom: 0; width: 38%; border-radius: 2px; background: var(--brand-accent); animation: lh-slide 1.1s ease-in-out infinite; }
  @keyframes lh-slide { from { left: -38%; } to { left: 100%; } }
  .lh-tag { display: inline-block; margin-top: 18px; font-family: var(--font-mono); font-size: 0.7rem; font-weight: 700; letter-spacing: 0.06em;
    text-transform: uppercase; padding: 2px 9px; border-radius: 999px; color: var(--text-dark);
    background: color-mix(in srgb, var(--brand-accent) 30%, transparent); }
  .lh-tag.learn { background: rgba(128,128,128,0.18); }
  .lh-title { margin-top: 10px; font-size: 1.2rem; font-weight: 800; line-height: 1.3; color: var(--text-dark); letter-spacing: -0.2px; }
  .lh-body { margin-top: 8px; font-size: 0.92rem; line-height: 1.55; color: var(--text-medium, var(--text-dark)); }
  .lh-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 18px; margin-top: 18px; }
  .lh-cta { display: inline-flex; align-items: center; gap: 6px; font-size: 0.86rem; font-weight: 700; color: var(--text-accent); text-decoration: none; }
  .lh-cta:hover span { text-decoration: underline; text-underline-offset: 3px; }
  .lh-cta svg { transition: transform 150ms ease; }
  .lh-cta:hover svg { transform: translateX(2px); }
  .lh-pager { margin-left: auto; display: inline-flex; align-items: center; gap: 4px; padding: 3px; border-radius: 999px; border: 1px solid var(--glass-border); }
  .lh-pg { width: 30px; height: 30px; border-radius: 50%; border: 0; background: transparent; color: var(--text-dark); cursor: pointer;
    display: inline-flex; align-items: center; justify-content: center; }
  .lh-pg:hover { background: color-mix(in srgb, var(--brand-accent) 22%, transparent); }
  .lh-pg:focus-visible { outline: 2px solid var(--brand-accent); outline-offset: 1px; }
  .lh-count { min-width: 44px; text-align: center; font-family: var(--font-mono); font-size: 0.76rem; color: var(--text-light); }
  .lh-count b { color: var(--text-dark); font-weight: 700; }
  .lh-tip { animation: lh-tip 180ms ease-out both; }
  @keyframes lh-tip { from { opacity: 0; transform: translateX(8px); } to { opacity: 1; transform: none; } }
  .lh-close { position: absolute; top: 14px; right: 14px; width: 30px; height: 30px; border-radius: 50%; border: 1px solid var(--glass-border);
    background: transparent; color: var(--text-dark); cursor: pointer; font-size: 0.85rem; line-height: 1; }
  .lh-layer.ready { -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px);
    background: color-mix(in srgb, var(--nav-solid-bg) 15%, transparent); transition: backdrop-filter 400ms ease, background 400ms ease; }
  .lh-top .lh-ok { color: var(--text-dark); font-weight: 700; }
  .lh-bar.full i { animation: none; left: 0; width: 100%; }
  .lh-go { display: inline-flex; align-items: center; gap: 8px; padding: 9px 18px; border-radius: 999px; border: 0; cursor: pointer;
    background: var(--brand-accent); color: #101208; font-weight: 800; font-size: 0.9rem; animation: lh-pulse 900ms ease-out 1; }
  .lh-go:focus-visible { outline: 2px solid var(--text-dark); outline-offset: 2px; }
  @keyframes lh-pulse { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--brand-accent) 70%, transparent); } 100% { box-shadow: 0 0 0 14px transparent; } }
  .lh-foot { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--glass-border); min-height: 49px; }
  .lh-off { display: inline-flex; align-items: center; gap: 6px; background: none; border: 0; padding: 4px 0; cursor: pointer; font-size: 0.76rem; color: var(--text-light); }
  .lh-off:hover { color: var(--text-dark); }
  .lh-off:focus-visible { outline: 2px solid var(--brand-accent); outline-offset: 2px; border-radius: 4px; }
  .lh-toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 1001; display: flex; align-items: center; gap: 14px;
    padding: 10px 12px 10px 18px; border-radius: 999px; background: var(--nav-solid-bg); border: 1px solid var(--glass-border);
    box-shadow: 0 12px 30px rgba(0,0,0,0.25); font-size: 0.86rem; color: var(--text-dark); animation: lh-in 200ms ease-out both; white-space: nowrap; }
  .lh-undo { border: 0; border-radius: 999px; padding: 6px 14px; cursor: pointer; font-weight: 800; font-size: 0.82rem; background: var(--brand-accent); color: #101208; }
  .lh-undo:focus-visible { outline: 2px solid var(--text-dark); outline-offset: 2px; }
  .lh-placeholder { margin-top: 18px; font-size: 0.92rem; color: var(--text-light); }
  @media (prefers-reduced-motion: reduce) {
    .lh-layer, .lh-layer.closing, .lh-card { animation: none; }
    .lh-bar i { animation: none; left: 0; width: 100%; opacity: 0.5; }
    .lh-go, .lh-tip { animation: none; }
    .lh-cta svg { transition: none; }
    .lh-layer.ready { transition: none; }
  }
`;

function readSeen(): string[] {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || "[]"); } catch { return []; }
}
function markSeen(id: string) {
  try {
    const seen = readSeen().filter((x) => x !== id);
    seen.push(id);
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen.slice(-60)));
  } catch { /* storage blocked */ }
}
/** Live hints before learn ones; unseen before seen; start over once all are seen. */
function order(hints: Hint[]): Hint[] {
  const seen = new Set(readSeen());
  const rank = (h: Hint) => (seen.has(h.id) ? 2 : 0) + (h.kind === "live" ? 0 : 1);
  return [...hints].sort((a, b) => rank(a) - rank(b));
}

const today = () => new Date().toISOString().slice(0, 10);

const Chevron = ({ dir }: { dir: "left" | "right" }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <path d={dir === "left" ? "M8.5 3 4.5 7l4 4" : "M5.5 3l4 4-4 4"} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Arrow = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <path d="M2.5 7h8.5M7.5 3.5 11 7l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const EyeOff = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2 8s2.2-4.5 6-4.5S14 8 14 8s-.8 1.6-2.3 2.9M9.7 11.9A5 5 0 0 1 8 12.5C4.2 12.5 2 8 2 8a10 10 0 0 1 1.9-2.6M6.6 6.6a2 2 0 0 0 2.8 2.8M2.5 2.5l11 11"
      fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default function LoadingHints({ page, ready }: { page: HintPage; ready: boolean }) {
  const [state, setState] = useState<"idle" | "open" | "closing" | "done">("idle");
  const [isReady, setIsReady] = useState(false);
  const [undo, setUndo] = useState(false);
  const [hints, setHints] = useState<Hint[]>([]);
  const [i, setI] = useState(0);
  const demo = useRef(false);

  // Decide once, on mount: not turned off, not shown for this page today
  // (or demo).
  useEffect(() => {
    demo.current = process.env.NODE_ENV !== "production" && new URLSearchParams(window.location.search).get("hints") === "demo";
    let allowed = true;
    try {
      allowed = !tipsOff() && localStorage.getItem(`tx-hints-day-${page}`) !== today();
    } catch { /* storage blocked: show it */ }
    if (!allowed && !demo.current) { setState("done"); return; }

    let alive = true;
    fetch(`/api/hints?page=${page}`)
      .then((r) => (r.ok ? r.json() : { hints: [] }))
      .then((j: { hints?: Hint[] }) => { if (alive) setHints(order(j.hints ?? [])); })
      .catch(() => {});
    const t = window.setTimeout(() => {
      if (!alive) return;
      setState((s) => (s === "idle" ? "open" : s));
      try { localStorage.setItem(`tx-hints-day-${page}`, today()); } catch { /* storage blocked */ }
    }, demo.current ? 0 : SHOW_AFTER_MS);
    const d = demo.current ? window.setTimeout(() => alive && setIsReady(true), DEMO_READY_MS) : 0;
    return () => { alive = false; clearTimeout(t); clearTimeout(d); };
  }, [page]);

  // The page is ready: if the card never opened, it never will; if it is
  // open, it switches to its ready state and waits for the reader.
  useEffect(() => {
    if (!ready || demo.current) return;
    setIsReady(true);
    setState((s) => (s === "idle" ? "done" : s));
  }, [ready]);

  useEffect(() => {
    if (state !== "closing") return;
    const t = window.setTimeout(() => setState("done"), FADE_MS);
    return () => clearTimeout(t);
  }, [state]);

  const close = () => setState((s) => (s === "open" ? "closing" : s));
  const hideTips = () => { setTipsOff(true); close(); setUndo(true); };

  useEffect(() => {
    if (!undo) return;
    const t = window.setTimeout(() => setUndo(false), UNDO_MS);
    return () => clearTimeout(t);
  }, [undo]);

  const idx = hints.length ? ((i % hints.length) + hints.length) % hints.length : 0;
  const hint = hints.length ? hints[idx] : null;
  useEffect(() => {
    if (state === "open" && hint) markSeen(hint.id);
  }, [state, hint]);

  useEffect(() => {
    if (state !== "open") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") setI((x) => x + 1);
      else if (e.key === "ArrowLeft") setI((x) => x - 1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [state]);

  if (state !== "open" && state !== "closing") {
    // After "Hide tips": a few seconds to take it back. Later, the footer's
    // TipsToggle turns them on again.
    return undo
      ? createPortal(
          <div className="lh-toast" role="status">
            <style>{STYLES}</style>
            <span>Tips are hidden.</span>
            <button type="button" className="lh-undo" onClick={() => { setTipsOff(false); setUndo(false); }}>Undo</button>
          </div>,
          document.body,
        )
      : null;
  }
  // Portalled to <body>, like the stablecoins film dialog: inside a page
  // container its z-index was scoped. Just under the nav (z-index 1000).
  return createPortal(
    <div
      className={`lh-layer ${isReady ? "ready" : ""} ${state === "closing" ? "closing" : ""}`}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <style>{STYLES}</style>
      <div className="lh-card" role="status" aria-live="polite">
        <button type="button" className="lh-close" aria-label="Close tips and show the page" onClick={close}>✕</button>
        <div className="lh-top">
          {isReady ? <span className="lh-ok">Page is ready</span> : <span>Reading the chain</span>}
          <span className={`lh-bar ${isReady ? "full" : ""}`} aria-hidden="true"><i /></span>
        </div>
        {hint ? (
          <>
            <div className="lh-tip" key={hint.id}>
              <span className={`lh-tag ${hint.kind === "learn" ? "learn" : ""}`}>{hint.kind === "live" ? "Live now" : "Did you know"}</span>
              <div className="lh-title">{hint.title}</div>
              <p className="lh-body" style={{ margin: "8px 0 0" }}>{hint.body}</p>
            </div>
            <div className="lh-actions">
              {hint.cta && (
                <Link href={hint.cta.href} className="lh-cta" onClick={close}><span>{hint.cta.label}</span><Arrow /></Link>
              )}
              {hints.length > 1 && (
                <div className="lh-pager" role="group" aria-label="Tips">
                  <button type="button" className="lh-pg" aria-label="Previous tip" onClick={() => setI((x) => x - 1)}><Chevron dir="left" /></button>
                  <span className="lh-count" aria-live="polite"><b>{idx + 1}</b> / {hints.length}</span>
                  <button type="button" className="lh-pg" aria-label="Next tip" onClick={() => setI((x) => x + 1)}><Chevron dir="right" /></button>
                </div>
              )}
            </div>
          </>
        ) : (
          <p className="lh-placeholder" style={{ marginBottom: 0 }}>Every number on this page is read live from the TX chain.</p>
        )}
        <div className="lh-foot">
          <button
            type="button"
            className="lh-off"
            onClick={hideTips}
          >
            <EyeOff />Hide tips
          </button>
          {isReady && <button type="button" className="lh-go" onClick={close} autoFocus>Show the page</button>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * For the site footer. Shows only while tips are hidden, and turns them back
 * on. Without it, "Hide tips" could only be undone by clearing site data.
 */
export function TipsToggle() {
  const [off, setOff] = useState(false);
  useEffect(() => {
    const read = () => setOff(tipsOff());
    read();
    window.addEventListener(CHANGE_EVENT, read);
    window.addEventListener("storage", read);
    return () => { window.removeEventListener(CHANGE_EVENT, read); window.removeEventListener("storage", read); };
  }, []);
  if (!off) return null;
  return (
    <button type="button" className="footer-tips" onClick={() => setTipsOff(false)}>
      Show loading tips
    </button>
  );
}
