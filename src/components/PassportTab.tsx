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
  summary: {
    totalSentToExchanges: number;
    totalReceivedFromExchanges: number;
    net: number;
    txCount: number;
  };
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

interface Loaded {
  address: string;
  chain: AddressChainData;
  flows: FlowsAddress | null;
  gov: GovHistory | null;
  pse: PseStanding | null;
  badges: Badge[];
  monikers: Record<string, string>;
}

const TX = (n: number) => `${formatCompact(n)} TX`;
const shortAddr = (a: string) => (a.length > 16 ? `${a.slice(0, 10)}...${a.slice(-4)}` : a);
const isValidAddr = (a: string) => a.startsWith("core1") && a.length >= 39;

export default function PassportTab({
  connectedAddress,
}: {
  connectedAddress?: string;
}) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Loaded | null>(null);
  const ranInitial = useRef(false);

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
      const [chain, flowsRes, govRes, score, pseNet, bondedTokens, monikers] = await Promise.all([
        fetchAddressChainData(address),
        fetch(`/api/flows-address?address=${address}&window=all`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch(`/api/address/governance?address=${address}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetchOnChainPSEScore(address),
        fetch(`/api/pse-score`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetchBondedTokens(),
        fetchValidatorMonikers(),
      ]);

      const flows: FlowsAddress | null = flowsRes && !flowsRes.error ? flowsRes : null;
      const gov: GovHistory | null = govRes && !govRes.error ? govRes : null;

      // PSE estimate via the shared layered model. When the enumerated
      // network score is available (production) it gives the exact share;
      // otherwise we fall back to a stake-proportion estimate against total
      // bonded tokens, which stays sane rather than collapsing to 100%.
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

      setData({ address, chain, flows, gov, pse, badges, monikers });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load wallet passport");
    } finally {
      setLoading(false);
    }
  }, []);

  // Deep-link: ?address= in the URL auto-loads the passport once.
  useEffect(() => {
    if (ranInitial.current) return;
    if (typeof window === "undefined") return;
    const fromQuery = new URLSearchParams(window.location.search).get("address");
    if (fromQuery && isValidAddr(fromQuery)) {
      ranInitial.current = true;
      setInput(fromQuery);
      load(fromQuery);
    }
  }, [load]);

  const submit = () => load(input);
  const reset = () => {
    setData(null);
    setError(null);
    setInput("");
  };

  // ─── Entry state ────────────────────────────────────────────────
  if (!data && !loading) {
    return (
      <div className="psp">
        <div className="psp-intro">
          <h1 className="psp-title">Wallet Passport</h1>
          <p className="psp-sub">
            Everything about any TX wallet in one place: holdings, staking, PSE
            standing, exchange behavior, and governance record.
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
          <button className="psp-btn-primary" onClick={submit} disabled={!input.trim()}>
            View passport
          </button>
          {connectedAddress && (
            <>
              <div className="psp-or">or</div>
              <button
                className="psp-btn-secondary"
                onClick={() => {
                  setInput(connectedAddress);
                  load(connectedAddress);
                }}
              >
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
        <div className="psp-loading">
          <span className="psp-spinner" aria-hidden="true" />
          Reading the chain for this wallet...
        </div>
      </div>
    );
  }

  if (!data) return null;
  const { address, chain, flows, gov, pse, badges, monikers } = data;
  const label = flows?.isExchange ? flows.exchangeName : flows?.label;
  const nameOf = (valAddr: string) => monikers[valAddr] || shortAddr(valAddr);

  return (
    <div className="psp">
      {/* ── Summary card (shareable) ── */}
      <Shareable
        title="TX Wallet Passport"
        subtitle={shortAddr(address)}
        caption="Holdings, staking, PSE and governance at a glance"
        exportWidth={680}
      >
        <div className="psp-card psp-summary">
          <div className="psp-summary-head">
            <div className="psp-addr-block">
              <span className="psp-addr mono">{shortAddr(address)}</span>
              <div className="psp-addr-tags">
                {label && <span className="psp-tag psp-tag-label">{label}</span>}
                {flows?.rank != null && <span className="psp-tag psp-tag-rank">Rank #{flows.rank}</span>}
              </div>
            </div>
          </div>
          {badges.length > 0 && (
            <div className="psp-badges">
              {badges.map((b) => (
                <span key={b.label} className={`psp-badge psp-badge-${b.tone}`} title={b.title}>
                  {b.label}
                </span>
              ))}
            </div>
          )}
          <div className="psp-summary-stats">
            <div className="psp-stat">
              <span className="psp-stat-label">Staked</span>
              <span className="psp-stat-value">{TX(chain.stakedTX)}</span>
            </div>
            <div className="psp-stat">
              <span className="psp-stat-label">Liquid</span>
              <span className="psp-stat-value">{TX(chain.balanceTX)}</span>
            </div>
            <div className="psp-stat">
              <span className="psp-stat-label">Rewards</span>
              <span className="psp-stat-value">{TX(chain.rewardsTX)}</span>
            </div>
          </div>
        </div>
      </Shareable>

      {/* ── Holdings & staking ── */}
      <div className="psp-card">
        <div className="psp-card-head">Holdings &amp; staking</div>
        <div className="psp-kv-grid">
          <KV label="Liquid balance" value={TX(chain.balanceTX)} />
          <KV label="Total staked" value={TX(chain.stakedTX)} />
          <KV label="Pending rewards" value={TX(chain.rewardsTX)} />
          <KV label="Validators" value={String(chain.validatorCount)} />
          {chain.unbondingTX > 0 && <KV label="Unbonding" value={TX(chain.unbondingTX)} />}
        </div>
        {chain.delegations.length > 0 && (
          <div className="psp-list">
            <div className="psp-list-head">Delegations</div>
            {chain.delegations.slice(0, 8).map((d) => (
              <div key={d.validatorAddress} className="psp-row">
                <span className="psp-row-name">{nameOf(d.validatorAddress)}</span>
                <span className="psp-row-val">{TX(d.amountTX)}</span>
              </div>
            ))}
          </div>
        )}
        {chain.unbonding.length > 0 && (
          <div className="psp-list">
            <div className="psp-list-head">Unbonding</div>
            {chain.unbonding.slice(0, 5).map((u, i) => (
              <div key={i} className="psp-row">
                <span className="psp-row-name">{nameOf(u.validatorAddress)}</span>
                <span className="psp-row-val">
                  {TX(u.amountTX)}{" "}
                  <span className="psp-row-meta">free {relativeTimeShort(u.completionTime)}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── PSE standing ── */}
      <div className="psp-card">
        <div className="psp-card-head">PSE standing</div>
        {pse && pse.eligible ? (
          <div className="psp-kv-grid">
            <KV label="Eligible" value="Yes" tone="good" />
            <KV label="Est. monthly PSE" value={TX(pse.monthly)} />
            <KV label="Est. annual PSE" value={TX(pse.annual)} />
            <KV label="Share of pool" value={`${pse.sharePct < 0.01 ? "<0.01" : pse.sharePct.toFixed(2)}%`} />
          </div>
        ) : (
          <div className="psp-empty">
            This wallet has no active PSE score. PSE accrues to community
            stakers; stake TX to start earning.
          </div>
        )}
      </div>

      {/* ── Exchange behavior ── */}
      <div className="psp-card">
        <div className="psp-card-head">Exchange behavior</div>
        {flows && flows.summary.txCount > 0 ? (
          <>
            <div className="psp-flow-verdict">
              {flows.summary.totalReceivedFromExchanges > flows.summary.totalSentToExchanges ? (
                <span className="psp-flow-accum">Net accumulating ({TX(flows.summary.totalReceivedFromExchanges - flows.summary.totalSentToExchanges)} off exchanges)</span>
              ) : (
                <span className="psp-flow-distrib">Net distributing ({TX(flows.summary.totalSentToExchanges - flows.summary.totalReceivedFromExchanges)} to exchanges)</span>
              )}
            </div>
            <div className="psp-kv-grid">
              <KV label="Sent to exchanges" value={TX(flows.summary.totalSentToExchanges)} />
              <KV label="Received from exchanges" value={TX(flows.summary.totalReceivedFromExchanges)} />
              <KV label="Exchange transactions" value={String(flows.summary.txCount)} />
            </div>
            {flows.perExchange.length > 0 && (
              <div className="psp-list">
                <div className="psp-list-head">By exchange</div>
                {flows.perExchange.slice(0, 6).map((e) => (
                  <div key={e.exchange} className="psp-row">
                    <span className="psp-row-name">{e.exchange}</span>
                    <span className="psp-row-val">{e.net >= 0 ? "+" : ""}{TX(e.net)} net</span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="psp-empty">No exchange deposits or withdrawals on record for this wallet.</div>
        )}
      </div>

      {/* ── Governance record ── */}
      <div className="psp-card">
        <div className="psp-card-head">Governance record</div>
        {gov && gov.votes.length > 0 ? (
          <>
            <div className="psp-kv-grid">
              <KV label="Proposals voted" value={`${gov.summary.votedCount} / ${gov.summary.votableCount}`} />
              <KV label="Turnout" value={`${gov.summary.turnoutPct}%`} tone={gov.summary.turnoutPct >= 60 ? "good" : undefined} />
              {gov.summary.lastVotedAt && <KV label="Last vote" value={relativeTimeShort(gov.summary.lastVotedAt)} />}
            </div>
            <div className="psp-list">
              <div className="psp-list-head">Voting history</div>
              {gov.votes.slice(0, 10).map((v) => (
                <div key={v.proposalId} className="psp-row">
                  <span className="psp-row-name">
                    <span className="psp-prop-id">#{v.proposalId}</span> {v.title}
                  </span>
                  <span className={`psp-vote psp-vote-${v.option.toLowerCase()}`}>{voteLabel(v.option)}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="psp-empty">This wallet has not voted on any governance proposals.</div>
        )}
      </div>

      <button className="psp-reset" onClick={reset}>← Look up another wallet</button>
    </div>
  );
}

function KV({ label, value, tone }: { label: string; value: string; tone?: "good" }) {
  return (
    <div className="psp-kv">
      <span className="psp-kv-label">{label}</span>
      <span className={`psp-kv-value${tone === "good" ? " psp-kv-good" : ""}`}>{value}</span>
    </div>
  );
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
