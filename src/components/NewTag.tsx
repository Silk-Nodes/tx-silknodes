"use client";

// A NEW tag for a nav entry with an end date. It shows for everyone until
// `until`, visited or not. The sweep plays once per browser.

import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

function subscribe(l: () => void) {
  listeners.add(l);
  window.addEventListener("storage", l);
  return () => { listeners.delete(l); window.removeEventListener("storage", l); };
}

/** True until the end date. */
export function isNew(until: string): boolean {
  return Date.now() < Date.parse(until);
}

// The sweep plays the first time a browser shows the tag, not on every
// load: replayed on each refresh it reads as the tag dropping in again.
const SWEPT = "nav-new-swept";
function readSwept(): boolean {
  try { return localStorage.getItem(SWEPT) === "1"; } catch { return true; }
}

export default function NewTag() {
  const swept = useSyncExternalStore(subscribe, readSwept, () => true);
  return (
    <span
      className={`new-tag ${swept ? "" : "new-tag-sweep"}`}
      aria-label="new"
      onAnimationEnd={() => {
        try { localStorage.setItem(SWEPT, "1"); } catch { /* storage blocked */ }
        listeners.forEach((l) => l());
      }}
    >
      NEW
    </span>
  );
}
