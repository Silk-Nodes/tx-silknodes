"use client";

// Manage the connected wallet. Position-first, actions on demand.
//
// The previous layout kept a three-tab action form permanently on screen
// beside the delegations list. The form's height swings with its state
// (empty notice, full validator list, warning boxes) and the list's with
// delegation count, so the two columns could not be balanced; every fix
// relocated the void. That is a pattern problem, not a padding problem.
//
// This follows what Keplr, Cosmostation and the current generation of
// staking dashboards converged on:
//   - your delegations ARE the page: full-width rows with a Manage action
//   - the action form is a dialog, opened from Stake TX or a row's Manage,
//     pre-filled with that row's validator
//   - the validator picker lives inside the flow, not resident on the page
//
// Behaviour carried over from the old panel:
//   - MAX reserves 0.1 TX for gas
//   - undelegate takes two clicks, with the PSE consequences stated between
//   - redelegate hides the source validator from the destination list
//   - cancel-unbonding confirms in its own dialog, because it moves stake
//   - Silk Nodes is pinned to the top of the picker and labelled REC; the
//     rest of the list is shuffled so we do not silently rank anyone else

import { useEffect, useMemo, useState } from "react";
import { fetchStakingParams } from "@/lib/passport";

const GAS_RESERVE = 0.1;

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/**
 * A TX amount belonging to the reader: their balance, their delegation, the
 * amount they are about to sign for.
 *
 * ucore carries six decimals, and rounding a holder's own stake to a whole
 * token hides real value. 40.218195 TX rendered as "40 TX" reads as a bug to
 * the person who staked it, and it disagrees with every explorer. Trailing
 * zeros are dropped, so a round number stays "100 TX" rather than
 * "100.000000 TX".
 *
 * fmt() stays for aggregate figures like a validator's total stake, where a
 * decimal on a nine-figure number is noise.
 */
const fmtTX = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 6 });

/** Fiat, which is always two decimals regardless of the token precision. */
const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtRewards = (n: number) =>
  n > 1 ? fmt(n) : n < 0.01 ? n.toFixed(6) : n.toFixed(2);

type Mode = "add" | "redelegate" | "undelegate";

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function WalletActions({
  wallet, price, apr, bondedTokens, pseEligibleBonded,
  pseInfo, claimRewards, delegate, undelegate, redelegate, cancelUnbonding,
  txPending, chainUnreachable, pseProjectionTX,
}: any) {
  // The stake dialog. null = closed. sourceValidator is set when opened from
  // a delegation row, so the dialog starts on that validator.
  const [dialog, setDialog] = useState<{ mode: Mode; sourceValidator: string } | null>(null);
  const [amount, setAmount] = useState("");
  const [destValidator, setDestValidator] = useState("");
  const [validatorSearch, setValidatorSearch] = useState("");
  const [validators, setValidators] = useState<any[]>([]);
  const [validatorsLoading, setValidatorsLoading] = useState(true);
  const [confirmUndelegate, setConfirmUndelegate] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<any | null>(null);
  // Read live rather than written down: a hardcoded "7-day" here went stale
  // the moment governance could change the parameter.
  const [unbondingDays, setUnbondingDays] = useState<number | null>(null);

  useEffect(() => {
    import("@/lib/api").then(({ fetchAllValidators }) => {
      fetchAllValidators(price).then((vals: any[]) => {
        setValidators(vals);
        setValidatorsLoading(false);
      });
    });
  }, [price]);

  useEffect(() => {
    fetchStakingParams()
      .then((p) => setUnbondingDays(p ? Math.round(p.unbondingSeconds / 86400) : null))
      .catch(() => {});
  }, []);

  const filteredValidators = useMemo(() => {
    const filtered = validators.filter((v: any) =>
      v.moniker.toLowerCase().includes(validatorSearch.toLowerCase()),
    );
    // Shuffled so we do not silently rank anyone; only our own pin is
    // explicit, and it is labelled.
    for (let i = filtered.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [filtered[i], filtered[j]] = [filtered[j], filtered[i]];
    }
    const silkIndex = filtered.findIndex((v: any) => v.moniker === "Silk Nodes");
    if (silkIndex > 0) {
      const [silk] = filtered.splice(silkIndex, 1);
      filtered.unshift(silk);
    }
    return filtered;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validators, validatorSearch]);

  const nextDistDate = pseInfo.nextDistribution.toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
  // Deliberately NOT estimatePSE(stakedAmount). That falls through to the
  // stake-ratio layer, which answers "if this stake had been bonded all
  // cycle" and read ~6 TX for a wallet whose accrued score was worth ~1. The
  // PSE history block below states the score-based figure, so the two sat 6x
  // apart on one screen with nothing explaining the gap. This strip now shows
  // the same basis: the live score against the last settled cycle total.
  const nextPSEReward = pseProjectionTX ?? 0;

  const openDialog = (mode: Mode, sourceValidator = "") => {
    setDialog({ mode, sourceValidator });
    setAmount("");
    // "Add" from a delegation row starts on that validator, changeable in the
    // picker. Redelegate must NOT preselect it: the source cannot be the
    // destination, and the picker excludes it.
    setDestValidator(mode === "add" ? sourceValidator : "");
    setValidatorSearch("");
    setConfirmUndelegate(false);
  };
  const closeDialog = () => { if (!txPending) setDialog(null); };
  const setMode = (mode: Mode) => {
    setDialog((d) => (d ? { ...d, mode } : d));
    setAmount("");
    setDestValidator("");
    setConfirmUndelegate(false);
  };

  const sourceInfo = dialog
    ? wallet.delegations.find((d: any) => d.validatorAddress === dialog.sourceValidator)
    : null;
  const destInfo = validators.find((v: any) => v.operatorAddress === destValidator);
  const parsedAmount = parseFloat(amount.replace(/,/g, "")) || 0;
  const maxAmount = dialog
    ? dialog.mode === "add"
      ? Math.max(0, wallet.balance - GAS_RESERVE)
      : sourceInfo?.amount || 0
    : 0;

  const canSubmit =
    !txPending && parsedAmount > 0 && parsedAmount <= maxAmount &&
    (dialog?.mode === "add"
      ? !!destValidator
      : dialog?.mode === "redelegate"
        ? !!destValidator && !!sourceInfo
        : !!sourceInfo);

  const handleSubmit = async () => {
    if (!dialog || !canSubmit) return;
    if (dialog.mode === "add") {
      await delegate(destValidator, parsedAmount);
    } else if (dialog.mode === "undelegate") {
      if (!confirmUndelegate) { setConfirmUndelegate(true); return; }
      await undelegate(dialog.sourceValidator, parsedAmount);
    } else {
      await redelegate(dialog.sourceValidator, destValidator, parsedAmount);
    }
    setDialog(null);
    setAmount("");
  };

  const picker = (excludeSource: boolean) => (
    <>
      <input
        type="text"
        className="wa-input wa-search"
        value={validatorSearch}
        onChange={(e) => setValidatorSearch(e.target.value)}
        placeholder="Search validators..."
        aria-label="Search validators"
      />
      <div className="wa-vlist">
        {validatorsLoading ? (
          <div className="wa-vlist-loading">Loading validators...</div>
        ) : (
          filteredValidators
            .filter((v: any) => !excludeSource || v.operatorAddress !== dialog?.sourceValidator)
            .map((v: any) => {
              const isSilk = v.moniker === "Silk Nodes";
              const isSelected = destValidator === v.operatorAddress;
              return (
                <button
                  type="button"
                  key={v.operatorAddress}
                  onClick={() => setDestValidator(v.operatorAddress)}
                  className={`wa-vrow${isSelected ? " is-selected" : ""}${isSilk ? " is-silk" : ""}`}
                >
                  <span className="wa-vrow-name">
                    {isSilk && <span className="wa-rec">REC</span>}
                    {v.moniker}
                  </span>
                  <span className="wa-vrow-meta">
                    <span>{v.commission}%</span>
                    <span className="mono">{fmt(v.tokens)} TX</span>
                    {isSelected && <span className="wa-vrow-selected">Selected</span>}
                  </span>
                </button>
              );
            })
        )}
      </div>
    </>
  );

  const amountField = (danger = false) => (
    <>
      <div className="wa-field-head">
        <span className="wa-field-label">Amount</span>
        <span className="wa-field-hint">
          {dialog?.mode === "add" ? "Available" : "Max"}: {fmtTX(maxAmount)} TX
        </span>
      </div>
      <div className="wa-amount">
        <input
          type="text"
          inputMode="decimal"
          className={`wa-input mono${danger ? " is-danger" : ""}`}
          value={amount}
          onChange={(e) => { setAmount(e.target.value.replace(/[^0-9.]/g, "")); setConfirmUndelegate(false); }}
          placeholder="0"
          aria-label="Amount"
        />
        <button
          type="button"
          className={`wa-max${danger ? " is-danger" : ""}`}
          onClick={() => setAmount(maxAmount.toFixed(0))}
        >
          MAX
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* ── Strip: what you have, what is coming, the two actions ── */}
      <div className="wa-strip">
        <div className="wa-strip-top">
        <div className="wa-stat">
          <span className="wa-stat-label">Available</span>
          <span className="wa-stat-value mono">{fmtTX(wallet.balance)} TX</span>
        </div>
        <div className="wa-darkcard wa-strip-pse" title={`Your accrued score measured against the last settled cycle, paid ${nextDistDate}. Not a promise: the final share depends on every delegator at the snapshot block.`}>
          <span className="wa-stat-label on-dark">Cycle #{pseInfo.currentCycle} so far</span>
          <span className="wa-stat-value mono neon">~{fmt(nextPSEReward)} TX</span>
        </div>
        <div className="wa-strip-spacer" />
        <div className="wa-strip-claim">
          <div className="wa-stat align-right">
            <span className="wa-stat-label">Rewards</span>
            <span className="wa-stat-value mono earn">{fmtRewards(wallet.rewards)} TX</span>
          </div>
          <button
            type="button"
            className="wa-btn-ghost wa-claim-ghost"
            onClick={claimRewards}
            disabled={txPending || wallet.rewards <= 0}
          >
            {txPending ? "..." : "Claim"}
          </button>
          {/* The one primary action on the page. */}
          <button type="button" className="btn-olive wa-stake" onClick={() => openDialog("add")}>
            Stake TX
          </button>
        </div>
        </div>

        {/* Context for the figures above, inside the same card. */}
        <div className="wa-darkcard wa-statline">
          <div>
            <span className="wa-stat-label on-dark">Base APR</span>
            <span className="wa-info-value mono">{apr.toFixed(2)}%</span>
          </div>
          <div>
            <span className="wa-stat-label on-dark">PSE eligible bonded</span>
            <span className="wa-info-value mono">{fmtTX(pseEligibleBonded)} TX</span>
          </div>
          <div>
            <span className="wa-stat-label on-dark">Next PSE</span>
            <span className="wa-info-value mono">{nextDistDate}</span>
          </div>
        </div>
      </div>

      {/* ── Delegations: the page itself. Full width, actions per row. ── */}
      <div className="wa-card wa-delegations">
        <div className="wa-side-head">
          <span>Active delegations</span>
          <span className="mono">{wallet.delegations.length} validator{wallet.delegations.length === 1 ? "" : "s"}</span>
        </div>
        {chainUnreachable ? (
          /* An outage must never be reported as "you have nothing staked".
             Zeros here are indistinguishable from a real empty wallet, and a
             holder seeing their stake vanish has every reason to panic. */
          <div className="wa-empty-cta">
            <p className="wa-unreachable">
              Your delegations could not be read: every chain node we tried is unreachable.
              This is our problem, not your wallet. Nothing has changed on chain, and the
              figures above may be stale.
            </p>
            <button type="button" className="wa-btn-ghost wa-retry" onClick={() => location.reload()}>
              Try again
            </button>
          </div>
        ) : wallet.delegations.length === 0 ? (
          <div className="wa-empty-cta">
            <p>No delegations yet. Staked TX earns the base APR plus monthly PSE.</p>
            <button type="button" className="btn-olive wa-stake" onClick={() => openDialog("add")}>
              Stake TX
            </button>
          </div>
        ) : (
          wallet.delegations.map((del: any) => {
            const vp = bondedTokens > 0 ? (del.amount / bondedTokens) * 100 : 0;
            return (
              <div key={del.validatorAddress} className="wa-drow">
                <div className="wa-drow-id">
                  <span className="wa-delrow-name">{del.validatorMoniker}</span>
                  <span className="wa-drow-meta">VP {vp.toFixed(3)}%</span>
                </div>
                <div className="wa-drow-nums">
                  <span className="mono wa-delrow-amount">{fmtTX(del.amount)} TX</span>
                  <span className="wa-drow-meta">{price > 0 ? `$${fmtUsd(del.amount * price)}` : ""}</span>
                </div>
                <div className="wa-drow-rewards">
                  {del.rewards > 0.01 && <span className="wa-delrow-rewards">+{fmtRewards(del.rewards)} TX</span>}
                </div>
                <div className="wa-drow-actions">
                  <button type="button" className="psp-topbar-btn ghost" onClick={() => openDialog("add", del.validatorAddress)}>
                    Add
                  </button>
                  <button type="button" className="psp-topbar-btn ghost" onClick={() => openDialog("redelegate", del.validatorAddress)}>
                    Redelegate
                  </button>
                  <button type="button" className="psp-topbar-btn ghost pfp-danger" onClick={() => openDialog("undelegate", del.validatorAddress)}>
                    Undelegate
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── Unbonding, only when there is any ── */}
      {wallet.unbondingDelegations.length > 0 && (
        <div className="wa-card">
          <div className="wa-side-head">
            <span>Unbonding</span>
            <span className="mono">{wallet.unbondingDelegations.length} {wallet.unbondingDelegations.length === 1 ? "entry" : "entries"}</span>
          </div>
          <div className="wa-darkcard wa-nudge">
            <strong>Cancel to keep your PSE score intact.</strong>{" "}
            Cancelling restores stake to the same validator and preserves your accumulated
            PSE history. Letting unbonding complete resets it.
          </div>
          {wallet.unbondingDelegations.map((u: any, i: number) => {
            const completeDate = new Date(u.completionTime);
            const daysLeft = Math.max(0, Math.ceil((completeDate.getTime() - Date.now()) / 86400000));
            const canCancel = !!u.creationHeight && daysLeft > 0;
            return (
              <div key={i} className="wa-delrow">
                <div className="wa-delrow-top">
                  <span className="wa-delrow-name">{u.validatorMoniker}</span>
                  <span className="mono wa-delrow-amount">{fmtTX(u.amount)} TX</span>
                </div>
                <div className="wa-delrow-sub">
                  <span className="wa-unbond-time">
                    {daysLeft > 0
                      ? `${daysLeft} day${daysLeft > 1 ? "s" : ""} remaining, ${completeDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                      : "Ready to claim"}
                  </span>
                  {canCancel && (
                    <button
                      type="button"
                      className="wa-cancel"
                      onClick={() => setCancelTarget(u)}
                      disabled={txPending}
                      title="Restore stake and preserve PSE score"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Stake dialog ── */}
      {dialog && (
        <>
          <div className="wa-modal-backdrop" onClick={closeDialog} />
          <div className="wa-modal wa-modal-wide" role="dialog" aria-modal="true" aria-label="Manage stake">
            <div className="wa-modal-head">
              {sourceInfo ? `Manage stake · ${sourceInfo.validatorMoniker}` : "Stake TX"}
            </div>

            {/* Mode tabs only where more than one mode applies: a fresh stake
                from the strip has no source to undelegate or move. */}
            {sourceInfo && (
              <div className="wa-tabs">
                {(["add", "redelegate", "undelegate"] as Mode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`wa-tab${dialog.mode === m ? " active" : ""}`}
                    onClick={() => setMode(m)}
                  >
                    {m === "add" ? "Add stake" : m}
                  </button>
                ))}
              </div>
            )}

            <div className="wa-modal-body">
              {dialog.mode === "add" && (
                <>
                  {amountField()}
                  <div className="wa-field-head">
                    <span className="wa-field-label">Validator</span>
                  </div>
                  {/* Opened from a row: that validator is preselected but
                      changeable. Opened from Stake TX: pick one. */}
                  {picker(false)}
                  <p className="wa-note">
                    Must stay staked until the next PSE distribution ({nextDistDate}) to earn PSE rewards.
                  </p>
                </>
              )}

              {dialog.mode === "redelegate" && sourceInfo && (
                <>
                  {amountField()}
                  <div className="wa-field-head">
                    <span className="wa-field-label">Move to</span>
                  </div>
                  {picker(true)}
                  <div className="wa-benefits">
                    <span>Instant, no unbonding period</span>
                    <span>PSE score preserved</span>
                    <span>Staking rewards continue without interruption</span>
                  </div>
                </>
              )}

              {dialog.mode === "undelegate" && sourceInfo && (
                <>
                  {amountField(true)}
                  <div className="wa-warn">
                    <span className="wa-warn-title">Before you undelegate</span>
                    <ul>
                      <li>
                        <strong>{unbondingDays !== null ? `${unbondingDays}-day` : "An"} unbonding period</strong>: tokens locked, cannot transfer
                      </li>
                      <li><strong>No PSE rewards</strong> accrue during unbonding</li>
                      <li>Undelegating before <strong>{nextDistDate}</strong> forfeits this cycle&apos;s PSE</li>
                      <li>No staking rewards during unbonding</li>
                    </ul>
                  </div>
                </>
              )}
            </div>

            <div className="wa-modal-actions">
              <button type="button" className="wa-btn-ghost" onClick={closeDialog} disabled={txPending}>
                Cancel
              </button>
              {dialog.mode === "undelegate" ? (
                confirmUndelegate ? (
                  <button type="button" className="wa-btn-danger-solid wa-modal-submit" onClick={handleSubmit} disabled={!canSubmit}>
                    {txPending ? "Processing..." : "Yes, undelegate"}
                  </button>
                ) : (
                  <button type="button" className="wa-btn-danger wa-modal-submit" onClick={handleSubmit} disabled={!canSubmit}>
                    Undelegate {parsedAmount > 0 ? `${fmtTX(parsedAmount)} TX` : ""}
                  </button>
                )
              ) : (
                <button type="button" className="btn-olive wa-modal-submit" onClick={handleSubmit} disabled={!canSubmit}>
                  {txPending
                    ? "Processing..."
                    : dialog.mode === "add"
                      ? `Delegate${parsedAmount > 0 ? ` ${fmtTX(parsedAmount)} TX` : ""}${destInfo ? ` to ${destInfo.moniker}` : ""}`
                      : `Redelegate${parsedAmount > 0 ? ` ${fmtTX(parsedAmount)} TX` : ""}`}
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── Cancel-unbonding confirmation ── */}
      {cancelTarget && (
        <>
          <div className="wa-modal-backdrop" onClick={() => !txPending && setCancelTarget(null)} />
          <div className="wa-modal" role="dialog" aria-modal="true" aria-label="Cancel unbonding">
            <div className="wa-modal-head">Cancel unbonding</div>
            <div className="wa-modal-body">
              <div className="wa-modal-facts">
                <div><span>Validator</span><strong>{cancelTarget.validatorMoniker}</strong></div>
                <div><span>Amount</span><strong className="mono earn">{fmtTX(cancelTarget.amount)} TX</strong></div>
              </div>
              <p className="wa-modal-note">
                Your stake will be restored to <strong>{cancelTarget.validatorMoniker}</strong> and
                your accumulated PSE score will be preserved. The unbonding entry will be removed.
              </p>
            </div>
            <div className="wa-modal-actions">
              <button type="button" className="wa-btn-ghost" onClick={() => setCancelTarget(null)} disabled={txPending}>
                Keep unbonding
              </button>
              <button
                type="button"
                className="btn-olive wa-claim"
                disabled={txPending}
                onClick={async () => {
                  const t = cancelTarget;
                  await cancelUnbonding(t.validatorAddress, t.amount, t.creationHeight);
                  setCancelTarget(null);
                }}
              >
                {txPending ? "Processing..." : "Confirm cancel"}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
