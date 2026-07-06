"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Shareable from "@/components/share/Shareable";
import WalletPanel from "@/components/WalletPanel";
import { decode as bech32Decode, encode as bech32Encode } from "bech32";
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
interface ActivityItem {
  kind: "send" | "receive" | "delegate" | "undelegate" | "redelegate"
    | "claim_rewards" | "vote" | "referral_reward" | "ibc_transfer" | "contract" | "other";
  height: number;
  txHash: string;
  timestamp: string | null;
  amountTX?: number;
  counterparty?: string;
  counterpartyLabel?: string;
  detail?: string;
}

interface PseEarned {
  count: number;
  totalTX: number;
  lastTX: number;
  distributions: { amountTX: number; height: number }[];
}

interface Referral {
  referralsMade: number;
  totalEarnedTX: number;
  elite: boolean;
  referredBy: string | null;
  payoutCount: number;
}

interface Loaded {
  address: string;
  chain: AddressChainData;
  flows: FlowsAddress | null;
  gov: GovHistory | null;
  pse: PseStanding | null;
  pseEarned: PseEarned | null;
  activity: ActivityItem[];
  validatorOperator: string | null;
  firstSeen: string | null;
  referral: Referral | null;
  badges: Badge[];
  monikers: Record<string, string>;
}

const shortAddr = (a: string) => (a.length > 16 ? `${a.slice(0, 8)}...${a.slice(-5)}` : a);
const isValidAddr = (a: string) => a.startsWith("core1") && a.length >= 39;

// A validator's operator address (corevaloper1...) and its self-delegate
// wallet (core1...) are the same key under different bech32 prefixes, so a
// prefix swap turns any counterparty we can peek into a real wallet address.
// Returns null if it isn't a Coreum address we can convert.
function toWallet(addr: string): string | null {
  if (addr.startsWith("core1") && !addr.startsWith("corevaloper1")) return addr;
  if (addr.startsWith("corevaloper1")) {
    try {
      const { words } = bech32Decode(addr);
      return bech32Encode("core", words);
    } catch { return null; }
  }
  return null;
}
const TX = (n: number) => `${formatCompact(n)} TX`;
const mintscanAddr = (a: string) => `https://www.mintscan.io/tx/address/${a}`;
const mintscanTx = (h: string) => `https://www.mintscan.io/tx/tx/${h}`;
// "6 Apr 2023" — short, unambiguous, locale-independent order.
const fullDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

// A small pool of interesting wallets so the page always opens on a real,
// populated passport (rather than an empty box) and a "shuffle" reveals
// another. Mix of a top staker, a referral earner, and validator
// self-delegates so the demo shows off staking, PSE, tokens and governance.
const FEATURED: string[] = [
  "core19qcey9fc9xjjewk2wcfetjz69j75z0d9k75853", // top staker: 6M staked, PSE history, many tokens
  "core1dqpqxdujyhupcam3a48u882ankv52czr5j5xpd", // referral earner
  "core1x9hd9r7duv2gagztvvqlw94v5gy4zd9x5f7kl9", // 007TX validator
  "core1uhrrdv6g6v9t38v4qghjucunnxyk8xt34jazzr", // ZenLounge validator
  "core1p2zujexcdg7vuxjkfvahnwhutqradsjfclyx9m", // BRW Capital validator
  "core14t9235vp7f23erugflme3lzszykwsfwcgh7gck", // Brouj_TX validator
  "core1mpf63sa8djm82lvpy8028sxfext9k76c3dr22r", // Coreum Community DAO validator
  "core1m2zzfv08ndxjnxnxu9tlwa3r2myte5upqs0ff9", // TX_MARSHALLS validator
];
const randomFeatured = (exclude?: string): string => {
  const pool = FEATURED.filter((a) => a !== exclude);
  return pool[Math.floor(Math.random() * pool.length)] ?? FEATURED[0];
};

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
  // Start in the loading state: the page auto-opens a featured wallet on
  // mount, so we show the spinner immediately instead of flashing an empty
  // entry form for a frame.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Loaded | null>(null);
  const [copied, setCopied] = useState(false);
  // Address currently previewed in the slide-in peek panel (click a
  // counterparty to drill in without leaving the current passport).
  const [peekAddress, setPeekAddress] = useState<string | null>(null);
  // True while the indexer-backed cards are still streaming in after the
  // core passport has rendered. Bumped per load() so a stale in-flight
  // enrichment can't overwrite a newer lookup.
  const [enriching, setEnriching] = useState(false);
  const epochRef = useRef(0);
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
    const epoch = ++epochRef.current;
    setError(null);
    setLoading(true);
    setData(null);
    setEnriching(true);

    // ── Phase 1: the reliable core, straight from the LCD. This renders the
    // hero, holdings, delegations and the PSE estimate right away, so the
    // page never sits on a spinner waiting for the (sometimes slow or
    // degraded) public indexer.
    try {
      const [chain, score, pseNet, bondedTokens, monikers] = await Promise.all([
        fetchAddressChainData(address),
        fetchOnChainPSEScore(address),
        fetch(`/api/pse-score`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetchBondedTokens(),
        fetchValidatorMonikers(),
      ]);
      if (epochRef.current !== epoch) return;

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
      const badges = computeBadges({
        isExchange: false, rank: null,
        stakedTX: chain.stakedTX, balanceTX: chain.balanceTX,
        netToExchanges: 0, exchangeTxCount: 0, turnoutPct: 0, votedCount: 0,
      });

      setData({
        address, chain, flows: null, gov: null, pse, pseEarned: null,
        activity: [], validatorOperator: null, firstSeen: null, referral: null, badges, monikers,
      });
      setLoading(false);
    } catch (e) {
      if (epochRef.current === epoch) {
        setError(e instanceof Error ? e.message : "Failed to load wallet passport");
        setLoading(false);
        setEnriching(false);
      }
      return;
    }

    // ── Phase 2: the indexer/DB-backed cards (activity, exchange flow,
    // governance, referrals, PSE history). These stream in as they resolve;
    // each is bounded server-side, so a bad indexer moment leaves those
    // cards empty instead of freezing the whole passport.
    Promise.all([
      fetch(`/api/flows-address?address=${address}&window=all`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`/api/address/governance?address=${address}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`/api/address/activity?address=${address}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`/api/address/referrals?address=${address}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`/api/address/pse-earned?address=${address}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([flowsRes, govRes, activityRes, refRes, pseEarnedRes]) => {
      if (epochRef.current !== epoch) return;
      const flows: FlowsAddress | null = flowsRes && !flowsRes.error ? flowsRes : null;
      const gov: GovHistory | null = govRes && !govRes.error ? govRes : null;
      const activity: ActivityItem[] = Array.isArray(activityRes?.items) ? activityRes.items : [];
      const validatorOperator: string | null = activityRes?.validatorOperator ?? null;
      const firstSeen: string | null = activityRes?.firstSeen?.timestamp ?? null;
      const referral: Referral | null = refRes && !refRes.error ? refRes : null;
      const pseEarned: PseEarned | null = pseEarnedRes && !pseEarnedRes.error && pseEarnedRes.count > 0 ? pseEarnedRes : null;

      setData((prev) => {
        if (!prev) return prev;
        const sent = flows?.summary.totalSentToExchanges ?? 0;
        const received = flows?.summary.totalReceivedFromExchanges ?? 0;
        const badges = computeBadges({
          isExchange: flows?.isExchange ?? false,
          rank: flows?.rank ?? null,
          stakedTX: prev.chain.stakedTX,
          balanceTX: prev.chain.balanceTX,
          netToExchanges: sent - received,
          exchangeTxCount: flows?.summary.txCount ?? 0,
          turnoutPct: gov?.summary.turnoutPct ?? 0,
          votedCount: gov?.summary.votedCount ?? 0,
        });
        return { ...prev, flows, gov, activity, validatorOperator, firstSeen, referral, pseEarned, badges };
      });
    }).finally(() => {
      if (epochRef.current === epoch) setEnriching(false);
    });
  }, []);

  // On open, land on a real passport: the ?address from the URL if present,
  // otherwise a random featured wallet, so newcomers immediately see what
  // the page is for instead of a blank input.
  useEffect(() => {
    if (ranInitial.current || typeof window === "undefined") return;
    ranInitial.current = true;
    const fromQuery = new URLSearchParams(window.location.search).get("address");
    if (fromQuery && isValidAddr(fromQuery)) {
      setInput(fromQuery);
      load(fromQuery);
    } else {
      load(randomFeatured());
    }
  }, [load]);

  const submit = () => load(input);
  // Jump to another featured wallet (different from the current one).
  const shuffle = () => { setInput(""); load(randomFeatured(data?.address)); if (typeof window !== "undefined") window.scrollTo({ top: 0 }); };
  // Peek a related wallet in the side panel; a core1 address only.
  const peek = (a?: string) => { if (a && isValidAddr(a)) setPeekAddress(a); };
  // Promote the peeked wallet to the full-page passport.
  const openFull = (a: string) => {
    setPeekAddress(null);
    setInput(a);
    load(a);
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  };
  const copyAddr = () => {
    if (!data) return;
    navigator.clipboard?.writeText(data.address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  // Persistent top bar: title + look-up-any-address search + shuffle, shown
  // on every state so the page's purpose (and a way to try your own wallet)
  // is always in view.
  const searchBar = (
    <div className="psp-topbar">
      <div className="psp-topbar-lead">
        <h1 className="psp-topbar-title">Wallet Passport</h1>
        <span className="psp-topbar-sub">Any TX wallet: holdings, staking, PSE, flows, governance.</span>
      </div>
      <div className="psp-topbar-search">
        <input
          className="psp-topbar-input"
          placeholder="Look up any core1... address"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          maxLength={100}
          spellCheck={false}
        />
        <button className="psp-topbar-btn" onClick={submit} disabled={!input.trim()}>View</button>
        <button className="psp-topbar-btn ghost" onClick={shuffle} title="Show a random wallet">Shuffle</button>
        {connectedAddress && (
          <button className="psp-topbar-btn ghost" onClick={() => { setInput(connectedAddress); load(connectedAddress); }}>My wallet</button>
        )}
      </div>
    </div>
  );

  // ─── Loading / error (no data yet) ─────────────────────────────────
  if (loading || !data) {
    return (
      <div className="psp">
        {searchBar}
        {loading ? (
          <div className="psp-loading"><span className="psp-spinner" aria-hidden="true" /> Reading the chain for this wallet...</div>
        ) : (
          <div className="psp-loading">
            {error ? <span className="psp-error" role="alert">{error}</span> : "No wallet loaded."}
            <button className="psp-topbar-btn ghost" onClick={shuffle} style={{ marginLeft: 12 }}>Show a wallet</button>
          </div>
        )}
      </div>
    );
  }
  const { address, chain, flows, gov, pse, pseEarned, activity, validatorOperator, firstSeen, referral, badges, monikers } = data;
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
  const oldest = activity[activity.length - 1]?.timestamp ?? null;
  const firstActivity = firstSeen ?? oldest ?? (flows?.recent.length ? flows.recent[flows.recent.length - 1].timestamp : null);

  // Net TX flow across the visible on-chain window (sends out vs receives in).
  let flowIn = 0, flowOut = 0;
  for (const e of activity) {
    if (!e.amountTX) continue;
    if (e.kind === "receive" || e.kind === "referral_reward" || e.kind === "claim_rewards") flowIn += e.amountTX;
    else if (e.kind === "send" || e.kind === "ibc_transfer") flowOut += e.amountTX;
  }
  const windowNet = flowIn - flowOut;
  const hasFlow = flowIn > 0 || flowOut > 0;

  // The validator moniker, if this wallet is a validator's self-delegate.
  const validatorName = validatorOperator ? (monikers[validatorOperator] || null) : null;
  const isValidator = !!validatorOperator;

  const govCounts: Record<string, number> = { YES: 0, NO: 0, ABSTAIN: 0, NO_WITH_VETO: 0 };
  for (const v of gov?.votes ?? []) govCounts[v.option] = (govCounts[v.option] ?? 0) + 1;
  const govTotal = (gov?.votes ?? []).length;

  return (
    <div className="psp">
      {searchBar}
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
                {isValidator && <span className="psp-tag psp-tag-rank" title={validatorOperator ?? undefined}>Validator{validatorName ? `: ${validatorName}` : ""}</span>}
                {label && <span className="psp-tag psp-tag-label">{label}</span>}
                {flows?.rank != null && <span className="psp-tag psp-tag-rank">Staker rank #{flows.rank}</span>}
                {firstActivity && (
                  <span className="psp-tag psp-tag-soft" title={firstSeen ? `Wallet created ${fullDate(firstActivity)}` : undefined}>
                    {firstSeen ? "Created" : "First seen"} {relativeTimeShort(firstActivity)}
                    {firstSeen ? ` · ${fullDate(firstActivity)}` : ""}
                  </span>
                )}
                {chain.txsSent > 0 && <span className="psp-tag psp-tag-soft">{formatCompact(chain.txsSent)} txns signed</span>}
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

      {/* ── Summary: two bounded, always-similar cards that align cleanly ── */}
      <div className="psp-summary">
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

        {/* PSE standing */}
        <Card title="PSE standing">
          {(pse && pse.eligible) || pseEarned ? (
            <>
              <div className="psp-kv-grid">
                {pseEarned
                  ? <>
                      <KV label="Earned to date" value={TX(pseEarned.totalTX)} sub={usd(pseEarned.totalTX)} tone="good" />
                      <KV label="Distributions" value={String(pseEarned.count)} />
                    </>
                  : <KV label="Eligible" value="Yes" tone="good" />}
                {pse && pse.eligible && <>
                  <KV label="Est. next" value={TX(pse.monthly)} sub={usd(pse.monthly)} />
                  <KV label="Monthly yield" value={`${monthlyYieldPct.toFixed(1)}%`} />
                </>}
              </div>
              {pse && pse.eligible && (
                <div className="psp-sharebar-wrap">
                  <div className="psp-sharebar-head"><span>Share of PSE pool</span><span>{pse.sharePct < 0.01 ? "<0.01" : pse.sharePct.toFixed(2)}%</span></div>
                  <div className="psp-bar-track"><div className="psp-bar-fill psp-fill-reward" style={{ width: `${Math.min(100, Math.max(pse.sharePct, 0.4))}%` }} /></div>
                </div>
              )}
              {pseEarned && pseEarned.distributions.length > 1 && (
                <div className="psp-distbars">
                  <div className="psp-list-head">Paid per distribution</div>
                  <div className="psp-distbars-row">
                    {[...pseEarned.distributions].reverse().map((d) => {
                      const max = Math.max(...pseEarned.distributions.map((x) => x.amountTX), 1);
                      return (
                        <div key={d.height} className="psp-distbar" title={`${TX(d.amountTX)} · block ${d.height}`}>
                          <div className="psp-distbar-fill" style={{ height: `${Math.max((d.amountTX / max) * 100, 4)}%` }} />
                        </div>
                      );
                    })}
                  </div>
                  <div className="psp-distbars-foot"><span>oldest</span><span>latest {TX(pseEarned.lastTX)}</span></div>
                </div>
              )}
            </>
          ) : enriching ? <CardLoading /> : <Empty>No active PSE score. PSE accrues to community stakers; stake TX to start earning.</Empty>}
        </Card>
      </div>

      {/* ── Detail: full-width sections. Each can be any height (a wallet
          may delegate to 1 or 8 validators, trade on 0 or 6 exchanges), so
          nothing is paired side-by-side and there is never a height
          mismatch to align. ── */}
      <div className="psp-sections">
        {/* Delegations */}
        <Card title="Delegations">
          {chain.delegations.length > 0 ? (
            <div className="psp-bars psp-cols">
              {chain.delegations.filter((d) => d.amountTX > 0).slice(0, 8).map((d) => {
                const pct = chain.stakedTX > 0 ? (d.amountTX / chain.stakedTX) * 100 : 0;
                const wallet = toWallet(d.validatorAddress);
                return (
                  <div key={d.validatorAddress} className={`psp-bar-row${wallet ? " psp-bar-row-peek" : ""}`} onClick={wallet ? () => peek(wallet) : undefined}>
                    <div className="psp-bar-head">
                      <span className="psp-bar-name">{nameOf(d.validatorAddress)}{wallet && <span className="psp-peek-hint">peek ↗</span>}</span>
                      <span className="psp-bar-val">{TX(d.amountTX)} <span className="psp-bar-pct">{pct.toFixed(0)}%</span></span>
                    </div>
                    <div className="psp-bar-track"><div className="psp-bar-fill psp-fill-staked" style={{ width: `${pct}%` }} /></div>
                  </div>
                );
              })}
            </div>
          ) : <Empty>This wallet has no active delegations.</Empty>}
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
          ) : enriching ? <CardLoading /> : <Empty>No exchange deposits or withdrawals on record for this wallet.</Empty>}
        </Card>

        {/* Referral earnings (on-chain, tx.market). A niche card, so it only
            shows for wallets that actually earned referral rewards rather
            than adding an empty "none" section to every other wallet. */}
        {(referral && referral.payoutCount > 0) && (
          <Card title="Referral earnings">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 32 }}>
              <KV label="Referrals made" value={String(referral.referralsMade)} />
              <KV label="Earned" value={TX(referral.totalEarnedTX)} sub={usd(referral.totalEarnedTX)} />
              <KV label="Tier" value={referral.elite ? "Elite (2x)" : "Base"} tone={referral.elite ? "good" : undefined} />
              {referral.referredBy && (
                <button className="psp-kv psp-kv-btn" onClick={() => peek(referral.referredBy!)}>
                  <span className="psp-kv-label">Referred by</span>
                  <span className="psp-kv-value">{shortAddr(referral.referredBy)} <span className="psp-peek-hint">peek ↗</span></span>
                </button>
              )}
            </div>
            <div style={{ marginTop: 14, fontSize: "0.78rem", color: "var(--text-light)", lineHeight: 1.5 }}>
              On-chain tx.market referral rewards: 500 TX per verified signup, 1000 TX as Elite Club.
            </div>
          </Card>
        )}

        {/* Governance */}
        <Card title="Governance record">
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
          ) : enriching ? <CardLoading /> : <Empty>This wallet has not voted on any governance proposals.</Empty>}
        </Card>

        {/* Token holdings (non-TX smart tokens / IBC assets) */}
        {chain.otherTokens.length > 0 && (
          <Card title="Other token holdings">
            <div className="psp-tokengrid">
              {chain.otherTokens.map((t) => (
                <div key={t.denom} className="psp-tokencard" title={t.denom}>
                  <span className="psp-tokencard-amt mono">
                    {t.displayAmount >= 1 ? formatCompact(t.displayAmount) : t.displayAmount.toPrecision(2)}
                  </span>
                  <span className="psp-tokencard-sym">{t.symbol}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Recent on-chain activity (full history from the indexer) */}
        <Card title="Recent activity">
          {hasFlow && (
            <div className="psp-flowsummary">
              <span className="psp-flowsummary-item in">In {TX(flowIn)}</span>
              <span className="psp-flowsummary-item out">Out {TX(flowOut)}</span>
              <span className={`psp-flowsummary-net ${windowNet >= 0 ? "in" : "out"}`}>
                Net {windowNet >= 0 ? "+" : "−"}{TX(Math.abs(windowNet))}
                <span className="psp-row-meta"> · last {activity.length} events</span>
              </span>
            </div>
          )}
          {activity.length > 0 ? (
            <div className="psp-list psp-cols">
              {activity.slice(0, 15).map((e, i) => {
                const [tone, verb, who, sign] = describeActivity(e, nameOf);
                const cpAddr = e.counterparty ? toWallet(e.counterparty) : null;
                return (
                  <div key={`${e.txHash}-${i}`} className={`psp-row${cpAddr ? " psp-row-peek" : ""}`} onClick={cpAddr ? () => peek(cpAddr) : undefined}>
                    <span className="psp-row-name">
                      <span className={`psp-evt ${tone}`}>{verb}</span> <span className={cpAddr ? "psp-cp-link" : undefined}>{who}</span>
                      {cpAddr && <span className="psp-peek-hint">peek ↗</span>}
                    </span>
                    <span className="psp-row-val">
                      {e.amountTX ? <>{sign}{TX(e.amountTX)} </> : null}
                      <a className="psp-row-meta psp-row-link" href={mintscanTx(e.txHash)} target="_blank" rel="noopener noreferrer" onClick={(ev) => ev.stopPropagation()}>
                        {e.timestamp ? relativeTimeShort(e.timestamp) : `#${e.height}`} ↗
                      </a>
                    </span>
                  </div>
                );
              })}
            </div>
          ) : enriching ? <CardLoading /> : <Empty>No on-chain activity found for this wallet.</Empty>}
        </Card>
      </div>

      <button className="psp-reset" onClick={shuffle}>Show another wallet →</button>

      <WalletPanel
        address={peekAddress}
        monikers={monikers}
        txPrice={txPrice}
        onClose={() => setPeekAddress(null)}
        onOpenFull={openFull}
      />
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
function CardLoading() {
  return <div className="psp-empty"><span className="psp-spinner sm" aria-hidden="true" /> Reading the chain...</div>;
}
// Human line for an activity item: [chip tone, chip verb, subject, amount sign].
function describeActivity(
  e: ActivityItem,
  nameOf: (v: string) => string,
): [string, string, string, string] {
  const cp = e.counterparty ?? "";
  const cpName = e.counterpartyLabel ?? shortAddr(cp); // known entity name if any
  switch (e.kind) {
    case "receive": return ["in", "Received", `from ${cpName}`, "+"];
    case "send": return ["out", "Sent", `to ${cpName}`, "−"];
    case "delegate": return ["in", "Delegated", `to ${nameOf(cp)}`, "+"];
    case "undelegate": return ["out", "Undelegated", `from ${nameOf(cp)}`, "−"];
    case "redelegate": return ["neutral", "Redelegated", `to ${nameOf(cp)}${e.detail ? ` from ${nameOf(e.detail)}` : ""}`, ""];
    case "claim_rewards": return ["in", "Claimed rewards", e.detail ?? (cp ? `from ${nameOf(cp)}` : ""), "+"];
    case "vote": return ["neutral", "Voted", e.detail ?? "", ""];
    case "referral_reward": return ["in", "Referral reward", e.detail ?? "", "+"];
    case "ibc_transfer": return ["out", "IBC transfer", `to ${cpName}`, "−"];
    case "contract": return ["neutral", "Contract call", cpName, ""];
    default: return ["neutral", "Activity", "", ""];
  }
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
