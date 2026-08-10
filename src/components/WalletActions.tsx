"use client";

// Manage the connected wallet: delegate, undelegate, redelegate, claim.
//
// Rebuilt from the PortfolioTab function that lived inside page.tsx since
// before the design system existed: 819 lines, 138 inline style blocks, and
// hardcoded whites that made it a dark-only surface. This is where people
// sign transactions, so it should be the most trustworthy-looking part of
// the site, and it was the least.
//
// Every colour is a token now. The two deliberate exceptions are the dark
// green info cards (.wa-darkcard), whose background is fixed in BOTH themes,
// so their fixed light text is correct and not a theme bug.
//
// Behaviour is carried over unchanged from the old panel:
//   - MAX reserves 0.1 TX for gas
//   - undelegate takes two clicks, with the PSE consequences stated between
//   - redelegate hides the source validator from the destination list
//   - cancel-unbonding confirms in a modal, because it moves stake
//   - Silk Nodes is pinned to the top of the validator list and labelled REC;
//     the rest of the list is shuffled so we do not silently rank anyone else

import { useEffect, useMemo, useState } from "react";
import { fetchStakingParams } from "@/lib/passport";

const GAS_RESERVE = 0.1;

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const fmtRewards = (n: number) =>
  n > 1 ? fmt(n) : n < 0.01 ? n.toFixed(6) : n.toFixed(2);

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function WalletActions({
  wallet, price, apr, bondedTokens, pseEligibleBonded,
  pseInfo, claimRewards, delegate, undelegate, redelegate, cancelUnbonding,
  txPending, estimatePSE,
}: any) {
  const [actionTab, setActionTab] = useState<"delegate" | "undelegate" | "redelegate">("delegate");
  const [amount, setAmount] = useState("");
  const [selectedValidator, setSelectedValidator] = useState("");
  const [selectedSrcValidator, setSelectedSrcValidator] = useState("");
  const [validatorSearch, setValidatorSearch] = useState("");
  const [validators, setValidators] = useState<any[]>([]);
  const [validatorsLoading, setValidatorsLoading] = useState(true);
  const [confirmUndelegate, setConfirmUndelegate] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<any | null>(null);
  // Read live rather than written down. A previous version of this panel
  // hardcoded "7-day" in the undelegate warning, which goes silently stale
  // if governance ever changes the parameter.
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

  const selectedValInfo = validators.find((v: any) => v.operatorAddress === selectedValidator);
  const selectedSrcInfo = wallet.delegations.find((d: any) => d.validatorAddress === selectedSrcValidator);

  const parsedAmount = parseFloat(amount.replace(/,/g, "")) || 0;
  const maxDelegate = Math.max(0, wallet.balance - GAS_RESERVE);
  const maxSrc = selectedSrcInfo?.amount || 0;

  const nextDistDate = pseInfo.nextDistribution.toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });

  const handleAction = async () => {
    if (parsedAmount <= 0) return;
    if (actionTab === "delegate") {
      if (!selectedValidator) return;
      await delegate(selectedValidator, parsedAmount);
    } else if (actionTab === "undelegate") {
      if (!selectedSrcValidator) return;
      if (!confirmUndelegate) { setConfirmUndelegate(true); return; }
      await undelegate(selectedSrcValidator, parsedAmount);
      setConfirmUndelegate(false);
    } else {
      if (!selectedSrcValidator || !selectedValidator) return;
      await redelegate(selectedSrcValidator, selectedValidator, parsedAmount);
    }
    setAmount("");
  };

  useEffect(() => { setConfirmUndelegate(false); }, [actionTab, selectedSrcValidator]);

  const nextPSEReward = wallet.stakedAmount > 0 ? estimatePSE(wallet.stakedAmount) : 0;

  const switchTab = (tab: typeof actionTab) => {
    setActionTab(tab);
    setAmount("");
    setSelectedValidator("");
    setSelectedSrcValidator("");
  };

  const validatorList = (compact: boolean) => (
    <div className="wa-vlist">
      {validatorsLoading ? (
        <div className="wa-vlist-loading">Loading validators...</div>
      ) : (
        filteredValidators
          .filter((v: any) => !compact || v.operatorAddress !== selectedSrcValidator)
          .map((v: any) => {
            const isSilk = v.moniker === "Silk Nodes";
            const isSelected = selectedValidator === v.operatorAddress;
            return (
              <button
                type="button"
                key={v.operatorAddress}
                onClick={() => setSelectedValidator(v.operatorAddress)}
                className={`wa-vrow${isSelected ? " is-selected" : ""}${isSilk ? " is-silk" : ""}`}
              >
                <span className="wa-vrow-name">
                  {isSilk && <span className="wa-rec">REC</span>}
                  {v.moniker}
                </span>
                <span className="wa-vrow-meta">
                  <span>{v.commission}%</span>
                  {!compact && <span className="mono">{fmt(v.tokens)} TX</span>}
                  {isSelected && <span className="wa-vrow-selected">Selected</span>}
                </span>
              </button>
            );
          })
      )}
    </div>
  );

  return (
    <>
      {/* ── Wallet strip: what you have, what is coming, what to claim ── */}
      <div className="wa-strip">
        <div className="wa-stat">
          <span className="wa-stat-label">Available</span>
          <span className="wa-stat-value mono">{fmt(wallet.balance)} TX</span>
        </div>
        <div className="wa-darkcard wa-strip-pse" title={`Theoretical max assuming full cycle staking, paid ${nextDistDate}`}>
          <span className="wa-stat-label on-dark">Next PSE · #{pseInfo.currentCycle}</span>
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
            className="btn-olive wa-claim"
            onClick={claimRewards}
            disabled={txPending || wallet.rewards <= 0}
          >
            {txPending ? "..." : "Claim"}
          </button>
        </div>
      </div>

      <div className="wa-grid">
        {/* ── Left: the action panel ── */}
        <div className="wa-panel">
          <div className="wa-tabs">
            {(["delegate", "undelegate", "redelegate"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                className={`wa-tab${actionTab === tab ? " active" : ""}`}
                onClick={() => switchTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="wa-body">
            {actionTab === "delegate" && (
              <>
                <div className="wa-field-head">
                  <span className="wa-field-label">Amount</span>
                  <span className="wa-field-hint">Available: {fmt(maxDelegate)} TX</span>
                </div>
                <div className="wa-amount">
                  <input
                    type="text"
                    inputMode="decimal"
                    className="wa-input mono"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                    placeholder="0"
                    aria-label="Amount to delegate"
                  />
                  <button type="button" className="wa-max" onClick={() => setAmount(maxDelegate.toFixed(0))}>
                    MAX
                  </button>
                </div>

                <div className="wa-field-head">
                  <span className="wa-field-label">Select validator</span>
                </div>
                <input
                  type="text"
                  className="wa-input wa-search"
                  value={validatorSearch}
                  onChange={(e) => setValidatorSearch(e.target.value)}
                  placeholder="Search validators..."
                  aria-label="Search validators"
                />
                {validatorList(false)}

                <p className="wa-note">
                  Must stay staked until the next PSE distribution ({nextDistDate}) to earn PSE rewards.
                </p>

                <button
                  type="button"
                  className="btn-olive wa-submit"
                  onClick={handleAction}
                  disabled={txPending || parsedAmount <= 0 || !selectedValidator || parsedAmount > maxDelegate}
                >
                  {txPending
                    ? "Processing..."
                    : `Delegate ${parsedAmount > 0 ? `${fmt(parsedAmount)} TX` : ""}${selectedValInfo ? ` to ${selectedValInfo.moniker}` : ""}`}
                </button>
              </>
            )}

            {actionTab === "undelegate" && (
              wallet.delegations.length === 0 ? (
                <div className="wa-empty">No active delegations to undelegate from.</div>
              ) : (
                <>
                  <div className="wa-field-head">
                    <span className="wa-field-label">Select delegation</span>
                  </div>
                  {wallet.delegations.map((d: any) => (
                    <button
                      type="button"
                      key={d.validatorAddress}
                      onClick={() => { setSelectedSrcValidator(d.validatorAddress); setConfirmUndelegate(false); }}
                      className={`wa-srcrow${selectedSrcValidator === d.validatorAddress ? " is-danger-selected" : ""}`}
                    >
                      <span>
                        <span className="wa-srcrow-name">{d.validatorMoniker}</span>
                        {d.rewards > 0.01 && <span className="wa-srcrow-rewards">+{d.rewards.toFixed(2)} TX rewards</span>}
                      </span>
                      <span className="mono">{fmt(d.amount)} TX</span>
                    </button>
                  ))}

                  {selectedSrcValidator && (
                    <>
                      <div className="wa-field-head">
                        <span className="wa-field-label">Amount to undelegate</span>
                        <span className="wa-field-hint">Max: {fmt(maxSrc)} TX</span>
                      </div>
                      <div className="wa-amount">
                        <input
                          type="text"
                          inputMode="decimal"
                          className="wa-input mono is-danger"
                          value={amount}
                          onChange={(e) => { setAmount(e.target.value.replace(/[^0-9.]/g, "")); setConfirmUndelegate(false); }}
                          placeholder="0"
                          aria-label="Amount to undelegate"
                        />
                        <button type="button" className="wa-max is-danger" onClick={() => setAmount(maxSrc.toFixed(0))}>
                          MAX
                        </button>
                      </div>

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

                      {confirmUndelegate ? (
                        <div className="wa-confirm-row">
                          <button type="button" className="wa-btn-danger-solid" onClick={handleAction} disabled={txPending}>
                            {txPending ? "Processing..." : "Yes, undelegate"}
                          </button>
                          <button type="button" className="wa-btn-ghost" onClick={() => setConfirmUndelegate(false)}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="wa-btn-danger wa-submit"
                          onClick={handleAction}
                          disabled={txPending || parsedAmount <= 0 || parsedAmount > maxSrc}
                        >
                          Undelegate {parsedAmount > 0 ? `${fmt(parsedAmount)} TX` : ""}
                        </button>
                      )}
                    </>
                  )}
                </>
              )
            )}

            {actionTab === "redelegate" && (
              wallet.delegations.length === 0 ? (
                <div className="wa-empty">No active delegations to redelegate.</div>
              ) : (
                <>
                  <div className="wa-field-head">
                    <span className="wa-field-label">From (source)</span>
                  </div>
                  {wallet.delegations.map((d: any) => (
                    <button
                      type="button"
                      key={d.validatorAddress}
                      onClick={() => setSelectedSrcValidator(d.validatorAddress)}
                      className={`wa-srcrow${selectedSrcValidator === d.validatorAddress ? " is-selected" : ""}`}
                    >
                      <span className="wa-srcrow-name">{d.validatorMoniker}</span>
                      <span className="mono">{fmt(d.amount)} TX</span>
                    </button>
                  ))}

                  {selectedSrcValidator && (
                    <>
                      <div className="wa-field-head">
                        <span className="wa-field-label">Amount</span>
                        <span className="wa-field-hint">Max: {fmt(maxSrc)} TX</span>
                      </div>
                      <div className="wa-amount">
                        <input
                          type="text"
                          inputMode="decimal"
                          className="wa-input mono"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                          placeholder="0"
                          aria-label="Amount to redelegate"
                        />
                        <button type="button" className="wa-max" onClick={() => setAmount(maxSrc.toFixed(0))}>
                          MAX
                        </button>
                      </div>

                      <div className="wa-field-head">
                        <span className="wa-field-label">To (destination)</span>
                      </div>
                      <input
                        type="text"
                        className="wa-input wa-search"
                        value={validatorSearch}
                        onChange={(e) => setValidatorSearch(e.target.value)}
                        placeholder="Search validators..."
                        aria-label="Search destination validators"
                      />
                      {validatorList(true)}

                      <div className="wa-benefits">
                        <span>Instant, no unbonding period</span>
                        <span>PSE score preserved</span>
                        <span>Staking rewards continue without interruption</span>
                      </div>

                      <button
                        type="button"
                        className="btn-olive wa-submit"
                        onClick={handleAction}
                        disabled={txPending || parsedAmount <= 0 || !selectedValidator || parsedAmount > maxSrc}
                      >
                        {txPending ? "Processing..." : `Redelegate ${parsedAmount > 0 ? `${fmt(parsedAmount)} TX` : ""}`}
                      </button>
                    </>
                  )}
                </>
              )
            )}
          </div>
        </div>

        {/* ── Right: what is already staked ── */}
        <div className="wa-panel wa-side">
          <div>
            <div className="wa-side-head">
              <span>Active delegations</span>
              <span className="mono">{wallet.delegations.length} validator{wallet.delegations.length === 1 ? "" : "s"}</span>
            </div>
            {wallet.delegations.length === 0 ? (
              <div className="wa-empty">No active delegations yet. Use the Delegate tab to start staking.</div>
            ) : (
              wallet.delegations.map((del: any) => {
                const vp = bondedTokens > 0 ? (del.amount / bondedTokens) * 100 : 0;
                return (
                  <div key={del.validatorAddress} className="wa-delrow">
                    <div className="wa-delrow-top">
                      <span className="wa-delrow-name">{del.validatorMoniker}</span>
                      <span className="mono wa-delrow-amount">{fmt(del.amount)} TX</span>
                    </div>
                    <div className="wa-delrow-sub">
                      <span>{price > 0 ? `$${fmt(del.amount * price)}` : ""}</span>
                      <span>
                        VP {vp.toFixed(3)}%
                        {del.rewards > 0.01 && <span className="wa-delrow-rewards"> +{fmtRewards(del.rewards)} TX</span>}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {wallet.unbondingDelegations.length > 0 && (
            <div>
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
                  <div key={i} className="wa-delrow wa-unbondrow">
                    <div className="wa-delrow-top">
                      <span className="wa-delrow-name">{u.validatorMoniker}</span>
                      <span className="mono wa-delrow-amount">{fmt(u.amount)} TX</span>
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

          <div className="wa-darkcard wa-info">
            <span className="wa-info-title">Staking info</span>
            <div className="wa-info-grid">
              <div>
                <span className="wa-stat-label on-dark">Base APR</span>
                <span className="wa-info-value mono">{apr.toFixed(2)}%</span>
              </div>
              <div>
                <span className="wa-stat-label on-dark">PSE eligible bonded</span>
                <span className="wa-info-value mono">{fmt(pseEligibleBonded)} TX</span>
              </div>
              <div>
                <span className="wa-stat-label on-dark">Next PSE</span>
                <span className="wa-info-value mono">{nextDistDate}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Cancel-unbonding confirmation ── */}
      {cancelTarget && (
        <>
          <div className="wa-modal-backdrop" onClick={() => !txPending && setCancelTarget(null)} />
          {/* Themed surface. The old modal was hardcoded #fff, which in dark
              mode put the theme's cream text on a white card. */}
          <div className="wa-modal" role="dialog" aria-modal="true" aria-label="Cancel unbonding">
            <div className="wa-modal-head">Cancel unbonding</div>
            <div className="wa-modal-body">
              <div className="wa-modal-facts">
                <div><span>Validator</span><strong>{cancelTarget.validatorMoniker}</strong></div>
                <div><span>Amount</span><strong className="mono earn">{fmt(cancelTarget.amount)} TX</strong></div>
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
