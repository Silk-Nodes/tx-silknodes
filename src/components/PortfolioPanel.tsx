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
import { formatCompact, relativeTimeShort } from "@/lib/ui-format";
import Tooltip from "@/components/Tooltip";
import {
  fetchAddressChainData,
  fetchBondedTokens,
  fetchStakingApr,
  fetchStakingParams,
  fetchValidatorMeta,
  type AddressChainData,
  type ValidatorMeta,
} from "@/lib/passport";
import { fetchOnChainPSEScore, layeredPSEEstimate } from "@/lib/pse-calculator";
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
  refreshKey = 0,
}: {
  connectedAddress?: string;
  txPrice?: number;
  onOpenPassport?: (address: string) => void;
  /** Bumped when the wallet list changes elsewhere on the page, so adding a
   *  wallet from the passport below updates this panel instead of needing a
   *  reload to notice. */
  refreshKey?: number;
}) {
  const [wallets, setWallets] = useState<SavedWallet[]>([]);
  const [rows, setRows] = useState<WalletRow[]>([]);
  const [vmeta, setVmeta] = useState<Record<string, ValidatorMeta>>({});
  const [apr, setApr] = useState<number | null>(null);
  const [unbondingDays, setUnbondingDays] = useState<number | null>(null);
  const [bonded, setBonded] = useState(0);
  // Combined PSE. Score is stake x duration, which is linear, so summing the
  // per-wallet scores gives exactly what one wallet holding the same total
  // would score. No approximation is involved.
  const [pse, setPse] = useState<{ monthly: number; sharePct: number; source: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  // When the figures were last read. Numbers about someone's money should say
  // how old they are; a tab left open all afternoon otherwise shows this
  // morning's balances with nothing to indicate it.
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  // Re-render on a timer so the relative age counts up on its own instead of
  // freezing at "just now" until something else causes a render.
  const [, setTick] = useState(0);

  // localStorage is only readable after mount, so the list starts empty and
  // fills in on the client. Rendering server-side would hydrate mismatched.
  useEffect(() => {
    setWallets(loadWallets());
  }, [refreshKey]);

  useEffect(() => {
    fetchValidatorMeta().then(setVmeta).catch(() => {});
    fetchStakingApr().then(setApr).catch(() => {});
    fetchBondedTokens().then(setBonded).catch(() => {});
    fetchStakingParams()
      .then((p) => setUnbondingDays(p ? p.unbondingSeconds / 86400 : null))
      .catch(() => {});
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
    // Bounded concurrency, for the same reason the API routes got it: each
    // wallet is five LCD reads plus one per token held, so ten wallets fired
    // through Promise.all is well over a hundred simultaneous requests to
    // public nodes we do not own. Three at a time keeps a full portfolio
    // responsive without making a burst of traffic from every page load.
    const CONCURRENCY = 3;
    const settled: WalletRow[] = new Array(list.length);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, list.length) }, async () => {
        for (;;) {
          const i = next++;
          if (i >= list.length) return;
          const wallet = list[i];
          try {
            settled[i] = { wallet, data: await fetchAddressChainData(wallet.address), failed: false };
          } catch {
            settled[i] = { wallet, data: null, failed: true };
          }
          // Render each wallet as it lands rather than waiting for the slowest.
          setRows(settled.filter(Boolean));
        }
      }),
    );
    setRows(settled);
    setFetchedAt(Date.now());
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh(wallets);
  }, [wallets, refresh]);

  useEffect(() => {
    if (!fetchedAt) return;
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [fetchedAt]);

  // Combined PSE standing. Scores are summed as BigInt because they are raw
  // ucore-seconds and overflow a double: a single large staker is already past
  // 2^53. Getting this wrong would silently round the reader's standing.
  useEffect(() => {
    const addrs = rows.filter((r) => r.data && r.data.stakedTX > 0).map((r) => r.wallet.address);
    const stake = rows.reduce((n, r) => n + (r.data?.stakedTX ?? 0), 0);
    if (addrs.length === 0 || bonded <= 0) { setPse(null); return; }
    let cancelled = false;
    (async () => {
      const [scores, net] = await Promise.all([
        Promise.all(addrs.map((a) => fetchOnChainPSEScore(a).catch(() => null))),
        fetch("/api/pse-score").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      if (cancelled) return;
      // BigInt(0) rather than the 0n literal: tsconfig targets ES2017, which
      // predates BigInt literals. The runtime supports BigInt regardless.
      let sum = BigInt(0);
      let any = false;
      for (const sc of scores) {
        if (!sc) continue;
        try { sum += BigInt(sc); any = true; } catch { /* unparseable, skip */ }
      }
      const est = layeredPSEEstimate({
        userStake: stake,
        userScore: any ? sum.toString() : null,
        networkTotalScore: net?.networkTotalScore ?? null,
        lastDistTotalScore: null,
        bondedTokens: bonded,
        excludedStake: 0,
      });
      // Two honest answers here, and which one you get depends on the wallets.
      //
      // onchain_score is the share your accrued score entitles you to RIGHT
      // NOW. stake_ratio is what you would get if you stayed staked for the
      // whole cycle. They can differ by orders of magnitude, because PSE
      // scores reset at each distribution and restart on redelegation: two
      // wallets tested here had an implied staking age of 0.2 days against a
      // network average near 16.6, so their instantaneous share was tiny and
      // their full-cycle projection was not.
      //
      // Blanking it, which is what this did before, answers neither. Both are
      // shown now, labelled with which question they answer, because a number
      // whose basis is unstated is the thing worth avoiding, not the fallback
      // itself.
      setPse(
        est.estimate > 0
          ? { monthly: est.estimate, sharePct: est.sharePct, source: est.source }
          : null,
      );
    })();
    return () => { cancelled = true; };
  }, [rows, bonded]);

  const totals = useMemo(() => {
    let liquid = 0, staked = 0, unbonding = 0, rewards = 0, failed = 0;
    const byValidator = new Map<string, number>();
    // Non-TX holdings merged by DENOM, not by ticker.
    //
    // Ticker is not unique on this chain and it is not close. 45 symbols are
    // claimed by more than one token: UUSDC resolves to 82 distinct denoms
    // (different IBC paths), XRP to two unrelated ones, and anyone can issue a
    // smart token using a ticker someone else already uses. Summing by symbol
    // would silently add unrelated balances together and present the result as
    // one holding, which is worse than not showing it at all.
    const byToken = new Map<string, { symbol: string; amount: number }>();
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
        const prev = byToken.get(t.denom);
        byToken.set(t.denom, {
          symbol: t.symbol,
          amount: (prev?.amount ?? 0) + t.displayAmount,
        });
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

    const tokenRows = [...byToken.entries()]
      // Dust rounds to "0" once formatted, which reads as a bug rather than a
      // tiny balance. Filter on what will actually be rendered, not on the raw
      // amount: formatCompact(0.4) is "0", so a >0 test does not catch it.
      .filter(([, t]) => formatCompact(t.amount) !== "0")
      .map(([denom, t]) => ({ denom, symbol: t.symbol, amount: t.amount }))
      .sort((a, b) => b.amount - a.amount);
    // Where a ticker is genuinely shared by two held tokens, say so rather
    // than showing two identical-looking rows.
    const symbolCounts = new Map<string, number>();
    for (const t of tokenRows) symbolCounts.set(t.symbol, (symbolCounts.get(t.symbol) ?? 0) + 1);
    const tokens = tokenRows.map((t) => ({
      ...t,
      ambiguous: (symbolCounts.get(t.symbol) ?? 0) > 1,
    }));
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
            {fetchedAt && (
              <span className="pfp-stamp" aria-live="polite">
                {loading ? "updating..." : `updated ${relativeTimeShort(fetchedAt)}`}
              </span>
            )}
            <button
              type="button"
              className="psp-topbar-btn ghost"
              onClick={() => refresh(wallets)}
              disabled={loading}
            >
              Refresh
            </button>
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

          <div className="psp-headline pfp-headline pfp-headline-sub">
            <Metric
              label="Share of network"
              value={bonded > 0 ? `${((totals.staked / bonded) * 100).toFixed(3)}%` : "-"}
              sub={bonded > 0 ? `of ${formatCompact(bonded)} TX bonded` : undefined}
              tip="Your combined staked TX as a share of all bonded stake on the chain."
            />
            <Metric
              label="PSE per month"
              value={pse ? TX(pse.monthly) : "-"}
              sub={pse
                ? pse.source === "onchain_score" || pse.source === "last_dist_reference"
                  ? "accrued so far this cycle"
                  : "projected, if staked all cycle"
                : "score unavailable"}
              tip={
                pse && (pse.source === "onchain_score" || pse.source === "last_dist_reference")
                  ? `Your share of the monthly PSE pool from the score your wallets have actually accrued so far this cycle, currently ${pse.sharePct < 0.0001 ? "under 0.0001" : pse.sharePct.toFixed(4)}%. Score is stake multiplied by staking duration and resets at each distribution, so this grows through the cycle as long as you stay staked.`
                  : "PSE scores reset at each distribution and restart when you redelegate, so your wallets have not accrued a full cycle yet. This is what the same stake would earn across a whole cycle, from your share of total bonded stake. Splitting stake across wallets changes nothing either way."
              }
            />
            <Metric
              label="Wallets"
              value={String(wallets.length)}
              sub={`of ${MAX_WALLETS} tracked`}
            />
            <Metric
              label="Validators"
              value={String(totals.exposure.length)}
              sub={totals.exposure.length > 0 ? "delegated to" : undefined}
            />
            <Metric
              label="Unbonding takes"
              value={unbondingDays !== null ? `${unbondingDays} days` : "-"}
              sub="chain parameter"
              tip="How long unstaked TX is locked before it can be moved. Read live from the chain's staking parameters, since governance can change it."
            />
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
              <div className="psp-list-head">
                Worth knowing
                <Tooltip
                  position="bottom"
                  text="Only what currently applies to your wallets. Nothing here is a recommendation. Silk Nodes runs a validator, so this states the numbers and leaves the decision alone."
                />
              </div>
              <div className="pfp-findings">
                {totals.jailedStake.amountTX > 0 && (
                  <div className="pfp-finding pfp-finding-warn">
                    <strong>{TX(totals.jailedStake.amountTX)}</strong> is delegated to{" "}
                    {totals.jailedStake.validators.length === 1
                      ? nameOf(totals.jailedStake.validators[0].validatorAddress)
                      : `${totals.jailedStake.validators.length} validators`}{" "}
                    that {totals.jailedStake.validators.length === 1 ? "is" : "are"} jailed or
                    inactive, earning nothing.
                    <Tooltip
                      position="top"
                      text="A jailed validator has been removed from the active set for downtime or misbehaviour and stops producing blocks. Stake delegated to it earns no rewards until you redelegate, which does not happen automatically."
                    />
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
                      <>, worth about {TX((totals.liquid * apr) / 100)} a year if staked</>
                    )}.
                    {apr !== null && (
                      <Tooltip
                        position="top"
                        text={`At the current network rate of ${apr.toFixed(1)}%, derived live from annual provisions less community tax over total bonded stake. Quoted before commission, since what you receive depends on the validators you pick.`}
                      />
                    )}
                  </div>
                )}
                {totals.unlocks.length > 0 && (
                  <div className="pfp-finding">
                    <strong>{TX(totals.unbonding)}</strong> is unbonding and cannot be moved or
                    staked until it completes
                    {unbondingDays !== null && ` (${unbondingDays} days on this chain)`}.
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
                <Tooltip
                  position="bottom"
                  text="Your stake grouped by validator instead of by wallet. Delegating from four wallets to one validator is the same concentration as delegating once, and only this view shows it. If that validator is jailed or slashed, all of it is affected together."
                />
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
              <div className="psp-list-head">
                Other tokens held
                <Tooltip
                  position="bottom"
                  text="Non-TX balances across all your wallets. Smart tokens issued on TX, and assets bridged in over IBC. Merged by denom rather than ticker, because tickers are not unique on this chain: 45 of them are claimed by more than one token, so summing by name would add unrelated balances together."
                />
              </div>
              <div className="psp-kv-grid">
                {totals.tokens.slice(0, 8).map((t) => (
                  <div className="psp-kv" key={t.denom}>
                    <span className="psp-kv-label">
                      {t.symbol}
                      {t.ambiguous && (
                        <span className="pfp-denom-hint" title={t.denom}>
                          {" "}
                          {t.denom.startsWith("ibc/") ? "ibc" : t.denom.slice(-6)}
                        </span>
                      )}
                    </span>
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

          {/* The detail lives in the tooltip. Long explanatory paragraphs
              were pushing the actual numbers off the screen. */}
          <p className="pfp-foot">
            Read from the chain in your browser, one wallet at a time.
            <Tooltip
              position="top"
              text="Every figure here is fetched directly from the chain by your browser and added up locally, so nothing about which wallets you track reaches our servers. PSE score is stake multiplied by staking duration, which is linear, so splitting the same stake across wallets earns exactly what holding it in one would; rewards are still paid per address. The staking rate is derived live from annual provisions less community tax over total bonded, quoted before commission."
            />
          </p>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, sub, accent, tip }: {
  label: string; value: string; sub?: string; accent?: boolean; tip?: string;
}) {
  return (
    <div className="psp-metric">
      <span className="psp-metric-label">
        {label}
        {tip && <Tooltip text={tip} position="bottom" />}
      </span>
      <span className={`psp-metric-value${accent ? " psp-metric-accent" : ""}`}>{value}</span>
      {sub && <span className="psp-metric-sub">{sub}</span>}
    </div>
  );
}
