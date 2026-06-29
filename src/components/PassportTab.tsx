"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Shareable from "@/components/share/Shareable";
import { formatCompact, relativeTimeShort } from "@/lib/ui-format";
import { fetchOnChainPSEScore, layeredPSEEstimate } from "@/lib/pse-calculator";
import {
  fetchAddressChainData,
  fetchValidatorMonikers,
  fetchBondedTokens,
  computeBadges,
  type AddressChainData,
  type Badge,
} from "@/lib/passport";

interface FlowsAddress {
  label: string | null;
  labelType: string | null;
  rank: number | null;
  isExchange: boolean;
  exchangeName: string | null;
  summary: { totalSentToExchanges: number; totalReceivedFromExchanges: number; net: number; txCount: number };
  perExchange: { exchange: string; sentToExchange: number; receivedFromExchange: number; net: number; txCount: number }[];
  recent: { txHash: string; timestamp: string; exchange: string; direction: "inflow" | "outflow"; amount: number }[];
}
interface GovHistory {
  votes: { proposalId: number; title: string; status: string; option: string; votedAt: string }[];
  summary: { votedCount: number; votableCount: number; turnoutPct: number; lastVotedAt: string | null };
}
interface PseStanding {
  score: string | null;
  monthly: number;
  annual: number;
  sharePct: number;
  eligible: boolean;
}
interface StakingEvt {
  type: "delegate" | "undelegate" | "redelegate";
  timestamp: string;
  validator: string;
  sourceValidator?: string;
  amount: number;
}

interface Loaded {
  address: string;
  chain: AddressChainData;
  flows: FlowsAddress | null;
  gov: GovHistory | null;
  pse: PseStanding | null;
  staking: StakingEvt[];
  badges: Badge[];
  monikers: Record<string, string>;
}

const shortAddr = (a: string) => (a.length > 16 ? `${a.slice(0, 8)}...${a.slice(-5)}` : a);
const isValidAddr = (a: string) => a.startsWith("core1") && a.length >= 39;
const TX = (n: number) => `${formatCompact(n)} TX`;

// A deterministic two-stop gradient + initials, so every wallet gets a
// stable, recognizable avatar with no external dependency.
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

export default function PassportTab({
  connectedAddress,
  txPrice = 0,
}: {
  connectedAddress?: string;
  txPrice?: number;
}) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Loaded | null>(null);
  const [copied, setCopied] = useState(false);
  const ranInitial = useRef(false);

  const usd = useCallback(
    (tx: number): string | null => {
      if (!txPrice || tx <= 0) return null;
      const v = tx * txPrice;
      if (v >= 1000) return `$${formatCompact(v)}`;
      if (v >= 1) return `$${v.toFixed(2)}`;
      return `$${v.toFixed(4)}`;
    },
    [txPrice],
  );

  const load = useCallback(async (raw: string) => {
    const address = raw.trim();
    if (!isValidAddr(address)) {
      setError("Enter a valid core1... address");
      return;
    }
    setError(null);
    setLoading(true);
    setData(null);
    try {
      const [chain, flowsRes, govRes, score, pseNet, bondedTokens, stakingRes, monikers] = await Promise.all([
        fetchAddressChainData(address),
        fetch(`/api/flows-address?address=${address}&window=all`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch(`/api/address/governance?address=${address}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetchOnChainPSEScore(address),
        fetch(`/api/pse-score`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetchBondedTokens(),
        fetch(`/api/staking-feed?delegator=${address}&sinceDays=3650&limit=300`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetchValidatorMonikers(),
      ]);

      const flows: FlowsAddress | null = flowsRes && !flowsRes.error ? flowsRes : null;
      const gov: GovHistory | null = govRes && !govRes.error ? govRes : null;
      const staking: StakingEvt[] = Array.isArray(stakingRes?.events) ? stakingRes.events : [];

      const est = layeredPSEEstimate({
        userStake: chain.stakedTX,
        userScore: score,
        networkTotalScore: pseNet?.networkTotalScore ?? null,
        lastDistTotalScore: null,
        bondedTokens,
        excludedStake: 0,
      });
      const pse: PseStanding = {
        score,
        monthly: est.estimate,
        annual: est.estimate * 12,
        sharePct: est.sharePct,
        eligible: !!score && chain.stakedTX > 0,
      };

      const sent = flows?.summary.totalSentToExchanges ?? 0;
      const received = flows?.summary.totalReceivedFromExchanges ?? 0;
      const badges = computeBadges({
        isExchange: flows?.isExchange ?? false,
        rank: flows?.rank ?? null,
        stakedTX: chain.stakedTX,
        balanceTX: chain.balanceTX,
        netToExchanges: sent - received,
        exchangeTxCount: flows?.summary.txCount ?? 0,
        turnoutPct: gov?.summary.turnoutPct ?? 0,
        votedCount: gov?.summary.votedCount ?? 0,
      });

      setData({ address, chain, flows, gov, pse, staking, badges, monikers });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load wallet passport");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ranInitial.current || typeof window === "undefined") return;
    const fromQuery = new URLSearchParams(window.location.search).get("address");
    if (fromQuery && isValidAddr(fromQuery)) {
      ranInitial.current = true;
      setInput(fromQuery);
      load(fromQuery);
    }
  }, [load]);

  const submit = () => load(input);
  const reset = () => { setData(null); setError(null); setInput(""); };
  const copyAddr = () => {
    if (!data) return;
    navigator.clipboard?.writeText(data.address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  // ─── Entry state ────────────────────────────────────────────────
  if (!data && !loading) {
    return (
      <div className="psp">
        <div className="psp-intro">
          <h1 className="psp-title">Wallet Passport</h1>
          <p className="psp-sub">
            Everything about any TX wallet in one place: holdings, staking,
            PSE standing, exchange behavior, and governance record.
          </p>
        </div>
        <div className="psp-entry">
          <input
            className="psp-input"
            placeholder="Paste any core1... address"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            maxLength={100}
            spellCheck={false}
          />
          <button className="psp-btn-primary" onClick={submit} disabled={!input.trim()}>View passport</button>
          {connectedAddress && (
            <>
              <div className="psp-or">or</div>
              <button className="psp-btn-secondary" onClick={() => { setInput(connectedAddress); load(connectedAddress); }}>
                Use my connected wallet
              </button>
            </>
          )}
          {error && <div className="psp-error" role="alert">{error}</div>}
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="psp">
        <div className="psp-loading"><span className="psp-spinner" aria-hidden="true" /> Reading the chain for this wallet...</div>
      </div>
    );
  }

  if (!data) return null;
  const { address, chain, flows, gov, pse, staking, badges, monikers } = data;
  const nameOf = (v: string) => monikers[v] || shortAddr(v);
  const av = avatar(address);
  const label = flows?.isExchange ? flows.exchangeName : flows?.label;

  // ── Derived insight ──
  const netWorth = chain.stakedTX + chain.balanceTX + chain.unbondingTX + chain.rewardsTX;
  const composition = [
    { label: "Staked", tx: chain.stakedTX, cls: "staked" },
    { label: "Liquid", tx: chain.balanceTX, cls: "liquid" },
    { label: "Unbonding", tx: chain.unbondingTX, cls: "unbond" },
    { label: "Rewards", tx: chain.rewardsTX, cls: "reward" },
  ].filter((s) => s.tx > 0);
  const stakedPct = netWorth > 0 ? (chain.stakedTX / netWorth) * 100 : 0;
  const topValidatorShare = chain.stakedTX > 0 && chain.delegations[0] ? (chain.delegations[0].amountTX / chain.stakedTX) * 100 : 0;
  const monthlyYieldPct = chain.stakedTX > 0 && pse ? (pse.monthly / chain.stakedTX) * 100 : 0;
  const allTimeNet = flows ? flows.summary.totalReceivedFromExchanges - flows.summary.totalSentToExchanges : 0;
  const firstActivity = staking.length ? staking[staking.length - 1].timestamp : (flows?.recent.length ? flows.recent[flows.recent.length - 1].timestamp : null);

  const govCounts: Record<string, number> = { YES: 0, NO: 0, ABSTAIN: 0, NO_WITH_VETO: 0 };
  for (const v of gov?.votes ?? []) govCounts[v.option] = (govCounts[v.option] ?? 0) + 1;
  const govTotal = (gov?.votes ?? []).length;

  return (
    <div className="psp">
      {/* ── Hero (shareable) ── */}
      <Shareable title="TX Wallet Passport" subtitle={shortAddr(address)} caption="Holdings, staking, PSE and governance at a glance" exportWidth={760}>
        <div className="psp-hero">
          <div className="psp-hero-top">
            <div className="psp-avatar" style={{ background: av.background }}>{av.initials}</div>
            <div className="psp-hero-id">
              <div className="psp-hero-addr-row">
                <span className="psp-addr mono">{shortAddr(address)}</span>
                <button className="psp-copy" onClick={copyAddr} aria-label="Copy address">{copied ? "Copied" : "Copy"}</button>
              </div>
              <div className="psp-hero-tags">
                {label && <span className="psp-tag psp-tag-label">{label}</span>}
                {flows?.rank != null && <span className="psp-tag psp-tag-rank">Staker rank #{flows.rank}</span>}
                {firstActivity && <span className="psp-tag psp-tag-soft">First seen {relativeTimeShort(firstActivity)}</span>}
              </div>
            </div>
          </div>
          {badges.length > 0 && (
            <div className="psp-badges">
              {badges.map((b) => <span key={b.label} className={`psp-badge psp-badge-${b.tone}`} title={b.title}>{b.label}</span>)}
            </div>
          )}
          <div className="psp-headline">
            <Metric label="Net worth" value={TX(netWorth)} sub={usd(netWorth)} accent />
            <Metric label="Staked" value={`${stakedPct.toFixed(0)}%`} sub={TX(chain.stakedTX)} />
            <Metric label="Validators" value={String(chain.validatorCount)} sub={topValidatorShare > 0 ? `top ${topValidatorShare.toFixed(0)}%` : undefined} />
            <Metric label="Proposals voted" value={String(gov?.summary.votedCount ?? 0)} sub={gov ? `of ${gov.summary.votableCount}` : undefined} />
            <Metric label="Est. PSE / mo" value={pse && pse.eligible ? TX(pse.monthly) : "—"} sub={pse && pse.eligible ? usd(pse.monthly) ?? undefined : undefined} />
          </div>
        </div>
      </Shareable>

      {/* ── Dashboard grid ── */}
      <div className="psp-grid">
        {/* Portfolio composition */}
        <Card title="Portfolio composition">
          {netWorth > 0 ? (
            <>
              <div className="psp-stack">
                {composition.map((s) => (
                  <div key={s.label} className={`psp-stack-seg psp-fill-${s.cls}`} style={{ width: `${(s.tx / netWorth) * 100}%` }} title={`${s.label}: ${TX(s.tx)}`} />
                ))}
              </div>
              <div className="psp-legend">
                {composition.map((s) => (
                  <div key={s.label} className="psp-legend-row">
                    <span className={`psp-dot psp-fill-${s.cls}`} />
                    <span className="psp-legend-label">{s.label}</span>
                    <span className="psp-legend-val">{TX(s.tx)}{usd(s.tx) ? <span className="psp-usd"> {usd(s.tx)}</span> : null}</span>
                    <span className="psp-legend-pct">{((s.tx / netWorth) * 100).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </>
          ) : <Empty>No holdings found for this wallet.</Empty>}
        </Card>

        {/* Delegations */}
        <Card title="Delegations">
          {chain.delegations.length > 0 ? (
            <div className="psp-bars">
              {chain.delegations.filter((d) => d.amountTX > 0).slice(0, 8).map((d) => {
                const pct = chain.stakedTX > 0 ? (d.amountTX / chain.stakedTX) * 100 : 0;
                return (
                  <div key={d.validatorAddress} className="psp-bar-row">
                    <div className="psp-bar-head">
                      <span className="psp-bar-name">{nameOf(d.validatorAddress)}</span>
                      <span className="psp-bar-val">{TX(d.amountTX)} <span className="psp-bar-pct">{pct.toFixed(0)}%</span></span>
                    </div>
                    <div className="psp-bar-track"><div className="psp-bar-fill psp-fill-staked" style={{ width: `${pct}%` }} /></div>
                  </div>
                );
              })}
            </div>
          ) : <Empty>This wallet has no active delegations.</Empty>}
        </Card>

        {/* PSE standing */}
        <Card title="PSE standing">
          {pse && pse.eligible ? (
            <>
              <div className="psp-kv-grid">
                <KV label="Eligible" value="Yes" tone="good" />
                <KV label="Monthly yield" value={`${monthlyYieldPct.toFixed(1)}%`} />
                <KV label="Est. monthly" value={TX(pse.monthly)} sub={usd(pse.monthly)} />
                <KV label="Est. annual" value={TX(pse.annual)} sub={usd(pse.annual)} />
              </div>
              <div className="psp-sharebar-wrap">
                <div className="psp-sharebar-head"><span>Share of PSE pool</span><span>{pse.sharePct < 0.01 ? "<0.01" : pse.sharePct.toFixed(2)}%</span></div>
                <div className="psp-bar-track"><div className="psp-bar-fill psp-fill-reward" style={{ width: `${Math.min(100, Math.max(pse.sharePct, 0.4))}%` }} /></div>
              </div>
            </>
          ) : <Empty>No active PSE score. PSE accrues to community stakers; stake TX to start earning.</Empty>}
        </Card>

        {/* Exchange behavior */}
        <Card title="Exchange behavior">
          {flows && flows.summary.txCount > 0 ? (
            <>
              <div className={`psp-verdict ${allTimeNet >= 0 ? "psp-verdict-accum" : "psp-verdict-distrib"}`}>
                {allTimeNet >= 0
                  ? <>Net <strong>accumulating</strong> · {TX(Math.abs(allTimeNet))} pulled off exchanges</>
                  : <>Net <strong>distributing</strong> · {TX(Math.abs(allTimeNet))} sent to exchanges</>}
              </div>
              <div className="psp-bars">
                {flows.perExchange.slice(0, 6).map((e) => {
                  const max = Math.max(e.receivedFromExchange, e.sentToExchange, 1);
                  return (
                    <div key={e.exchange} className="psp-xchg-row">
                      <span className="psp-xchg-name">{e.exchange}</span>
                      <div className="psp-xchg-bars">
                        <div className="psp-xchg-line"><span className="psp-xchg-tag in">In</span><div className="psp-bar-track sm"><div className="psp-bar-fill psp-fill-in" style={{ width: `${(e.receivedFromExchange / max) * 100}%` }} /></div><span className="psp-xchg-amt">{TX(e.receivedFromExchange)}</span></div>
                        <div className="psp-xchg-line"><span className="psp-xchg-tag out">Out</span><div className="psp-bar-track sm"><div className="psp-bar-fill psp-fill-out" style={{ width: `${(e.sentToExchange / max) * 100}%` }} /></div><span className="psp-xchg-amt">{TX(e.sentToExchange)}</span></div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {flows.recent.length > 0 && (
                <div className="psp-list">
                  <div className="psp-list-head">Recent exchange transfers</div>
                  {flows.recent.slice(0, 6).map((t, i) => (
                    <div key={i} className="psp-row">
                      <span className="psp-row-name"><span className={`psp-flowdir ${t.direction}`}>{t.direction === "inflow" ? "Withdraw" : "Deposit"}</span> {t.exchange}</span>
                      <span className="psp-row-val">{TX(t.amount)} <span className="psp-row-meta">{relativeTimeShort(t.timestamp)}</span></span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : <Empty>No exchange deposits or withdrawals on record for this wallet.</Empty>}
        </Card>

        {/* Governance */}
        <Card title="Governance record" wide>
          {gov && gov.votes.length > 0 ? (
            <>
              <div className="psp-gov-top">
                <div className="psp-gov-turnout">
                  <div className="psp-sharebar-head"><span>Turnout</span><span>{gov.summary.turnoutPct}% · {gov.summary.votedCount}/{gov.summary.votableCount}</span></div>
                  <div className="psp-bar-track"><div className="psp-bar-fill psp-fill-staked" style={{ width: `${gov.summary.turnoutPct}%` }} /></div>
                </div>
                {govTotal > 0 && (
                  <div className="psp-votebar">
                    {(["YES", "NO", "ABSTAIN", "NO_WITH_VETO"] as const).map((o) =>
                      govCounts[o] > 0 ? <div key={o} className={`psp-votebar-seg psp-vote-${o.toLowerCase()}`} style={{ width: `${(govCounts[o] / govTotal) * 100}%` }} title={`${voteLabel(o)}: ${govCounts[o]}`}>{govCounts[o]}</div> : null,
                    )}
                  </div>
                )}
              </div>
              <div className="psp-list">
                <div className="psp-list-head">Voting history</div>
                {gov.votes.slice(0, 12).map((v) => (
                  <div key={v.proposalId} className="psp-row">
                    <span className="psp-row-name"><span className="psp-prop-id">#{v.proposalId}</span> {v.title} <span className={`psp-status psp-status-${v.status}`}>{v.status}</span></span>
                    <span className={`psp-vote psp-vote-${v.option.toLowerCase()}`}>{voteLabel(v.option)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : <Empty>This wallet has not voted on any governance proposals.</Empty>}
        </Card>

        {/* Staking activity */}
        <Card title="Staking activity" wide>
          {staking.length > 0 ? (
            <div className="psp-list">
              {staking.slice(0, 12).map((e, i) => {
                const tone = e.type === "delegate" ? "in" : e.type === "undelegate" ? "out" : "neutral";
                const verb = e.type === "delegate" ? "Delegated to" : e.type === "undelegate" ? "Undelegated from" : "Redelegated to";
                return (
                  <div key={i} className="psp-row">
                    <span className="psp-row-name"><span className={`psp-evt ${tone}`}>{verb}</span> {nameOf(e.validator)}{e.sourceValidator ? <span className="psp-row-meta"> from {nameOf(e.sourceValidator)}</span> : null}</span>
                    <span className="psp-row-val">{e.type === "undelegate" ? "−" : "+"}{TX(e.amount)} <span className="psp-row-meta">{relativeTimeShort(e.timestamp)}</span></span>
                  </div>
                );
              })}
            </div>
          ) : <Empty>No recorded staking events in the tracked window.</Empty>}
        </Card>
      </div>

      <button className="psp-reset" onClick={reset}>← Look up another wallet</button>
    </div>
  );
}

function Metric({ label, value, sub, accent }: { label: string; value: string; sub?: string | null; accent?: boolean }) {
  return (
    <div className="psp-metric">
      <span className="psp-metric-label">{label}</span>
      <span className={`psp-metric-value${accent ? " psp-metric-accent" : ""}`}>{value}</span>
      {sub && <span className="psp-metric-sub">{sub}</span>}
    </div>
  );
}
function Card({ title, children, wide }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`psp-card${wide ? " psp-card-wide" : ""}`}>
      <div className="psp-card-head">{title}</div>
      {children}
    </div>
  );
}
function KV({ label, value, sub, tone }: { label: string; value: string; sub?: string | null; tone?: "good" }) {
  return (
    <div className="psp-kv">
      <span className="psp-kv-label">{label}</span>
      <span className={`psp-kv-value${tone === "good" ? " psp-kv-good" : ""}`}>{value}{sub ? <span className="psp-usd"> {sub}</span> : null}</span>
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="psp-empty">{children}</div>;
}
function voteLabel(opt: string): string {
  switch (opt) {
    case "YES": return "Yes";
    case "NO": return "No";
    case "ABSTAIN": return "Abstain";
    case "NO_WITH_VETO": return "Veto";
    default: return opt;
  }
}
