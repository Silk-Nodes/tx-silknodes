"use client";

import { useEffect, useState } from "react";
import { formatCompact, relativeTimeShort } from "@/lib/ui-format";
import { fetchAddressChainData, fetchValidatorMonikers, type AddressChainData } from "@/lib/passport";

// One universal wallet preview, used everywhere an address needs a quick
// look: the Passport (drill into a counterparty), the Flows tab (inspect a
// searched address), and any future table. It slides in from the right with
// the shared panel shell, shows an on-chain snapshot + exchange flow +
// recent activity, and always offers a "View full passport" CTA so any
// address in the app is one click from its full profile.
//
// Self-sufficient: give it an address and it fetches everything itself
// (chain snapshot, activity, exchange flow, validator monikers). The core
// snapshot renders immediately from the reliable LCD; the indexer/DB-backed
// sections stream in after, so a slow indexer never blocks the panel.

const shortAddr = (a: string) => (a.length > 16 ? `${a.slice(0, 8)}...${a.slice(-5)}` : a);
const TX = (n: number) => `${formatCompact(n)} TX`;
const fullDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const mintscanAddr = (a: string) => `https://www.mintscan.io/tx/address/${a}`;

function avatar(address: string): { background: string; initials: string } {
  let h = 0;
  for (let i = 0; i < address.length; i++) h = (h * 31 + address.charCodeAt(i)) >>> 0;
  const hue1 = h % 360;
  const hue2 = (hue1 + 60 + (h % 80)) % 360;
  return {
    background: `linear-gradient(135deg, hsl(${hue1} 70% 45%), hsl(${hue2} 70% 35%))`,
    initials: address.slice(5, 7).toUpperCase(),
  };
}

interface PeekActivity {
  kind: string;
  height: number;
  txHash: string;
  timestamp: string | null;
  amountTX?: number;
  counterparty?: string;
  counterpartyLabel?: string;
  detail?: string;
}
interface ActivityResponse {
  items: PeekActivity[];
  validatorOperator: string | null;
  firstSeen: { height: number; timestamp: string | null } | null;
}
interface FlowResponse {
  label: string | null;
  rank: number | null;
  isExchange: boolean;
  exchangeName: string | null;
  summary: { totalSentToExchanges: number; totalReceivedFromExchanges: number; net: number; txCount: number };
  perExchange: { exchange: string; sentToExchange: number; receivedFromExchange: number; net: number }[];
}

function describe(e: PeekActivity, nameOf: (v: string) => string): [string, string, string] {
  const cp = e.counterparty ?? "";
  const cpName = e.counterpartyLabel ?? shortAddr(cp);
  switch (e.kind) {
    case "receive": return ["in", "Received", `from ${cpName}`];
    case "send": return ["out", "Sent", `to ${cpName}`];
    case "delegate": return ["in", "Delegated", `to ${nameOf(cp)}`];
    case "undelegate": return ["out", "Undelegated", `from ${nameOf(cp)}`];
    case "redelegate": return ["neutral", "Redelegated", `to ${nameOf(cp)}`];
    case "claim_rewards": return ["in", "Claimed rewards", e.detail ?? ""];
    case "vote": return ["neutral", "Voted", e.detail ?? ""];
    case "referral_reward": return ["in", "Referral reward", e.detail ?? ""];
    case "ibc_transfer": return ["out", "IBC transfer", `to ${cpName}`];
    case "contract": return ["neutral", "Contract call", cpName];
    default: return ["neutral", "Activity", ""];
  }
}

interface Props {
  address: string | null;
  monikers?: Record<string, string>;
  txPrice?: number;
  onClose: () => void;
  // Called by the "View full passport" CTA. The caller decides what that
  // means: the Passport loads it inline; other tabs route to /passport.
  onOpenFull: (address: string) => void;
}

export default function WalletPanel({ address, monikers: monikersProp, txPrice = 0, onClose, onOpenFull }: Props) {
  const [chain, setChain] = useState<AddressChainData | null>(null);
  const [activity, setActivity] = useState<ActivityResponse | null>(null);
  const [flow, setFlow] = useState<FlowResponse | null>(null);
  const [monikers, setMonikers] = useState<Record<string, string>>(monikersProp ?? {});
  const [loading, setLoading] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (monikersProp) setMonikers(monikersProp);
  }, [monikersProp]);

  // Esc to close + lock body scroll while open.
  useEffect(() => {
    if (!address) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [address, onClose]);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    setLoading(true);
    setEnriching(true);
    setChain(null);
    setActivity(null);
    setFlow(null);

    // Core snapshot first (reliable LCD), so the panel paints right away.
    fetchAddressChainData(address)
      .then((c) => { if (!cancelled) { setChain(c); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });

    // Enrichments stream in independently, so a slow source (the indexer
    // for activity) never holds back a fast one (the exchange flow).
    const tasks = [
      fetch(`/api/address/activity?address=${address}`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
        .then((a) => { if (!cancelled) setActivity(a && !a.error ? a : null); }),
      fetch(`/api/flows-address?address=${address}&window=all`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
        .then((f) => { if (!cancelled) setFlow(f && !f.error ? f : null); }),
      (monikersProp ? Promise.resolve(monikersProp) : fetchValidatorMonikers().catch(() => ({})))
        .then((m) => { if (!cancelled && !monikersProp && m) setMonikers(m); }),
    ];
    Promise.allSettled(tasks).then(() => { if (!cancelled) setEnriching(false); });

    return () => { cancelled = true; };
  }, [address, monikersProp]);

  if (!address) return null;

  const av = avatar(address);
  const nameOf = (v: string) => monikers[v] || shortAddr(v);
  const validatorName = activity?.validatorOperator ? (monikers[activity.validatorOperator] || "Validator") : null;
  const usd = (tx: number) => (txPrice && tx > 0 ? `$${formatCompact(tx * txPrice)}` : null);
  const netWorth = chain ? chain.stakedTX + chain.balanceTX + chain.unbondingTX + chain.rewardsTX : 0;
  const exchangeLabel = flow?.isExchange ? flow.exchangeName : flow?.label;
  const flowNet = flow ? flow.summary.totalReceivedFromExchanges - flow.summary.totalSentToExchanges : 0;

  const copy = () => {
    navigator.clipboard?.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  return (
    <>
      <div className="staking-feed-panel-backdrop" onClick={onClose} />
      <div className="staking-feed-panel psp-peek" role="dialog" aria-modal="true">
        <button type="button" className="staking-panel-close" onClick={onClose} aria-label="Close">×</button>

        <div className="psp-peek-head">
          <div className="psp-avatar sm" style={{ background: av.background }}>{av.initials}</div>
          <div className="psp-peek-id">
            <span className="psp-addr mono">{shortAddr(address)}</span>
            <div className="psp-peek-actions">
              <button className="psp-copy" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
              <a className="psp-copy" href={mintscanAddr(address)} target="_blank" rel="noopener noreferrer">Explorer ↗</a>
            </div>
          </div>
        </div>

        <div className="psp-peek-tags">
          {validatorName && <span className="psp-tag psp-tag-rank">Validator{validatorName !== "Validator" ? `: ${validatorName}` : ""}</span>}
          {exchangeLabel && <span className="psp-tag psp-tag-label">{exchangeLabel}</span>}
          {flow?.rank != null && <span className="psp-tag psp-tag-rank">Staker rank #{flow.rank}</span>}
          {activity?.firstSeen?.timestamp && (
            <span className="psp-tag psp-tag-soft">Created {relativeTimeShort(activity.firstSeen.timestamp)} · {fullDate(activity.firstSeen.timestamp)}</span>
          )}
          {chain && chain.txsSent > 0 && <span className="psp-tag psp-tag-soft">{formatCompact(chain.txsSent)} txns</span>}
        </div>

        {loading && !chain ? (
          <div className="psp-loading"><span className="psp-spinner" aria-hidden="true" /> Reading the chain...</div>
        ) : (
          <>
            <div className="psp-peek-stats">
              <PeekStat label="Net worth" value={TX(netWorth)} sub={usd(netWorth)} accent />
              <PeekStat label="Staked" value={TX(chain?.stakedTX ?? 0)} sub={chain && chain.validatorCount > 0 ? `${chain.validatorCount} vals` : undefined} />
              <PeekStat label="Liquid" value={TX(chain?.balanceTX ?? 0)} />
              <PeekStat label="Rewards" value={TX(chain?.rewardsTX ?? 0)} />
            </div>

            {chain && chain.otherTokens.length > 0 && (
              <div className="psp-peek-tokens">
                {chain.otherTokens.slice(0, 6).map((t) => (
                  <span key={t.denom} className="psp-token-chip mono">{t.subunit}</span>
                ))}
                {chain.otherTokens.length > 6 && <span className="psp-token-chip">+{chain.otherTokens.length - 6}</span>}
              </div>
            )}

            {flow && flow.summary.txCount > 0 && (
              <>
                <div className="psp-peek-section-head">Exchange flow</div>
                <div className={`psp-verdict ${flowNet >= 0 ? "psp-verdict-accum" : "psp-verdict-distrib"}`}>
                  {flowNet >= 0
                    ? <>Net <strong>accumulating</strong> · {TX(Math.abs(flowNet))} pulled off exchanges</>
                    : <>Net <strong>distributing</strong> · {TX(Math.abs(flowNet))} sent to exchanges</>}
                </div>
                {flow.perExchange.slice(0, 4).map((e) => (
                  <div key={e.exchange} className="psp-row">
                    <span className="psp-row-name">{e.exchange}</span>
                    <span className="psp-row-val">
                      <span className="psp-flow-in">+{formatCompact(e.receivedFromExchange)}</span>{" "}
                      <span className="psp-flow-out">−{formatCompact(e.sentToExchange)}</span>
                    </span>
                  </div>
                ))}
              </>
            )}

            <div className="psp-peek-section-head">Recent activity</div>
            {activity && activity.items.length > 0 ? (
              <div className="psp-list">
                {activity.items.slice(0, 6).map((e, i) => {
                  const [tone, verb, who] = describe(e, nameOf);
                  return (
                    <div key={`${e.txHash}-${i}`} className="psp-row">
                      <span className="psp-row-name"><span className={`psp-evt ${tone}`}>{verb}</span> {who}</span>
                      <span className="psp-row-val">
                        {e.amountTX ? `${TX(e.amountTX)} ` : ""}
                        <span className="psp-row-meta">{e.timestamp ? relativeTimeShort(e.timestamp) : `#${e.height}`}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : enriching ? (
              <div className="psp-empty"><span className="psp-spinner sm" aria-hidden="true" /> Reading the chain...</div>
            ) : (
              <div className="psp-empty">No on-chain activity found.</div>
            )}

            <button className="psp-peek-open" onClick={() => onOpenFull(address)}>View full passport →</button>
          </>
        )}
      </div>
    </>
  );
}

function PeekStat({ label, value, sub, accent }: { label: string; value: string; sub?: string | null; accent?: boolean }) {
  return (
    <div className="psp-peek-stat">
      <span className="psp-peek-stat-label">{label}</span>
      <span className={`psp-peek-stat-value${accent ? " accent" : ""}`}>{value}</span>
      {sub && <span className="psp-peek-stat-sub">{sub}</span>}
    </div>
  );
}
