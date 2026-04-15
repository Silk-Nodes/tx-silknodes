import { useMemo, useState, useEffect } from "react";
import type { StakingEvent, StakingEventsData } from "@/lib/staking-events";
import stakingEventsRaw from "@/data/analytics/staking-events.json";

const data = stakingEventsRaw as StakingEventsData;

export function useStakingFeed() {
  const [now, setNow] = useState(() => Date.now());

  // Refresh relative timestamps every 30 seconds
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const events = useMemo<StakingEvent[]>(() => data.events || [], []);
  const validators = useMemo<Record<string, string>>(() => data.validators || {}, []);

  return {
    events,
    validators,
    updatedAt: data.updatedAt,
    now,
  };
}
