"use client";

import { useEffect, useState } from "react";
import { fetchPSESchedule } from "@/lib/pse-calculator";

export interface NextPSECycle {
  cycleNumber: number;   // 1-indexed; the upcoming cycle being awaited
  totalCycles: number;   // typically 84
  nextTimestamp: number; // unix seconds when next distribution happens
  secondsLeft: number;   // refreshes every second
  parts: { days: number; hours: number; minutes: number; seconds: number };
}

// Returns countdown info for the next PSE distribution. Same data source
// as the PSE tab's existing countdown so visuals match. Ticks every
// second so the seconds digit actually counts down.
export function useNextPSECycle(): NextPSECycle | null {
  const [schedule, setSchedule] = useState<number[] | null>(null);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    let cancelled = false;
    void fetchPSESchedule().then((s) => {
      if (!cancelled && s.length > 0) setSchedule(s);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  if (!schedule) return null;
  const nextIdx = schedule.findIndex((t) => t > nowSec);
  if (nextIdx === -1) return null;
  const secondsLeft = Math.max(0, schedule[nextIdx] - nowSec);
  return {
    cycleNumber: nextIdx + 1,
    totalCycles: schedule.length,
    nextTimestamp: schedule[nextIdx],
    secondsLeft,
    parts: {
      days: Math.floor(secondsLeft / 86400),
      hours: Math.floor((secondsLeft % 86400) / 3600),
      minutes: Math.floor((secondsLeft % 3600) / 60),
      seconds: secondsLeft % 60,
    },
  };
}

// Kept for back-compat with any caller using the older string format.
export function formatCountdown(secondsLeft: number): string {
  if (secondsLeft <= 0) return "due now";
  const days = Math.floor(secondsLeft / 86400);
  const hours = Math.floor((secondsLeft % 86400) / 3600);
  const mins = Math.floor((secondsLeft % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

// Pad helper matching the PSE tab convention.
export function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
