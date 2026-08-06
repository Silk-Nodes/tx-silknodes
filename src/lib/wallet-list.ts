// The saved wallet list behind the combined portfolio view on /passport.
//
// Why this never leaves the browser
// ---------------------------------
// A grouped list of someone's addresses is more sensitive than any single
// address in it, because it links identities that are unlinked on chain.
// Our API takes one address per call, so as long as the merging happens here
// we never receive the set and cannot leak what we do not hold.
//
// That is a deliberate design choice, not a limitation we settled for. Two
// costs come with it and both are stated in the UI: the list does not sync
// across devices, and clearing site data loses it. Export and import cover
// the second.
//
// There is no ownership check, and there should not be. The list grants
// nothing, no reward or claim depends on it, and the wallets people most
// want here are cold or hardware wallets they will not connect to a website.
// Requiring a signature per address would be real friction protecting
// nothing, and it would exclude exactly the wallets that make the feature
// worth having. Someone adding an address they do not own has built a
// watchlist, which is a fine thing to have built.

import { decode as bech32Decode } from "bech32";

const STORAGE_KEY = "tx-portfolio-wallets";

// Each wallet costs a handful of LCD reads on load. Ten keeps a cold load
// responsive and stays well inside the API rate limits for the parts that do
// touch our own endpoints. The cap is surfaced in the UI rather than silently
// dropping the eleventh.
export const MAX_WALLETS = 10;
export const MAX_LABEL_LENGTH = 24;

export interface SavedWallet {
  address: string;
  /** User-supplied name. Eight bech32 addresses are unreadable; eight names are not. */
  label?: string;
  /** ISO timestamp, used only to keep the list in the order it was built. */
  addedAt: string;
}

/** A core1 account address, rejecting validator and consensus prefixes. */
export function isValidWalletAddress(address: string): boolean {
  if (!address.startsWith("core1") || address.startsWith("corevaloper")) return false;
  try {
    const { prefix, words } = bech32Decode(address);
    // Two valid account shapes on this chain, and accepting only one of them
    // silently rejects every ordinary wallet:
    //   32 words = a 20-byte account, which is what a normal user wallet is
    //   52 words = a 32-byte account, used by contracts and module accounts
    return prefix === "core" && (words.length === 32 || words.length === 52);
  } catch {
    return false;
  }
}

export function loadWallets(): SavedWallet[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Re-validate on read. The value is user-editable (devtools, a bad
    // import, a half-written older version), so it is untrusted input even
    // though we wrote it.
    return parsed
      .filter(
        (w): w is SavedWallet =>
          typeof w === "object" && w !== null &&
          typeof (w as SavedWallet).address === "string" &&
          isValidWalletAddress((w as SavedWallet).address),
      )
      .map((w) => ({
        address: w.address,
        label: typeof w.label === "string" ? w.label.slice(0, MAX_LABEL_LENGTH) : undefined,
        addedAt: typeof w.addedAt === "string" ? w.addedAt : new Date(0).toISOString(),
      }))
      .slice(0, MAX_WALLETS);
  } catch {
    return [];
  }
}

function persist(wallets: SavedWallet[]): SavedWallet[] {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(wallets));
    } catch {
      // Quota or a privacy mode that blocks storage. The in-memory list still
      // works for this session, so the view degrades rather than breaking.
    }
  }
  return wallets;
}

export type AddResult =
  | { ok: true; wallets: SavedWallet[] }
  | { ok: false; reason: "invalid" | "duplicate" | "full" };

export function addWallet(address: string, label?: string): AddResult {
  const trimmed = address.trim();
  if (!isValidWalletAddress(trimmed)) return { ok: false, reason: "invalid" };
  const current = loadWallets();
  if (current.some((w) => w.address === trimmed)) return { ok: false, reason: "duplicate" };
  if (current.length >= MAX_WALLETS) return { ok: false, reason: "full" };
  const next = [
    ...current,
    {
      address: trimmed,
      label: label?.trim().slice(0, MAX_LABEL_LENGTH) || undefined,
      addedAt: new Date().toISOString(),
    },
  ];
  return { ok: true, wallets: persist(next) };
}

export function removeWallet(address: string): SavedWallet[] {
  return persist(loadWallets().filter((w) => w.address !== address));
}

export function renameWallet(address: string, label: string): SavedWallet[] {
  const next = loadWallets().map((w) =>
    w.address === address ? { ...w, label: label.trim().slice(0, MAX_LABEL_LENGTH) || undefined } : w,
  );
  return persist(next);
}

export function clearWallets(): SavedWallet[] {
  return persist([]);
}

/**
 * Serialize for a file the user keeps.
 *
 * Deliberately a download rather than a shareable link. A URL containing the
 * whole set would recreate the linkage leak the local-only design avoids, and
 * links get pasted into places their author did not intend.
 */
export function exportWallets(): string {
  return JSON.stringify({ version: 1, wallets: loadWallets() }, null, 2);
}

export function importWallets(json: string): { ok: boolean; added: number; skipped: number } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, added: 0, skipped: 0 };
  }
  const incoming = (parsed as { wallets?: unknown })?.wallets;
  if (!Array.isArray(incoming)) return { ok: false, added: 0, skipped: 0 };

  let added = 0;
  let skipped = 0;
  for (const entry of incoming) {
    const address = (entry as SavedWallet)?.address;
    const label = (entry as SavedWallet)?.label;
    if (typeof address !== "string") { skipped++; continue; }
    const res = addWallet(address, typeof label === "string" ? label : undefined);
    if (res.ok) added++;
    else skipped++;
  }
  return { ok: true, added, skipped };
}
