"use client";

// The connected wallet control in the header.
//
// It replaces an address pill whose click disconnected you instantly, with a
// separate Copy button beside it. Copying your own address is the ordinary
// reason to click it and disconnecting is the rare, disruptive one, so the
// two were the wrong way round and a misclick cost you the connection.
//
// Both actions now live in a menu behind the address, which also removes the
// second button from a header that had a caption, a status dot, a pill and a
// button competing in one row.
//
// Deliberately calmer than "Connect Wallet". Once you are connected the
// address is status, not an action; the loud treatment belongs to the state
// that still needs something from you.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export default function WalletMenu({
  address,
  onDisconnect,
}: {
  address: string;
  onDisconnect: () => void;
}) {
  const [open, setOpen] = useState(false);
  // Fixed coords for a portaled menu. The nav strip is a horizontal-scroll
  // container, so an absolutely positioned child is clipped by it and lands
  // outside the viewport on narrow screens (measured: menu right edge at
  // 504px against a 393px viewport). ToolsDropdown solves it the same way.
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const short = `${address.slice(0, 10)}...${address.slice(-6)}`;

  const place = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Anchored to the viewport's right edge, never off it.
    setPos({ top: Math.round(r.bottom + 6), right: Math.round(Math.max(8, window.innerWidth - r.right)) });
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, place]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be blocked (insecure origin, permissions). Say nothing
      // rather than claiming a copy that did not happen.
    }
    setOpen(false);
  }, [address]);

  return (
    <div className="wallet-menu" ref={ref}>
      <button
        ref={btnRef}
        type="button"
        className={`wallet-pill connected ${open ? "is-open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={address}
      >
        <span className="mono">{copied ? "Copied" : short}</span>
        <span className="wallet-pill-chev" aria-hidden="true" />
      </button>

      {open && pos && typeof document !== "undefined" && createPortal(
        <div
          className="wallet-menu-list"
          role="menu"
          style={{ position: "fixed", top: pos.top, right: pos.right }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button type="button" role="menuitem" className="wallet-menu-item" onClick={copy}>
            Copy address
          </button>
          <button
            type="button"
            role="menuitem"
            className="wallet-menu-item is-danger"
            onClick={() => { setOpen(false); onDisconnect(); }}
          >
            Disconnect
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
