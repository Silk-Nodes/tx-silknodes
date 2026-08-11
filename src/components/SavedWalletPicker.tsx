"use client";

// Saved-wallet chips for any surface that asks for an address.
//
// Requested twice in the same week from different directions: the portfolio
// request ("see all my wallets in one place") and this one ("it's awkward
// typing my address each time"). Both are the same underlying want, so this
// deliberately reuses the portfolio's wallet list rather than keeping its
// own. One list, one save button, every surface. A second store would
// diverge from the first within a week and nobody would know which chip
// lives where.
//
// The list never leaves the browser (see lib/wallet-list for why), so a
// picker appearing on more pages adds no new exposure: it is the same local
// data rendered somewhere else.

import { useEffect, useState } from "react";
import {
  addWallet,
  isValidWalletAddress,
  loadWallets,
  type SavedWallet,
} from "@/lib/wallet-list";

const shortAddr = (a: string) => `${a.slice(0, 10)}...${a.slice(-5)}`;

export default function SavedWalletPicker({
  current,
  onPick,
}: {
  /** What is in the address input right now, so the save affordance can
   *  offer to keep it. */
  current: string;
  /** Called with the full address when a chip is clicked. The caller decides
   *  whether picking also runs its lookup. */
  onPick: (address: string) => void;
}) {
  const [wallets, setWallets] = useState<SavedWallet[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  // localStorage is client-only; rendering from it during SSR would hydrate
  // mismatched, so the list fills in after mount.
  useEffect(() => {
    setWallets(loadWallets());
  }, []);

  const trimmed = current.trim();
  const canSave =
    isValidWalletAddress(trimmed) && !wallets.some((w) => w.address === trimmed);

  if (wallets.length === 0 && !canSave) return null;

  return (
    <div className="swp">
      {wallets.map((w) => (
        <button
          key={w.address}
          type="button"
          className={`swp-chip${w.address === trimmed ? " swp-chip-active" : ""}`}
          onClick={() => onPick(w.address)}
          title={w.address}
        >
          {w.label || shortAddr(w.address)}
        </button>
      ))}
      {canSave && (
        <button
          type="button"
          className="swp-chip swp-chip-save"
          onClick={() => {
            const r = addWallet(trimmed);
            if (r.ok) {
              setWallets(r.wallets);
              setNotice(null);
            } else {
              setNotice(r.reason === "full" ? "Wallet list is full (10)." : null);
            }
          }}
        >
          + Save this wallet
        </button>
      )}
      {notice && <span className="swp-notice">{notice}</span>}
    </div>
  );
}
