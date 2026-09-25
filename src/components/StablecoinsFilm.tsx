"use client";

// The one minute stablecoins film, in two places:
//   StablecoinsFilmPopup   once per visitor on /today, until the end date
//   FilmButton             on /stablecoins, any time
//
// The video is a 2 MB 720p file under /public/media, fetched only when the
// dialog opens (preload="none" and nothing mounted before that). It has no
// audio, so it autoplays muted; with reduced motion it waits for play.

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useFocusTrap } from "@/hooks/useFocusTrap";

const SRC = "/media/stablecoins-film.mp4";
const POSTER = "/media/stablecoins-film-poster.jpg";
const UNTIL = "2026-10-31T23:59:59Z";
const SEEN_KEY = "stablecoins-film-v1";
const DELAY_MS = 3000;

function seen(): boolean {
  try { return localStorage.getItem(SEEN_KEY) === "1"; } catch { return false; }
}
function markSeen() {
  try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* storage blocked */ }
}

const noop = () => () => {};
const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function FilmDialog({ onClose, showCta }: { onClose: () => void; showCta: boolean }) {
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  const still = useSyncExternalStore(noop, reducedMotion, () => true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="film-backdrop" onClick={onClose}>
      <div
        ref={trapRef}
        className="film-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="film-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="film-close" aria-label="Close" onClick={onClose}>✕</button>
        <video
          className="film-video"
          src={SRC}
          poster={POSTER}
          preload="none"
          muted
          playsInline
          loop
          autoPlay={!still}
          controls
        />
        <div className="film-foot">
          <div>
            <div id="film-title" className="film-title">Stablecoins, new on ALL in ONE TX</div>
            <div className="film-sub">Every dollar on tx, recorded before USTX mints.</div>
          </div>
          {showCta && (
            <Link href="/stablecoins" className="film-cta" onClick={onClose}>Open Stablecoins</Link>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Today only. Waits three seconds and for the cookie banner to be answered,
 * so it never stacks on top of it. Desktop opens the dialog; phones get a
 * small card first and the dialog on tap. Any close counts as seen.
 */
export function StablecoinsFilmPopup({ ready }: { ready: boolean }) {
  const [stage, setStage] = useState<"idle" | "card" | "dialog" | "done">("idle");

  useEffect(() => {
    if (!ready || stage !== "idle") return;
    if (Date.now() > Date.parse(UNTIL) || seen()) return;
    const t = window.setTimeout(() => {
      setStage(window.matchMedia("(max-width: 768px)").matches ? "card" : "dialog");
    }, DELAY_MS);
    return () => clearTimeout(t);
  }, [ready, stage]);

  const close = () => { markSeen(); setStage("done"); };

  if (stage === "dialog") return <FilmDialog onClose={close} showCta />;
  if (stage !== "card") return null;
  return createPortal(
    <div className="film-card" role="dialog" aria-label="Stablecoins film">
      <button type="button" className="film-card-open" onClick={() => setStage("dialog")}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={POSTER} alt="" width={96} height={54} />
        <span>
          <span className="film-card-title">New: Stablecoins</span>
          <span className="film-card-sub">Watch the 1 min film</span>
        </span>
      </button>
      <button type="button" className="film-card-close" aria-label="Dismiss" onClick={close}>✕</button>
    </div>,
    document.body,
  );
}

/** For the stablecoins page header. No end date, no seen flag. */
export function FilmButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="film-button" onClick={() => setOpen(true)}>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.5v9l7.5-4.5z" fill="currentColor" /></svg>
        Watch the 1 min film
      </button>
      {open && <FilmDialog onClose={() => setOpen(false)} showCta={false} />}
    </>
  );
}
