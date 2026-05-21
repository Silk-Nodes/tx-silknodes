"use client";

import { useEffect, useState } from "react";

interface WhatsNewBannerProps {
  onOpenFeedback: () => void;
}

// Hard-coded expiry: the banner stops rendering after this date no matter
// what, even if nobody dismissed it. Prevents stale announcements from
// living forever on the live site. When this banner is retired, just
// delete the file — the import + render line in page.tsx becomes dead
// and can go in the same commit.
const EXPIRES_AT_ISO = "2026-05-22T23:59:59Z";

// localStorage key. Versioned so we can ship a new banner later without
// reusing the same dismissal flag.
const DISMISS_KEY = "txaio_whats_new_v1";

export default function WhatsNewBanner({ onOpenFeedback }: WhatsNewBannerProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Respect both: hard expiry AND user dismissal.
    if (new Date() > new Date(EXPIRES_AT_ISO)) return;
    try {
      if (localStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {
      // localStorage can throw in private-mode / cookies-disabled
      // browsers. Silently skip the check; the banner will still
      // appear but it won't crash the page.
    }
    setVisible(true);
  }, []);

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // See above — non-fatal.
    }
  };

  const handleFeedbackClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    onOpenFeedback();
    dismiss();
  };

  if (!visible) return null;

  return (
    <div className="whats-new-banner" role="status" aria-live="polite">
      <span className="whats-new-banner-text">
        Bitget added to the exchange tracker. Feature requests now open. Share your ideas on{" "}
        <a href="#feedback" onClick={handleFeedbackClick} className="whats-new-banner-link">
          Feedback
        </a>
        .
      </span>
      <button
        type="button"
        className="whats-new-banner-close"
        onClick={dismiss}
        aria-label="Dismiss announcement"
      >
        ×
      </button>
    </div>
  );
}
