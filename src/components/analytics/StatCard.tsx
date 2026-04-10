"use client";

import { useState } from "react";
import type { HealthStatus } from "@/lib/analytics-insights";

interface StatCardProps {
  label: string;
  value: string;
  change: number | null;
  health: HealthStatus;
  healthContext: string;
  explanation: string;
  variant?: "olive" | "dark" | "default";
}

const HEALTH_DOT: Record<HealthStatus, { color: string; label: string }> = {
  healthy: { color: "#4a7a1a", label: "Healthy" },
  neutral: { color: "#b5a040", label: "Neutral" },
  risk: { color: "#b44a3e", label: "Declining" },
};

export default function StatCard({
  label,
  value,
  change,
  health,
  healthContext,
  explanation,
  variant = "default",
}: StatCardProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const dot = HEALTH_DOT[health];

  const cardClass =
    variant === "olive"
      ? "stat-card card-olive"
      : variant === "dark"
        ? "stat-card card-dark"
        : "stat-card";

  const isLight = variant === "default";

  return (
    <div
      className={cardClass}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      style={{ cursor: "default", position: "relative" }}
    >
      <div className="stat-card-label">
        <span
          className="health-dot"
          style={{ background: dot.color }}
          title={dot.label}
        />
        {label}
      </div>
      <div className="stat-card-value">{value}</div>
      <div className="stat-card-row">
        {change !== null && (
          <span className={`stat-card-change ${change >= 0 ? "positive" : "negative"}`}>
            {change >= 0 ? "+" : ""}{change.toFixed(1)}%
          </span>
        )}
        <span
          className="stat-card-context"
          style={{ color: isLight ? "var(--text-light)" : "rgba(255,255,255,0.45)" }}
        >
          {healthContext}
        </span>
      </div>

      {/* Educational tooltip */}
      {showTooltip && explanation && (
        <div className="stat-tooltip">
          <div className="stat-tooltip-title">What this means</div>
          <div className="stat-tooltip-text">{explanation}</div>
        </div>
      )}
    </div>
  );
}
