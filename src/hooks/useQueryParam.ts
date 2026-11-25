"use client";

// One query parameter, read and written without a router hook.
//
// Read through useSyncExternalStore so the server render (no query) and the
// first client render agree, and so a change arrives without an effect.
// useSearchParams would do the same job but forces a Suspense boundary on
// every page that renders through HomePage.
//
// Writing uses the native history API, which the Next router integrates with
// (docs: linking-and-navigating, "Native History API"). pushState fires no
// event of its own, so pushQueryParam announces the change itself; popstate
// covers the back and forward buttons.

import { useSyncExternalStore } from "react";

const URL_EVENT = "silk:urlchange";

function subscribe(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  window.addEventListener(URL_EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(URL_EVENT, onChange);
  };
}

export function useQueryParam(name: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => new URLSearchParams(window.location.search).get(name),
    () => null,
  );
}

/** Set one query parameter (null clears it), keeping the rest, as a new history entry. */
export function pushQueryParam(name: string, value: string | null) {
  const u = new URL(window.location.href);
  if (value === null) u.searchParams.delete(name);
  else u.searchParams.set(name, value);
  window.history.pushState(null, "", `${u.pathname}${u.search}${u.hash}`);
  window.dispatchEvent(new Event(URL_EVENT));
}
