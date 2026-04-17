"use client";

import { useTheme } from "@/hooks/useTheme";
import type { Theme } from "@/lib/theme";

// Compact icon trio in the top nav. Currently Phase 1 ships Light + Dark.
// The "warm" option is listed here but rendered as disabled with a
// "coming in Phase 2" tooltip so its slot is visually reserved.
const BUTTONS: { theme: Theme; icon: string; label: string; available: boolean }[] = [
  { theme: "light", icon: "☀️", label: "Light", available: true },
  { theme: "warm", icon: "☕", label: "Warm (coming soon)", available: false },
  { theme: "dark", icon: "🌙", label: "Dark", available: true },
];

export default function ThemeSwitcher() {
  const [theme, setTheme] = useTheme();

  return (
    <div className="theme-switcher" role="group" aria-label="Theme">
      {BUTTONS.map((b) => {
        const active = theme === b.theme;
        return (
          <button
            key={b.theme}
            type="button"
            className={`theme-switcher-btn ${active ? "active" : ""} ${b.available ? "" : "disabled"}`}
            onClick={() => b.available && setTheme(b.theme)}
            disabled={!b.available}
            title={b.label}
            aria-label={b.label}
            aria-pressed={active}
          >
            <span aria-hidden="true">{b.icon}</span>
          </button>
        );
      })}
    </div>
  );
}
