"use client";

interface MetricsBarProps {
  price: number;
  priceChange24h: number;
  marketCap: number;
  stakingRatio: number;
  apr: number;
  totalSupply: number;
  inflation: number;
  loading: boolean;
}

function formatNumber(num: number): string {
  if (num >= 1e9) return `${(num / 1e9).toFixed(1)}B`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(1)}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(1)}K`;
  return num.toLocaleString();
}

function formatUSD(num: number): string {
  if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(1)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(1)}K`;
  return `$${num.toLocaleString()}`;
}

export default function MetricsBar({
  price, priceChange24h, marketCap, stakingRatio,
  apr, totalSupply, inflation, loading,
}: MetricsBarProps) {
  // Compute market cap from price × supply if CoinGecko returns 0
  const displayMarketCap = marketCap > 0 ? marketCap : price * totalSupply;

  const metrics = [
    {
      label: "TX Price",
      value: loading ? "..." : `$${price.toFixed(4)}`,
      change: priceChange24h,
    },
    {
      label: "Market Cap",
      value: loading ? "..." : formatUSD(displayMarketCap),
    },
    {
      label: "Staking Ratio",
      value: loading ? "..." : `${stakingRatio.toFixed(1)}%`,
    },
    {
      label: "Base APR",
      value: loading ? "..." : `${apr.toFixed(2)}%`,
      note: "PSE is primary yield",
      noteColor: "var(--accent-dark)",
    },
    {
      label: "Total Supply",
      value: loading ? "..." : formatNumber(totalSupply),
    },
    {
      label: "Inflation",
      value: loading ? "..." : `${inflation.toFixed(3)}%`,
    },
  ];

  return (
    <div className="metrics-row">
      {metrics.map((m) => (
        <div key={m.label} className="metric-cell">
          <div className="metric-top">
            <span className="label">{m.label}</span>
            {m.change !== undefined && (
              <span
                className="label"
                style={{ color: m.change >= 0 ? "var(--accent-dark)" : "var(--danger)" }}
              >
                {m.change >= 0 ? "+" : ""}{m.change.toFixed(1)}%
              </span>
            )}
          </div>
          <span className="value-large mono">{m.value}</span>
          {m.note && (
            <span className="label" style={{ fontSize: 7, color: m.noteColor || "var(--muted)", marginTop: -2 }}>
              {m.note}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
