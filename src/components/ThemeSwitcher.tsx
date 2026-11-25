"use client";

import { useTheme } from "@/hooks/useTheme";
import { STORAGE_KEY } from "@/lib/theme";

// Two-state Mac-style slider: sun ⇄ moon, with a small "auto" control beside
// it that hands control back to the OS preference. Warm is still defined in
// the Theme type for Phase 2 but intentionally hidden here.
//
// "auto" sits on the same baseline as the toggle rather than under it. It was
// the only second line of text in the header, which made the whole bar taller
// than it needed to be. It stays a real button: it performs an action, so it
// could not just become a tooltip.
export default function ThemeSwitcher() {
  const [theme, setTheme] = useTheme();
  const isDark = theme === "dark";

  // Only the aria state and the labels come from React. Where the thumb sits
  // and which icon is lit follow <html data-theme> in globals.css, the same
  // attribute the page colours follow. The no-flash script in layout.tsx sets
  // it before first paint, so the switch already looks right in the server
  // HTML, before hydration, and nothing moves on load or on a nav remount.

  const matchSystem = () => {
    const prefersDark =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    setTheme(prefersDark ? "dark" : "light");
    // Remove the explicit choice so future visits re-evaluate system pref
    // via the no-flash script in layout.tsx.
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  };

  return (
    <div className="theme-switcher-group">
      <button
        type="button"
        role="switch"
        aria-checked={isDark}
        aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
        title={isDark ? "Dark mode" : "Light mode"}
        className="theme-switcher"
        onClick={() => setTheme(isDark ? "light" : "dark")}
      >
        <span className="theme-switcher-icon is-left" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2" />
            <path d="M12 20v2" />
            <path d="m4.93 4.93 1.41 1.41" />
            <path d="m17.66 17.66 1.41 1.41" />
            <path d="M2 12h2" />
            <path d="M20 12h2" />
            <path d="m6.34 17.66-1.41 1.41" />
            <path d="m19.07 4.93-1.41 1.41" />
          </svg>
        </span>
        <span className="theme-switcher-icon is-right" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
          </svg>
        </span>
        <span className="theme-switcher-thumb" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="theme-switcher-system"
        onClick={matchSystem}
        title="Match your system theme"
      >
        auto
      </button>
    </div>
  );
}
