"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_THEME, STORAGE_KEY, isValidTheme, resolveInitialTheme, type Theme } from "@/lib/theme";

// The theme lives on <html data-theme>, written before first paint by the
// no-flash script in layout.tsx. This hook reads that attribute as an external
// store instead of copying it into React state.
//
// It used to seed useState from the attribute. The server has no document and
// rendered the default (light), while the client's first render already saw
// "dark", so the switcher's attributes disagreed during hydration. React does
// not patch attribute mismatches, so the switch could stay on the wrong state.
//
// useSyncExternalStore takes a server snapshot for exactly this case: the
// hydrating render uses it and matches the server HTML, then React re-renders
// with the real value as an ordinary update. A mount after a client-side
// navigation is not hydrating and reads the real value on its first render.

const listeners = new Set<() => void>();

function readTheme(): Theme {
  const attr = document.documentElement.getAttribute("data-theme");
  return isValidTheme(attr) ? attr : DEFAULT_THEME;
}

function serverTheme(): Theme {
  return DEFAULT_THEME;
}

function applyTheme(next: Theme) {
  if (document.documentElement.getAttribute("data-theme") !== next) {
    document.documentElement.setAttribute("data-theme", next);
  }
  listeners.forEach((l) => l());
}

// Re-resolve from the same source of truth the no-flash script uses (stored
// choice, else system preference) and apply it. A stored choice always wins,
// so this never overrides a theme the user picked.
function syncTheme() {
  applyTheme(resolveInitialTheme());
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);

  // Re-assert the attribute on mount. If <html data-theme> is missing or wrong
  // after hydration, nothing else would write it back: the switcher would show
  // one theme while the CSS fell through to the :root defaults, which is the
  // "moon selected but a light page" desync layout.tsx warns about. When the
  // attribute is already right this writes nothing.
  syncTheme();

  // A choice made (or cleared) in another tab.
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) syncTheme();
  };
  window.addEventListener("storage", onStorage);

  // "Match system" mode is no stored choice. In that mode follow the OS live:
  // if the user flips their system light/dark while the tab is open, update
  // instead of staying on the value from page load.
  const mq =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null;
  mq?.addEventListener("change", syncTheme);

  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
    mq?.removeEventListener("change", syncTheme);
  };
}

function setTheme(next: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // localStorage may be disabled. The theme still applies for this session.
  }
  applyTheme(next);
}

/**
 * Returns the current theme and a setter that:
 *   1. Updates <html data-theme> (instant visual change via CSS variables)
 *   2. Persists to localStorage for future visits
 *   3. Reaches other tabs through the `storage` event
 */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, readTheme, serverTheme);
  return [theme, setTheme];
}
