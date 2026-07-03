"use client";

import { useEffect, useState } from "react";
import { formatCompact, relativeTimeShort } from "@/lib/ui-format";
import { fetchAddressChainData, type AddressChainData } from "@/lib/passport";

// A lightweight, slide-in preview of a related wallet, opened by clicking a
// counterparty anywhere on the Passport. It mirrors the Flows address panel
// so the two read as a family (same shell classes, Esc-to-close, scroll
// lock), but shows an on-chain snapshot instead of exchange flow. From here
// the user can jump the whole page over to that wallet's full passport.

const UCORE_PER_TX = "TX";
const shortAddr = (a: string) => (a.length > 16 ? `${a.slice(0, 8)}...${a.slice(-5)}` : a);
const TX = (n: number) => `${formatCompact(n)} ${UCORE_PER_TX}`;
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

// Compact one-liner for an activity row. A trimmed version of the main
// passport's describeActivity, enough for a five-row preview.
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
  monikers: Record<string, string>;
  txPrice?: number;
  onClose: () => void;
  onOpenFull: (address: string) => void;
}

export default function PassportPeekPanel({ address, monikers, txPrice = 0, onClose, onOpenFull }: Props) {
  const [chain, setChain] = useState<AddressChainData | null>(null);
  const [activity, setActivity] = useState<ActivityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Esc to close + lock body scroll while open. Same UX as the Flows panel.
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
    setChain(null);
    setActivity(null);
    (async () => {
      const [c, a] = await Promise.all([
        fetchAddressChainData(address).catch(() => null),
        fetch(`/api/address/activity?address=${address}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      if (cancelled) return;
      setChain(c);
      setActivity(a && !a.error ? a : null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [address]);

  if (!address) return null;

  const av = avatar(address);
  const nameOf = (v: string) => monikers[v] || shortAddr(v);
  const validatorName = activity?.validatorOperator ? (monikers[activity.validatorOperator] || "Validator") : null;
  const usd = (tx: number) => (txPrice && tx > 0 ? `$${formatCompact(tx * txPrice)}` : null);
  const netWorth = chain ? chain.stakedTX + chain.balanceTX + chain.unbondingTX + chain.rewardsTX : 0;

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
            ) : (
              <div className="psp-empty">No on-chain activity found.</div>
            )}

            <button className="psp-peek-open" onClick={() => onOpenFull(address)}>Open full passport →</button>
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
