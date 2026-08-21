"use client";

import { useEffect, useState } from "react";

/**
 * Time remaining in a proposal's voting period, ticking once a second.
 *
 * Renders nothing until mounted. The server and the client would otherwise
 * compute "now" at different instants and React would flag the mismatch, and
 * a countdown rendered on the server is stale the moment it is sent anyway.
 *
 * Only for live proposals: a settled one has no remaining time and a frozen
 * "0m left" beside a closed vote reads like a bug.
 */
export default function VotingCountdown({ endTime }: { endTime: string | null }) {
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!endTime || nowMs === null) return null;
  const end = Date.parse(endTime);
  if (!Number.isFinite(end)) return null;

  const left = Math.max(0, Math.floor((end - nowMs) / 1000));
  if (left === 0) {
    return <span className="vote-countdown ended">Voting closed</span>;
  }

  const d = Math.floor(left / 86400);
  const h = Math.floor((left % 86400) / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;

  // Show seconds only in the last hour, where they are information rather
  // than noise. Above that a ticking seconds digit just pulls the eye.
  const text = d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;

  // Under 24 hours the deadline is actionable, so it gets the warm tone. It
  // is a deadline, not an error, so it never uses the destructive colour.
  const urgent = left < 86_400;

  return (
    <span className={`vote-countdown${urgent ? " urgent" : ""}`}>
      <span className="vote-countdown-dot" aria-hidden="true" />
      {text} left to vote
    </span>
  );
}
