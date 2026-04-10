import type { DataPoint } from "./analytics-utils";
import { calcChange, getLatestValue, filterByTimeRange } from "./analytics-utils";

// ═══════════════════════════════════════════
// HEALTH SCORING
// ═══════════════════════════════════════════

export type HealthStatus = "healthy" | "neutral" | "risk";

interface HealthRule {
  metric: string;
  evaluate: (change: number | null, value: number) => HealthStatus;
  context: (change: number | null, value: number) => string;
  explanation: string;
}

const HEALTH_RULES: Record<string, HealthRule> = {
  "active-addresses": {
    metric: "Active Addresses",
    evaluate: (change) => {
      if (change === null) return "neutral";
      if (change > 10) return "healthy";
      if (change > -10) return "neutral";
      return "risk";
    },
    context: (change, value) => {
      if (change === null) return "Insufficient data";
      if (change > 20) return "Strong growth in unique users";
      if (change > 5) return "Steady user growth";
      if (change > -5) return "Stable user base";
      if (change > -20) return "User activity declining";
      return "Significant drop in active users";
    },
    explanation:
      "Active addresses shows how many unique wallets interact with the network daily. Growing addresses signal adoption, declining may indicate reduced interest.",
  },
  "transactions": {
    metric: "Transactions",
    evaluate: (change) => {
      if (change === null) return "neutral";
      if (change > 15) return "healthy";
      if (change > -10) return "neutral";
      return "risk";
    },
    context: (change) => {
      if (change === null) return "Insufficient data";
      if (change > 50) return "Transaction volume surging";
      if (change > 15) return "Healthy network usage growth";
      if (change > -10) return "Stable transaction volume";
      if (change > -30) return "Transaction activity cooling";
      return "Sharp decline in network usage";
    },
    explanation:
      "Daily transaction count reflects how actively the network is being used. Surging transactions often precede price movement and indicate real utility.",
  },
  "total-stake": {
    metric: "Total Staked",
    evaluate: (change) => {
      if (change === null) return "neutral";
      if (change > 2) return "healthy";
      if (change > -5) return "neutral";
      return "risk";
    },
    context: (change) => {
      if (change === null) return "Insufficient data";
      if (change > 10) return "Major inflow to staking";
      if (change > 2) return "Staking confidence growing";
      if (change > -2) return "Staking levels stable";
      if (change > -10) return "Some unstaking pressure";
      return "Significant capital leaving staking";
    },
    explanation:
      "Total staked TX shows network security commitment. Rising stake means holders are locking tokens for rewards, reducing sell pressure. Falling stake can signal confidence loss.",
  },
  "staking-apr": {
    metric: "Staking APR",
    evaluate: (change, value) => {
      if (change === null) return "neutral";
      if (value > 8 && change > -10) return "healthy";
      if (value > 5) return "neutral";
      return "risk";
    },
    context: (change, value) => {
      if (change === null) return "Insufficient data";
      if (change > 10) return "Yield increasing, fewer stakers competing";
      if (change > -5) return "Yield stable";
      if (change > -20) return "Yield compressing as more tokens stake";
      return "Rapid yield dilution from staking influx";
    },
    explanation:
      "Staking APR is the annualized return for staking TX. It drops when more tokens enter staking (dilution) and rises when tokens unstake. Lower APR often means higher network confidence.",
  },
  "staked-pct": {
    metric: "Staked Ratio",
    evaluate: (change, value) => {
      if (value > 50) return "healthy";
      if (value > 25) return "neutral";
      return "risk";
    },
    context: (change, value) => {
      if (value > 60) return "Very high stake ratio, strong security";
      if (value > 40) return "Healthy staking participation";
      if (value > 20) return "Moderate staking, room for growth";
      return "Low staking ratio, network less secured";
    },
    explanation:
      "The percentage of circulating supply that is staked. Higher ratio means stronger network security and less liquid supply. Cosmos chains typically target 67%.",
  },
  "total-supply": {
    metric: "Total Supply",
    evaluate: (change) => {
      if (change === null) return "neutral";
      if (change < 1) return "healthy";
      if (change < 5) return "neutral";
      return "risk";
    },
    context: (change) => {
      if (change === null) return "Insufficient data";
      if (change < 0.5) return "Supply growth minimal";
      if (change < 2) return "Normal inflation rate";
      return "Supply expanding rapidly";
    },
    explanation:
      "Total supply includes all TX tokens including the locked PSE module. Slow growth means low inflation, which is positive for token value.",
  },
  "circulating-supply": {
    metric: "Circulating Supply",
    evaluate: () => "neutral",
    context: () => "Tracks tokens available on the market",
    explanation:
      "Circulating supply excludes locked tokens (PSE module, vesting). This is the actual liquid supply that can be traded or staked.",
  },
};

export function getHealthStatus(metricId: string, change: number | null, value: number): HealthStatus {
  const rule = HEALTH_RULES[metricId];
  if (!rule) return "neutral";
  return rule.evaluate(change, value);
}

export function getHealthContext(metricId: string, change: number | null, value: number): string {
  const rule = HEALTH_RULES[metricId];
  if (!rule) return "";
  return rule.context(change, value);
}

export function getExplanation(metricId: string): string {
  return HEALTH_RULES[metricId]?.explanation ?? "";
}

// ═══════════════════════════════════════════
// NARRATIVE GENERATION (TL;DR Insight Bar)
// ═══════════════════════════════════════════

interface MetricSummary {
  id: string;
  label: string;
  change: number | null;
  value: number;
  health: HealthStatus;
}

export function generateInsightNarrative(metrics: MetricSummary[]): string {
  const significant = metrics.filter((m) => m.change !== null && Math.abs(m.change) > 5);
  if (significant.length === 0) return "Network metrics are stable across the board. No major changes detected.";

  const parts: string[] = [];

  // Find the most notable changes
  const sorted = [...significant].sort((a, b) => Math.abs(b.change!) - Math.abs(a.change!));
  const top = sorted.slice(0, 3);

  for (const m of top) {
    const dir = m.change! > 0 ? "up" : "down";
    const pct = Math.abs(m.change!).toFixed(0);
    parts.push(`${m.label} ${dir} ${pct}%`);
  }

  let narrative = parts.join(", ") + ".";

  // Add interpretation
  const txChange = metrics.find((m) => m.id === "transactions")?.change ?? 0;
  const aprChange = metrics.find((m) => m.id === "staking-apr")?.change ?? 0;
  const stakeChange = metrics.find((m) => m.id === "total-stake")?.change ?? 0;
  const addrChange = metrics.find((m) => m.id === "active-addresses")?.change ?? 0;

  if (txChange > 30 && aprChange < -10) {
    narrative += " Network usage surging while staking yields compress, suggesting increased adoption with more capital entering staking.";
  } else if (stakeChange > 10 && aprChange < -10) {
    narrative += " Capital flowing into staking is diluting yields. Strong confidence signal but lower individual rewards.";
  } else if (stakeChange < -10 && aprChange > 10) {
    narrative += " Unstaking activity is pushing yields higher. Could be profit taking or a rotation opportunity.";
  } else if (txChange > 20 && addrChange > 10) {
    narrative += " Both usage and users are growing. Healthy network expansion.";
  } else if (addrChange < -15 && txChange < -15) {
    narrative += " Both users and activity declining. Network may be in a cooling period.";
  }

  return narrative;
}

// ═══════════════════════════════════════════
// TODAY ON TX (Dynamic Summary Signals)
// ═══════════════════════════════════════════

export interface TodaySignal {
  type: "up" | "down" | "warning" | "insight";
  text: string;
}

export function generateTodaySignals(metrics: MetricSummary[]): TodaySignal[] {
  const signals: TodaySignal[] = [];

  const tx = metrics.find((m) => m.id === "transactions");
  const addr = metrics.find((m) => m.id === "active-addresses");
  const apr = metrics.find((m) => m.id === "staking-apr");
  const stake = metrics.find((m) => m.id === "total-stake");
  const ratio = metrics.find((m) => m.id === "staked-pct");

  // Transaction signals
  if (tx?.change && tx.change > 30) {
    signals.push({ type: "up", text: `Transaction volume surging (+${tx.change.toFixed(0)}%)` });
  } else if (tx?.change && tx.change < -20) {
    signals.push({ type: "down", text: `Transaction volume dropping (${tx.change.toFixed(0)}%)` });
  }

  // Address signals
  if (addr?.change && addr.change > 20) {
    signals.push({ type: "up", text: `User growth accelerating (+${addr.change.toFixed(0)}%)` });
  } else if (addr?.change && addr.change < -15) {
    signals.push({ type: "down", text: `Active users declining (${addr.change.toFixed(0)}%)` });
  }

  // APR signals
  if (apr?.change && apr.change < -20) {
    signals.push({ type: "warning", text: `Staking yield dropping fast (${apr.change.toFixed(0)}%). Rewards getting diluted.` });
  } else if (apr?.change && apr.change > 15) {
    signals.push({ type: "up", text: `Staking yield rising (+${apr.change.toFixed(0)}%). Less competition for rewards.` });
  }

  // Stake signals
  if (stake?.change && stake.change > 10) {
    signals.push({ type: "up", text: `Major staking inflow (+${stake.change.toFixed(0)}%). Confidence rising.` });
  } else if (stake?.change && stake.change < -10) {
    signals.push({ type: "warning", text: `Capital leaving staking (${stake.change.toFixed(0)}%). Watch for sell pressure.` });
  }

  // Cross-metric insights
  if (tx?.change && tx.change > 20 && apr?.change && apr.change < -10) {
    signals.push({ type: "insight", text: "Usage up + yield down = redistribution phase. Network growing but rewards spreading thinner." });
  }

  if (stake?.change && stake.change > 5 && ratio?.value && ratio.value < 5) {
    signals.push({ type: "insight", text: "Staking growing from a low base. Early stakers capturing outsized rewards." });
  }

  // Fallback
  if (signals.length === 0) {
    signals.push({ type: "insight", text: "Network in a stable period. No major shifts detected." });
  }

  return signals.slice(0, 5);
}

// ═══════════════════════════════════════════
// STRATEGY SUGGESTIONS
// ═══════════════════════════════════════════

export interface StrategySuggestion {
  action: string;
  reasoning: string;
  confidence: "high" | "medium" | "low";
}

export function generateStrategySuggestions(metrics: MetricSummary[]): StrategySuggestion[] {
  const suggestions: StrategySuggestion[] = [];

  const apr = metrics.find((m) => m.id === "staking-apr");
  const stake = metrics.find((m) => m.id === "total-stake");
  const tx = metrics.find((m) => m.id === "transactions");
  const addr = metrics.find((m) => m.id === "active-addresses");
  const ratio = metrics.find((m) => m.id === "staked-pct");

  // APR based
  if (apr?.change && apr.change < -20) {
    suggestions.push({
      action: "Yield is compressing. Consider if current staking rewards justify your position.",
      reasoning: "APR dropping rapidly means more capital is entering staking, diluting per token rewards.",
      confidence: "high",
    });
  } else if (apr?.value && apr.value > 10) {
    suggestions.push({
      action: "Above average staking yield available. Good window for new delegations.",
      reasoning: "Higher APR means fewer tokens competing for the same reward pool.",
      confidence: "medium",
    });
  }

  // Network growth
  if (tx?.change && tx.change > 30 && addr?.change && addr.change > 10) {
    suggestions.push({
      action: "Network fundamentals strengthening. Long term bullish signal for TX.",
      reasoning: "Rising transactions and users indicate growing utility and adoption.",
      confidence: "medium",
    });
  }

  // Stake flow
  if (stake?.change && stake.change < -10) {
    suggestions.push({
      action: "Unstaking wave in progress. APR may rise, creating a re-entry opportunity.",
      reasoning: "As capital exits staking, remaining stakers earn proportionally more.",
      confidence: "medium",
    });
  }

  if (ratio?.value && ratio.value < 10) {
    suggestions.push({
      action: "Very low staking ratio. Early stakers are earning outsized PSE rewards.",
      reasoning: "With few tokens staked, each staked token captures a larger share of PSE emissions.",
      confidence: "high",
    });
  }

  // Default
  if (suggestions.length === 0) {
    suggestions.push({
      action: "Market conditions stable. Maintain current positions and monitor for changes.",
      reasoning: "No strong signals in either direction. Steady staking continues to accumulate PSE rewards.",
      confidence: "low",
    });
  }

  return suggestions.slice(0, 3);
}
