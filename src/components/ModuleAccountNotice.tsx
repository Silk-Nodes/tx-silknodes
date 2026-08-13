"use client";

// Shown when the address on screen is a protocol-owned account rather than
// somebody's wallet.
//
// It leads with the fact that decides how to read everything below it: a
// ModuleAccount has no key, so nothing here can be sold by anyone. A public
// wallet-analysis tool flagged the pse_team account red for holding 1.88B
// "with no protocol-level lock", which is true and completely misleading at
// the same time, and our passport would have said the same thing by saying
// nothing.
//
// For the six PSE clearing accounts it also states the schedule, because that
// is what makes the balance legible: the number is the allocation minus what
// has been released, and both halves are checkable.

import { describeModuleAccount } from "@/lib/module-accounts";
import { formatCompact } from "@/lib/ui-format";

const fmtTX = (n: number) =>
  `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} TX`;

export default function ModuleAccountNotice({
  moduleName,
  balanceTX,
}: {
  moduleName: string;
  balanceTX: number;
}) {
  const facts = describeModuleAccount(moduleName, balanceTX);
  if (!facts) return null;
  const s = facts.schedule;

  return (
    <div className="mod-acct">
      <div className="mod-acct-head">
        <span className="mod-acct-tag">protocol account</span>
        <span className="mod-acct-name mono">{facts.name}</span>
      </div>

      <p className="mod-acct-lead">
        <strong>{facts.label}.</strong> {facts.purpose} This is a module account, so it has no
        signing key: nothing here can be sent or sold by anyone. Only the protocol moves it.
      </p>

      {s && (
        <>
          <div className="mod-acct-grid">
            <div>
              <span className="mod-acct-key">Share of PSE</span>
              <span className="mod-acct-val mono">{s.sharePct}%</span>
              <span className="mod-acct-note">of {formatCompact(100_000_000_000)} TX</span>
            </div>
            <div>
              <span className="mod-acct-key">Allocation</span>
              <span className="mod-acct-val mono">{formatCompact(s.totalTX)} TX</span>
              <span className="mod-acct-note">over {s.monthsTotal} months</span>
            </div>
            <div>
              <span className="mod-acct-key">Released so far</span>
              <span className="mod-acct-val mono">{formatCompact(s.releasedTX)} TX</span>
              <span className="mod-acct-note">
                {s.monthsReleased} of {s.monthsTotal} months
              </span>
            </div>
            <div>
              <span className="mod-acct-key">Still to release</span>
              <span className="mod-acct-val mono">{formatCompact(balanceTX)} TX</span>
              <span className="mod-acct-note">{fmtTX(s.perMonthTX)} per month</span>
            </div>
          </div>
          {/* The arithmetic in full, so the balance is not something a reader
              has to take on trust. */}
          <p className="mod-acct-check mono">
            {formatCompact(s.totalTX)} allocated &minus; {formatCompact(s.releasedTX)} released
            = {fmtTX(balanceTX)} held
          </p>
        </>
      )}
    </div>
  );
}
