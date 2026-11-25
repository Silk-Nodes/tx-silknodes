"use client";

// The one minute page films, each in two places:
//   FilmPopup    once per visitor on /today, until the film's end date
//   FilmButton   on the page the film is about, any time
//
// A film is a 720p file of about 2 MB under /public/media, fetched only when
// the dialog opens (preload="none" and nothing mounted before that). They
// have no audio, so they autoplay muted; with reduced motion they wait for
// play. Only one film is announced on /today at a time: the newest.

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useFocusTrap } from "@/hooks/useFocusTrap";

export interface Film {
  src: string;
  poster: string;
  /** The /today popup stops after this. The page button has no end date. */
  until: string;
  seenKey: string;
  title: string;
  sub: string;
  href: string;
  cta: string;
  cardTitle: string;
}

export const STABLECOINS_FILM: Film = {
  src: "/media/stablecoins-film.mp4",
  poster: "/media/stablecoins-film-poster.jpg",
  until: "2026-10-31T23:59:59Z",
  seenKey: "stablecoins-film-v1",
  title: "Stablecoins, new on ALL in ONE TX",
  sub: "Every dollar on tx, recorded before USTX mints.",
  href: "/stablecoins",
  cta: "Open Stablecoins",
  cardTitle: "New: Stablecoins",
};

// Figures in this film were read from the chain on 2026-11-18 and are dated
// on screen. Source: the EarnFilm composition and cap-earn.mjs.
export const EARN_FILM: Film = {
  src: "/media/earn-film.mp4",
  poster: "/media/earn-film-poster.jpg",
  until: "2026-12-02T23:59:59Z",
  seenKey: "earn-film-v1",
  title: "Earn, new on ALL in ONE TX",
  sub: "Staking rewards after commission, and the USTX vault.",
  href: "/earn",
  cta: "Open Earn",
  cardTitle: "New: Earn",
};

const DELAY_MS = 3000;

function seen(film: Film): boolean {
  try { return localStorage.getItem(film.seenKey) === "1"; } catch { return false; }
}
function markSeen(film: Film) {
  try { localStorage.setItem(film.seenKey, "1"); } catch { /* storage blocked */ }
}

const noop = () => () => {};
const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function FilmDialog({ film, onClose, showCta }: { film: Film; onClose: () => void; showCta: boolean }) {
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
          src={film.src}
          poster={film.poster}
          preload="none"
          muted
          playsInline
          loop
          autoPlay={!still}
          controls
        />
        <div className="film-foot">
          <div>
            <div id="film-title" className="film-title">{film.title}</div>
            <div className="film-sub">{film.sub}</div>
          </div>
          {showCta && (
            <Link href={film.href} className="film-cta" onClick={onClose}>{film.cta}</Link>
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
export function FilmPopup({ film, ready }: { film: Film; ready: boolean }) {
  const [stage, setStage] = useState<"idle" | "card" | "dialog" | "done">("idle");

  useEffect(() => {
    if (!ready || stage !== "idle") return;
    if (Date.now() > Date.parse(film.until) || seen(film)) return;
    const t = window.setTimeout(() => {
      setStage(window.matchMedia("(max-width: 768px)").matches ? "card" : "dialog");
    }, DELAY_MS);
    return () => clearTimeout(t);
  }, [ready, stage, film]);

  const close = () => { markSeen(film); setStage("done"); };

  if (stage === "dialog") return <FilmDialog film={film} onClose={close} showCta />;
  if (stage !== "card") return null;
  return createPortal(
    <div className="film-card" role="dialog" aria-label={film.title}>
      <button type="button" className="film-card-open" onClick={() => setStage("dialog")}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={film.poster} alt="" width={96} height={54} />
        <span>
          <span className="film-card-title">{film.cardTitle}</span>
          <span className="film-card-sub">Watch the 1 min film</span>
        </span>
      </button>
      <button type="button" className="film-card-close" aria-label="Dismiss" onClick={close}>✕</button>
    </div>,
    document.body,
  );
}

/** For the header of the page the film is about. No end date, no seen flag. */
export function FilmButton({ film = STABLECOINS_FILM }: { film?: Film }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="film-button" onClick={() => setOpen(true)}>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.5v9l7.5-4.5z" fill="currentColor" /></svg>
        Watch the 1 min film
      </button>
      {open && <FilmDialog film={film} onClose={() => setOpen(false)} showCta={false} />}
    </>
  );
}
