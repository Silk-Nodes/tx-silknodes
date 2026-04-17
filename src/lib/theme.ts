// Theme system for tx.silknodes.io
//
// Three themes planned:
//   light — current green+neon palette (DEFAULT)
//   warm  — Claude-style cream + terracotta (Phase 2)
//   dark  — alpha.silknodes-style earthy dark (Phase 1)
//
// The active theme is persisted in localStorage under STORAGE_KEY.
// First-time visitors with system-level dark mode get 'dark'; others get 'light'.
// Applied as a `data-theme` attribute on the <html> element so CSS rules like
// `:root[data-theme='dark'] { ... }` can override variables.

export type Theme = "light" | "warm" | "dark";

export const THEMES: Theme[] = ["light", "warm", "dark"];
export const DEFAULT_THEME: Theme = "light";
export const STORAGE_KEY = "silknodes-theme";

export function isValidTheme(value: unknown): value is Theme {
  return value === "light" || value === "warm" || value === "dark";
}

/**
 * Returns the theme that should be applied on first paint.
 * Reads localStorage, falls back to `prefers-color-scheme` for new visitors.
 * This function runs both server-side (returns default) and client-side.
 */
export function resolveInitialTheme(): Theme {
  if (typeof window === "undefined") return DEFAULT_THEME;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isValidTheme(stored)) return stored;
  } catch {
    // localStorage may be disabled (private window, etc.) — fall through.
  }
  const prefersDark =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : DEFAULT_THEME;
}

/**
 * Inline script source — injected into <head> to apply the theme BEFORE first
 * paint. Running after React hydration would flash the default theme for
 * ~100ms, which is visible and ugly. This runs before any React code.
 *
 * Kept as a string so we can embed via dangerouslySetInnerHTML in layout.tsx.
 * Mirrors the logic in resolveInitialTheme() but in vanilla JS.
 */
export const NO_FLASH_SCRIPT = `
(function() {
  try {
    var stored = localStorage.getItem('${STORAGE_KEY}');
    var theme;
    if (stored === 'light' || stored === 'warm' || stored === 'dark') {
      theme = stored;
    } else {
      var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      theme = prefersDark ? 'dark' : '${DEFAULT_THEME}';
    }
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', '${DEFAULT_THEME}');
  }
})();
`.trim();
