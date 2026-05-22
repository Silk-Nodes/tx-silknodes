"use client";

import { useEffect, useState } from "react";
import { STATUS_LABELS, type Proposal } from "@/lib/governance";

interface Props {
  proposal: Proposal;
  quorumPct: number;
  scrollTrigger?: number; // px scrolled before strip appears (default 320)
}

// A thin strip that fades in once the user scrolls past the proposal header.
// Keeps the page context visible without taking screen real estate when at
// the top.
export default function StickyContextStrip({
  proposal,
  quorumPct,
  scrollTrigger = 320,
}: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onScroll = () => setVisible(window.scrollY > scrollTrigger);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [scrollTrigger]);

  return (
    <div className={`prop-sticky-strip ${visible ? "visible" : ""}`} role="banner">
      <div className="prop-sticky-strip-inner">
        <span className="prop-sticky-id">#{proposal.id}</span>
        <span className="prop-sticky-title">{proposal.title}</span>
        <span className={`prop-sticky-status status-${proposal.status}`}>
          {STATUS_LABELS[proposal.status]}
        </span>
        <span className="prop-sticky-quorum">
          {(quorumPct * 100).toFixed(1)}% turnout
        </span>
      </div>
    </div>
  );
}
