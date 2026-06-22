// Small shared formatting helpers used across the Today / share UI.
// Consolidated so relative-time and compact-number logic lives in one
// place instead of being re-implemented (slightly differently) per file.

/**
 * Compact number with K/M/B suffixes. Sign-safe: negatives keep their
 * minus and are abbreviated by magnitude (e.g. -1.2M), so callers don't
 * have to wrap with Math.abs.
 */
export function formatCompact(n: number, decimals = { k: 1, m: 2, b: 2 }): string {
  if (!Number.isFinite(n)) return "-";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(decimals.b)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(decimals.m)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(decimals.k)}K`;
  return `${sign}${abs.toFixed(0)}`;
}

/**
 * Short relative time ("just now", "5m ago", "3h ago", "2d ago",
 * "4mo ago") from an ISO string or epoch ms. Future timestamps return
 * "scheduled". Months use a /30 approximation by design.
 */
export function relativeTimeShort(input: string | number): string {
  const ms = typeof input === "number" ? input : new Date(input).getTime();
  if (!Number.isFinite(ms) || ms === 0) return "";
  const diff = Date.now() - ms;
  if (diff < 0) return "scheduled";
  const days = Math.floor(diff / 86_400_000);
  if (days >= 30) return `${Math.floor(days / 30)}mo ago`;
  if (days > 0) return `${days}d ago`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours > 0) return `${hours}h ago`;
  const mins = Math.floor(diff / 60_000);
  if (mins > 0) return `${mins}m ago`;
  return "just now";
}
