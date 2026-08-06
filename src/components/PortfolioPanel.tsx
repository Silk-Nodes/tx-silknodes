"use client";

// Combined view across several wallets, on top of the Passport tab.
//
// Requested by a holder who keeps their stake split across wallets and wanted
// one picture of it. The totals are the obvious part. The number that does not
// exist anywhere else is validator exposure ACROSS wallets: four wallets each
// delegated to the same validator look diversified one at a time and are not.
//
// Everything here runs in the browser. The wallet list is read from
// localStorage and each address is fetched from the LCD directly, so our own
// API never sees which addresses belong to the same person. See lib/wallet-list
// for why that matters more than the convenience it costs.
//
// Styling note: this deliberately reuses the passport's own classes
// (psp-card, psp-headline, psp-metric, psp-bars) rather than defining a
// parallel set. The first version invented its own boxed metric tiles and
// single-row bars, which read as a different product bolted onto the page.
// The site stacks its bars (label and value on one line, full-width track
// beneath) and leaves headline figures unboxed under a hairline, in mono.
// Only the genuinely new pieces (the add form, the wallet rows) carry pfp-
// classes.

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatCompact } from "@/lib/ui-format";
import {
  fetchAddressChainData,
  fetchStakingApr,
  fetchValidatorMeta,
  type AddressChainData,
  type ValidatorMeta,
} from "@/lib/passport";
import {
  MAX_WALLETS,
  addWallet,
  clearWallets,
  exportWallets,
  importWallets,
  loadWallets,
  removeWallet,
  renameWallet,
  type SavedWallet,
} from "@/lib/wallet-list";

const shortAddr = (a: string) => (a.length > 16 ? `${a.slice(0, 10)}...${a.slice(-6)}` : a);
const TX = (n: number) => `${formatCompact(n)} TX`;
const fullDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

interface WalletRow {
  wallet: SavedWallet;
  data: AddressChainData | null;
  /** A single unreachable wallet must not blank the whole portfolio. */
  failed: boolean;
}

export default function PortfolioPanel({
  connectedAddress,
  txPrice = 0,
  onOpenPassport,
}: {
  connectedAddress?: string;
  txPrice?: number;
  onOpenPassport?: (address: string) => void;
}) {
  const [wallets, setWallets] = useState<SavedWallet[]>([]);
  const [rows, setRows] = useState<WalletRow[]>([]);
  const [vmeta, setVmeta] = useState<Record<string, ValidatorMeta>>({});
  const [apr, setApr] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  // localStorage is only readable after mount, so the list starts empty and
  // fills in on the client. Rendering server-side would hydrate mismatched.
  useEffect(() => {
    setWallets(loadWallets());
  }, []);

  useEffect(() => {
    fetchValidatorMeta().then(setVmeta).catch(() => {});
    fetchStakingApr().then(setApr).catch(() => {});
  }, []);

  const nameOf = useCallback(
    (addr: string) => vmeta[addr]?.moniker ?? shortAddr(addr),
    [vmeta],
  );

  const refresh = useCallback(async (list: SavedWallet[]) => {
    if (list.length === 0) {
      setRows([]);
      return;
    }
    setLoading(true);
    const settled = await Promise.all(
      list.map(async (wallet): Promise<WalletRow> => {
        try {
          return { wallet, data: await fetchAddressChainData(wallet.address), failed: false };
        } catch {
          return { wallet, data: null, failed: true };
        }
      }),
    );
    setRows(settled);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh(wallets);
  }, [wallets, refresh]);

  const totals = useMemo(() => {
    let liquid = 0, staked = 0, unbonding = 0, rewards = 0, failed = 0;
    const byValidator = new Map<string, number>();
    // Non-TX holdings merged by ticker, so three wallets holding the same
    // smart token read as one line instead of three.
    const byToken = new Map<string, number>();
    for (const r of rows) {
      if (!r.data) { failed++; continue; }
      liquid += r.data.balanceTX;
      staked += r.data.stakedTX;
      unbonding += r.data.unbondingTX;
      rewards += r.data.rewardsTX;
      for (const d of r.data.delegations) {
        byValidator.set(d.validatorAddress, (byValidator.get(d.validatorAddress) ?? 0) + d.amountTX);
      }
      for (const t of r.data.otherTokens) {
        byToken.set(t.symbol, (byToken.get(t.symbol) ?? 0) + t.displayAmount);
      }
    }
    const exposure = [...byValidator.entries()]
      // A delegation can sit at 0 after a full undelegate. Listing those adds
      // rows that all read "0 TX 0%" and push the real exposure down.
      .filter(([, amountTX]) => amountTX > 0)
      .map(([validatorAddress, amountTX]) => ({
        validatorAddress,
        amountTX,
        pct: staked > 0 ? (amountTX / staked) * 100 : 0,
      }))
      .sort((a, b) => b.amountTX - a.amountTX);
    // Stake sitting with a validator that is jailed or out of the active set
    // earns nothing. One wallet at a time this is easy to miss; it is the kind
    // of thing that quietly runs for weeks.
    const idle = exposure.filter((e) => {
      const m = vmeta[e.validatorAddress];
      return m && (m.jailed || !m.bonded);
    });
    const idleStakeTX = idle.reduce((n, e) => n + e.amountTX, 0);

    const tokens = [...byToken.entries()]
      // Dust rounds to "0" once formatted, which reads as a bug rather than a
      // tiny balance. Filter on what will actually be rendered, not on the raw
      // amount: formatCompact(0.4) is "0", so a >0 test does not catch it.
      .filter(([, amt]) => formatCompact(amt) !== "0")
      .map(([symbol, amount]) => ({ symbol, amount }))
      .sort((a, b) => b.amount - a.amount);
    // Every pending unbonding across every wallet, soonest first. The chain
    // gives a completion time per entry and nothing surfaces it, so a holder
    // has no way to know when their capital comes back without checking each
    // wallet by hand.
    const unlocks = rows
      .flatMap((r) => (r.data?.unbonding ?? []).map((u) => ({ ...u, wallet: r.wallet })))
      .sort((a, b) => new Date(a.completionTime).getTime() - new Date(b.completionTime).getTime());

    return {
      liquid, staked, unbonding, rewards,
      total: liquid + staked + unbonding + rewards,
      exposure, tokens, failed,
      jailedStake: { validators: idle, amountTX: idleStakeTX },
      unlocks,
    };
  }, [rows, vmeta]);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const res = addWallet(input, labelInput);
    if (!res.ok) {
      setNotice(
        res.reason === "invalid" ? "That is not a valid core1 address."
        : res.reason === "duplicate" ? "That wallet is already in your list."
        : `You can track up to ${MAX_WALLETS} wallets.`,
      );
      return;
    }
    setWallets(res.wallets);
    setInput("");
    setLabelInput("");
    setNotice(null);
  };

  const doExport = () => {
    const blob = new Blob([exportWallets()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tx-portfolio-wallets.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const doImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = importWallets(String(reader.result));
      setWallets(loadWallets());
      setNotice(
        res.ok ? `Imported ${res.added} wallet${res.added === 1 ? "" : "s"}${res.skipped ? `, skipped ${res.skipped}` : ""}.`
               : "That file could not be read.",
      );
    };
    reader.readAsText(file);
  };

  const canAddConnected =
    connectedAddress && !wallets.some((w) => w.address === connectedAddress);
  const sortedRows = [...rows].sort((a, b) => (b.data?.stakedTX ?? 0) - (a.data?.stakedTX ?? 0));
  const top = totals.exposure[0];
  // Below a token amount the "you could be earning" line is noise, not a
  // nudge. One TX a year is not a finding.
  const idleWorth = totals.liquid >= 100;

  return (
    <div className="psp-card psp-card-wide pfp-card">
      <div className="pfp-head">
        <div>
          <div className="psp-card-head" style={{ marginBottom: 2 }}>Your portfolio</div>
          <span className="psp-metric-label" style={{ textTransform: "none", letterSpacing: 0 }}>
            {wallets.length === 0
              ? "Add the wallets you hold to see one combined position."
              : `${wallets.length} wallet${wallets.length === 1 ? "" : "s"}, combined. Stored in this browser only, never sent to us.`}
          </span>
        </div>
        {wallets.length > 0 && (
          <div className="pfp-head-actions">
            <button type="button" className="psp-topbar-btn ghost" onClick={doExport}>Export</button>
            <label className="psp-topbar-btn ghost pfp-file">
              Import
              <input
                type="file"
                accept="application/json"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) doImport(f); e.target.value = ""; }}
              />
            </label>
          </div>
        )}
      </div>

      <form className="pfp-add" onSubmit={handleAdd}>
        <input
          className="pfp-input pfp-input-addr mono"
          value={input}
          onChange={(e) => { setInput(e.target.value); setNotice(null); }}
          placeholder="core1..."
          spellCheck={false}
          aria-label="Wallet address to add"
        />
        <input
          className="pfp-input pfp-input-label"
          value={labelInput}
          onChange={(e) => setLabelInput(e.target.value)}
          placeholder="Name (optional)"
          aria-label="Label for this wallet"
        />
        <button type="submit" className="psp-topbar-btn" disabled={!input.trim()}>Add</button>
        {canAddConnected && (
          <button
            type="button"
            className="psp-topbar-btn ghost"
            onClick={() => { const r = addWallet(connectedAddress!, "Connected"); if (r.ok) setWallets(r.wallets); }}
          >
            Add connected
          </button>
        )}
      </form>

      {notice && <div className="pfp-notice">{notice}</div>}

      {wallets.length === 0 ? (
        <div className="psp-empty">
          Nothing added yet. Cold wallets work here too: this reads public chain data only,
          so there is nothing to connect and nothing to sign.
        </div>
      ) : (
        <>
          <div className="psp-headline pfp-headline">
            <Metric label="Total" value={TX(totals.total)} sub={txPrice ? `$${formatCompact(totals.total * txPrice)}` : undefined} accent />
            <Metric label="Staked" value={TX(totals.staked)} sub={txPrice ? `$${formatCompact(totals.staked * txPrice)}` : undefined} />
            <Metric label="Liquid" value={TX(totals.liquid)} sub={txPrice ? `$${formatCompact(totals.liquid * txPrice)}` : undefined} />
            <Metric label="Unbonding" value={TX(totals.unbonding)} />
            <Metric label="Rewards" value={TX(totals.rewards)} />
          </div>

          {loading && (
            <div className="pfp-notice">
              Reading {wallets.length} wallet{wallets.length === 1 ? "" : "s"} from the chain...
            </div>
          )}
          {totals.failed > 0 && (
            <div className="pfp-notice">
              {totals.failed} wallet{totals.failed === 1 ? "" : "s"} could not be read just now,
              so the totals above are short by that much.
            </div>
          )}

          {/* What to do about it, rather than only what you hold. Each line is
              a fact with its own number; none of them is advice, and none
              appears unless it applies. */}
          {(idleWorth || totals.jailedStake.amountTX > 0 || totals.unlocks.length > 0) && (
            <div className="pfp-section">
              <div className="psp-list-head">Worth knowing</div>
              <div className="pfp-findings">
                {totals.jailedStake.amountTX > 0 && (
                  <div className="pfp-finding pfp-finding-warn">
                    <strong>{TX(totals.jailedStake.amountTX)}</strong> is delegated to{" "}
                    {totals.jailedStake.validators.length === 1
                      ? nameOf(totals.jailedStake.validators[0].validatorAddress)
                      : `${totals.jailedStake.validators.length} validators`}{" "}
                    that {totals.jailedStake.validators.length === 1 ? "is" : "are"} jailed or outside
                    the active set. Stake there earns nothing until that changes.
                    {totals.jailedStake.validators.length > 1 && (
                      <span className="pfp-finding-list">
                        {totals.jailedStake.validators
                          .slice(0, 4)
                          .map((v) => `${nameOf(v.validatorAddress)} (${TX(v.amountTX)})`)
                          .join(" · ")}
                        {totals.jailedStake.validators.length > 4 &&
                          ` · +${totals.jailedStake.validators.length - 4} more`}
                      </span>
                    )}
                  </div>
                )}
                {idleWorth && (
                  <div className="pfp-finding">
                    <strong>{TX(totals.liquid)}</strong> is liquid and not staked
                    {apr !== null && (
                      <>, which at the current network rate of {apr.toFixed(1)}% before commission
                      is about {TX((totals.liquid * apr) / 100)} a year</>
                    )}.
                  </div>
                )}
                {totals.unlocks.length > 0 && (
                  <div className="pfp-finding">
                    <strong>{TX(totals.unbonding)}</strong> unbonding.
                    {" "}Next {TX(totals.unlocks[0].amountTX)} unlocks {fullDate(totals.unlocks[0].completionTime)}
                    {totals.unlocks.length > 1 && `, then ${totals.unlocks.length - 1} more`}.
                  </div>
                )}
              </div>
            </div>
          )}

          {totals.exposure.length > 0 && (
            <div className="pfp-section">
              <div className="psp-list-head">
                Validator exposure across every wallet
              </div>
              {/* The whole reason the panel exists. Concentration is invisible
                  one wallet at a time, so it is stated in words as well as
                  drawn, and only when it is actually high. We run a validator,
                  so this says what the number is and stops there. */}
              {top && top.pct >= 33 && (
                <div className="pfp-flag">
                  {top.pct.toFixed(0)}% of your staked TX sits with {nameOf(top.validatorAddress)}.
                </div>
              )}
              <div className="psp-bars pfp-bars">
                {totals.exposure.slice(0, 10).map((e) => (
                  <div key={e.validatorAddress} className="psp-bar-row">
                    <div className="psp-bar-head">
                      <span className="psp-bar-name">{nameOf(e.validatorAddress)}</span>
                      <span className="psp-bar-val">
                        {TX(e.amountTX)} <span className="psp-bar-pct">{e.pct.toFixed(0)}%</span>
                      </span>
                    </div>
                    <div className="psp-bar-track">
                      <div className="psp-bar-fill psp-fill-staked" style={{ width: `${Math.max(e.pct, 0.5)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {totals.tokens.length > 0 && (
            <div className="pfp-section">
              <div className="psp-list-head">Other tokens held</div>
              <div className="psp-kv-grid">
                {totals.tokens.slice(0, 8).map((t) => (
                  <div className="psp-kv" key={t.symbol}>
                    <span className="psp-kv-label">{t.symbol}</span>
                    <span className="psp-kv-value">{formatCompact(t.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="pfp-section">
            <button
              type="button"
              className="pfp-toggle"
              onClick={() => setShowBreakdown((v) => !v)}
              aria-expanded={showBreakdown}
            >
              {showBreakdown ? "Hide" : "Show"} per-wallet breakdown ({wallets.length})
            </button>
            {showBreakdown && (
              <div className="pfp-rows">
                {sortedRows.map((r) => (
                  <div key={r.wallet.address} className="pfp-row">
                    <div className="pfp-row-id">
                      {editing === r.wallet.address ? (
                        <input
                          className="pfp-input pfp-input-inline"
                          defaultValue={r.wallet.label ?? ""}
                          autoFocus
                          placeholder="Name"
                          onBlur={(e) => { setWallets(renameWallet(r.wallet.address, e.target.value)); setEditing(null); }}
                          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                        />
                      ) : (
                        <button type="button" className="pfp-row-label" onClick={() => setEditing(r.wallet.address)}>
                          {r.wallet.label || "Unnamed"}
                        </button>
                      )}
                      <span className="pfp-row-addr mono">{shortAddr(r.wallet.address)}</span>
                    </div>
                    <div className="pfp-row-nums mono">
                      {r.failed ? (
                        <span className="psp-bar-pct">unreachable</span>
                      ) : r.data ? (
                        <>
                          <span>{TX(r.data.stakedTX)} staked</span>
                          <span>{TX(r.data.balanceTX)} liquid</span>
                        </>
                      ) : (
                        <span className="psp-bar-pct">loading...</span>
                      )}
                    </div>
                    <div className="pfp-row-actions">
                      {onOpenPassport && (
                        <button type="button" className="psp-topbar-btn ghost" onClick={() => onOpenPassport(r.wallet.address)}>
                          Open
                        </button>
                      )}
                      <button
                        type="button"
                        className="psp-topbar-btn ghost pfp-danger"
                        onClick={() => setWallets(removeWallet(r.wallet.address))}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  className="psp-topbar-btn ghost pfp-danger pfp-clear"
                  onClick={() => { setWallets(clearWallets()); setNotice("Wallet list cleared."); }}
                >
                  Remove all
                </button>
              </div>
            )}
          </div>

          {/* People assume splitting stake across wallets costs them PSE. It
              does not, and a combined view is exactly where that comes up. */}
          <p className="pfp-foot">
            PSE score is stake multiplied by staking duration, so splitting the same stake
            across several wallets earns the same as holding it in one. Rewards are still
            paid per address.
          </p>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="psp-metric">
      <span className="psp-metric-label">{label}</span>
      <span className={`psp-metric-value${accent ? " psp-metric-accent" : ""}`}>{value}</span>
      {sub && <span className="psp-metric-sub">{sub}</span>}
    </div>
  );
}
