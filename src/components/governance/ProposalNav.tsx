"use client";

import Link from "next/link";
import { useGovernance } from "@/hooks/useGovernance";

interface Props {
  currentId: number;
}

// Wikipedia-style adjacent-page nav at the bottom of a proposal page.
// Uses the list query (already cached for the landing page) to find the
// neighbors. Falls back gracefully when the list isn't loaded yet.
export default function ProposalNav({ currentId }: Props) {
  const { proposals } = useGovernance();
  if (proposals.length === 0) return null;
  // Proposals from useGovernance are sorted by id desc; we want id-asc
  // for "previous = lower id, next = higher id" semantics.
  const byId = [...proposals].sort((a, b) => a.id - b.id);
  const idx = byId.findIndex((p) => p.id === currentId);
  if (idx === -1) return null;
  const prev = byId[idx - 1] ?? null;
  const next = byId[idx + 1] ?? null;

  return (
    <nav className="prop-nav" aria-label="Adjacent proposals">
      <div className="prop-nav-side prop-nav-prev">
        {prev ? (
          <Link href={`/governance/${prev.id}`} className="prop-nav-link">
            <span className="prop-nav-arrow">←</span>
            <span className="prop-nav-meta">
              <span className="prop-nav-label">Previous</span>
              <span className="prop-nav-title">
                #{prev.id} {prev.title}
              </span>
            </span>
          </Link>
        ) : (
          <span className="prop-nav-spacer" />
        )}
      </div>
      <div className="prop-nav-side prop-nav-next">
        {next ? (
          <Link href={`/governance/${next.id}`} className="prop-nav-link prop-nav-link-next">
            <span className="prop-nav-meta">
              <span className="prop-nav-label">Next</span>
              <span className="prop-nav-title">
                #{next.id} {next.title}
              </span>
            </span>
            <span className="prop-nav-arrow">→</span>
          </Link>
        ) : (
          <span className="prop-nav-spacer" />
        )}
      </div>
    </nav>
  );
}
