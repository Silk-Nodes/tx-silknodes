export type StakingEventType = "delegate" | "undelegate" | "redelegate";

export interface StakingEvent {
  type: StakingEventType;
  timestamp: string;
  height: number;
  delegator: string;
  validator: string;
  sourceValidator?: string;
  destinationValidator?: string;
  amount: number;
  txHash: string;
}

export interface StakingEventsData {
  updatedAt: string;
  validators: Record<string, string>;
  events: StakingEvent[];
}

export type FeedTier = "all" | "5k_10k" | "10k_100k" | "100k_1m" | "1m_plus";

export const FEED_TIERS: FeedTier[] = ["all", "5k_10k", "10k_100k", "100k_1m", "1m_plus"];

export const TIER_LABELS: Record<FeedTier, string> = {
  all: "All",
  "5k_10k": "5K to 10K",
  "10k_100k": "10K to 100K",
  "100k_1m": "100K to 1M",
  "1m_plus": "1M+",
};

const TIER_RANGES: Record<FeedTier, [number, number]> = {
  all: [5_000, Infinity],
  "5k_10k": [5_000, 10_000],
  "10k_100k": [10_000, 100_000],
  "100k_1m": [100_000, 1_000_000],
  "1m_plus": [1_000_000, Infinity],
};

export function filterByTier(events: StakingEvent[], tier: FeedTier): StakingEvent[] {
  const [min, max] = TIER_RANGES[tier];
  return events.filter((e) => e.amount >= min && e.amount < max);
}

// Amount formatting (K, M, with decimals)
export function formatEventAmount(amount: number): string {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 100_000) return `${Math.round(amount / 1_000)}K`;
  if (amount >= 10_000) return `${(amount / 1_000).toFixed(1)}K`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(2)}K`;
  return amount.toFixed(0);
}

// "2 min ago", "3 hours ago", etc.
export function formatRelativeTime(timestamp: string, now = Date.now()): string {
  const diff = Math.floor((now - new Date(timestamp).getTime()) / 1000);
  if (diff < 10) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  const days = Math.floor(diff / 86400);
  return `${days}d ago`;
}

// HH:MM:SS local time
export function formatEventTime(timestamp: string): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

// Full timestamp like "April 15, 2026 at 10:30:45 AM"
export function formatFullTimestamp(timestamp: string): string {
  const d = new Date(timestamp);
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function truncateAddress(addr: string, start = 7, end = 4): string {
  if (addr.length <= start + end + 3) return addr;
  return `${addr.slice(0, start)}...${addr.slice(-end)}`;
}

export function isWhaleEvent(event: StakingEvent): boolean {
  return event.amount >= 1_000_000;
}

export function resolveValidator(address: string, validators: Record<string, string>): string {
  return validators[address] || truncateAddress(address, 12, 4);
}

// Mintscan explorer URL for a tx
export function txExplorerUrl(hash: string): string {
  return `https://www.mintscan.io/coreum/tx/${hash}`;
}

// Silk Nodes validator page URL (if we had one), fallback to Mintscan
export function validatorUrl(operatorAddress: string): string {
  return `https://www.mintscan.io/coreum/validators/${operatorAddress}`;
}
