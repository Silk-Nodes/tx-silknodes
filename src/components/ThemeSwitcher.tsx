"use client";

import { useTheme } from "@/hooks/useTheme";
import { STORAGE_KEY } from "@/lib/theme";

// Two-state Mac-style slider: sun ⇄ moon, with a tiny "match system" link
// underneath for users who want OS preference to drive it. Warm is still
// defined in the Theme type for Phase 2 but intentionally hidden here.
export default function ThemeSwitcher() {
  const [theme, setTheme] = useTheme();
  const isDark = theme === "dark";

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
        className={`theme-switcher ${isDark ? "is-dark" : "is-light"}`}
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
        title="Match system preference"
      >
        match system
      </button>
    </div>
  );
}
