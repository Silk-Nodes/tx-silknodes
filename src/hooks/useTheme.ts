"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_THEME, STORAGE_KEY, isValidTheme, type Theme } from "@/lib/theme";

/**
 * Reads the current theme from the <html data-theme> attribute that was set
 * by the no-flash script in layout.tsx, and provides a setter that:
 *   1. Updates the attribute (instant visual change via CSS variables)
 *   2. Persists to localStorage for future visits
 *   3. Broadcasts to other tabs via the `storage` event
 */
export function useTheme(): [Theme, (theme: Theme) => void] {
  // Initialize synchronously from the <html data-theme> the no-flash script
  // already set, so the very first render matches the real theme. This
  // matters because the nav (and ThemeSwitcher) remounts on every tab
  // navigation: if we started at DEFAULT and corrected in an effect, the
  // switcher thumb would slide on each remount. Reading it here means no
  // flip, so no spurious animation. (On the server document is undefined,
  // so SSR falls back to DEFAULT_THEME.)
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof document !== "undefined") {
      const attr = document.documentElement.getAttribute("data-theme");
      if (isValidTheme(attr)) return attr;
    }
    return DEFAULT_THEME;
  });

  // Keep listening for cross-tab changes (and re-sync once on mount as a
  // belt-and-braces against any attribute set after first paint).
  useEffect(() => {
    const attr = document.documentElement.getAttribute("data-theme");
    if (isValidTheme(attr)) setThemeState(attr);

    // Listen for changes in other tabs and apply them here too.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      if (isValidTheme(e.newValue)) {
        document.documentElement.setAttribute("data-theme", e.newValue);
        setThemeState(e.newValue);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage may be disabled — theme still applies for this session.
    }
    setThemeState(next);
  }, []);

  return [theme, setTheme];
}
