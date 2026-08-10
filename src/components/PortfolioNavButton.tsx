"use client";

// Portfolio entry point in the header.
//
// It sits in the account zone next to Connect Wallet rather than in the
// primary nav, because the portfolio is personal state, not public analysis
// like Today or Governance. The nav strip is also already full: it scrolls
// horizontally at 7 items and the active tab can land half-off the edge, so a
// further content tab has a real cost.
//
// The count is the point. Someone who has saved wallets needs a way back to
// them, and a bare "Portfolio" word gives no reason to click. It is read from
// localStorage, so it renders empty on the server and fills in on mount.

import Link from "next/link";
import { useEffect, useState } from "react";
import { loadWallets } from "@/lib/wallet-list";

export default function PortfolioNavButton({ active }: { active: boolean }) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    const read = () => setCount(loadWallets().length);
    read();
    // The list is written by the portfolio page and by "Track in portfolio" on
    // the passport. "storage" covers other tabs; "focus" covers coming back to
    // this one, since a same-tab write fires no storage event.
    window.addEventListener("storage", read);
    window.addEventListener("focus", read);
    return () => {
      window.removeEventListener("storage", read);
      window.removeEventListener("focus", read);
    };
  }, []);

  return (
    <Link
      href="/portfolio"
      className={`portfolio-pill ${active ? "active" : ""}`}
      aria-label={
        count && count > 0
          ? `Portfolio, ${count} wallet${count === 1 ? "" : "s"} saved`
          : "Portfolio"
      }
    >
      <span className="portfolio-pill-label">Portfolio</span>
      {/* Only once there is something to come back to. A "0" would read as an
          error rather than as an empty list. */}
      {count !== null && count > 0 && (
        <span className="portfolio-pill-count mono">{count}</span>
      )}
    </Link>
  );
}
