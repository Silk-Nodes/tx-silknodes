export interface DataPoint {
  date: string;
  value: number;
}

export type TimeRange = "7D" | "30D" | "90D" | "1Y" | "ALL";

export const TIME_RANGES: TimeRange[] = ["7D", "30D", "90D", "1Y", "ALL"];

/**
 * Filter data points to a time range relative to the latest data point.
 */
export function filterByTimeRange(data: DataPoint[], range: TimeRange): DataPoint[] {
  if (range === "ALL" || data.length === 0) return data;

  const latest = new Date(data[data.length - 1].date);
  let cutoff: Date;

  switch (range) {
    case "7D":
      cutoff = new Date(latest);
      cutoff.setDate(cutoff.getDate() - 7);
      break;
    case "30D":
      cutoff = new Date(latest);
      cutoff.setDate(cutoff.getDate() - 30);
      break;
    case "90D":
      cutoff = new Date(latest);
      cutoff.setDate(cutoff.getDate() - 90);
      break;
    case "1Y":
      cutoff = new Date(latest);
      cutoff.setFullYear(cutoff.getFullYear() - 1);
      break;
    default:
      return data;
  }

  return data.filter((d) => new Date(d.date) >= cutoff);
}

/**
 * Format large numbers with B/M/K suffixes.
 */
export function formatLargeNumber(num: number, decimals = 1): string {
  if (num >= 1e9) return `${(num / 1e9).toFixed(decimals)}B`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(decimals)}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(decimals)}K`;
  return num.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

/**
 * Format percentage values.
 */
export function formatPct(num: number, decimals = 2): string {
  return `${num.toFixed(decimals)}%`;
}

/**
 * Adaptive date label for chart X axis.
 */
export function formatChartDate(dateStr: string, range: TimeRange): string {
  const d = new Date(dateStr + "T00:00:00");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  if (range === "7D" || range === "30D") {
    return `${months[d.getMonth()]} ${d.getDate()}`;
  }
  if (range === "90D") {
    return `${months[d.getMonth()]} ${d.getDate()}`;
  }
  // 1Y or ALL
  return `${months[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`;
}

/**
 * Full date for tooltip display.
 */
export function formatTooltipDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Get the latest non zero value from data.
 */
export function getLatestValue(data: DataPoint[]): number {
  for (let i = data.length - 1; i >= 0; i--) {
    if (data[i].value !== 0) return data[i].value;
  }
  return 0;
}

/**
 * Calculate percentage change between first and last visible points.
 */
export function calcChange(data: DataPoint[]): number | null {
  if (data.length < 2) return null;
  const first = data[0].value;
  const last = data[data.length - 1].value;
  if (first === 0) return null;
  return ((last - first) / first) * 100;
}

/**
 * Downsample data to maxPoints using every Nth sampling.
 */
export function downsample(data: DataPoint[], maxPoints = 120): DataPoint[] {
  if (data.length <= maxPoints) return data;
  const step = Math.ceil(data.length / maxPoints);
  const result: DataPoint[] = [];
  for (let i = 0; i < data.length; i += step) {
    result.push(data[i]);
  }
  // Always include the last point
  if (result[result.length - 1] !== data[data.length - 1]) {
    result.push(data[data.length - 1]);
  }
  return result;
}
