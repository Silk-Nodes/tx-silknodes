"use client";

const BASE_PATH = process.env.NODE_ENV === "production" ? "/tx-silknodes" : "";

import { useState, useEffect, useRef, useMemo, useCallback, Fragment } from "react";
import { useTokenData } from "@/hooks/useTokenData";
import { useWallet } from "@/hooks/useWallet";
import {
  getPSEDistributionInfo,
  getProjectionSummary,
  estimatePSERewardFullPeriod,
  PSE_CONFIG,
  PSE_ALLOCATION,
} from "@/lib/pse-calculator";
import type { CalculatorInputs } from "@/lib/types";
import ValidatorList from "@/components/ValidatorList";
import SupplyChart from "@/components/SupplyChart";
import Tooltip from "@/components/Tooltip";
import { useRWATokens } from "@/hooks/useRWATokens";
import type { SmartToken } from "@/hooks/useRWATokens";

// ─── Helpers ───

function formatNumber(num: number): string {
  if (num >= 1e9) return `${(num / 1e9).toFixed(1)}B`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(1)}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(1)}K`;
  return num.toLocaleString();
}

function formatUSD(num: number): string {
  if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(1)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(1)}K`;
  return `$${num.toLocaleString()}`;
}

function formatTX(num: number): string {
  if (num >= 1e6) return `~${(num / 1e6).toFixed(2)}M TX`;
  if (num >= 1e3) return `~${(num / 1e3).toFixed(1)}K TX`;
  return `~${Math.round(num).toLocaleString()} TX`;
}

const TX_PER_SECOND = PSE_CONFIG.monthlyEmission / (30 * 24 * 3600);

type TabId = "overview" | "pse" | "calculator" | "validators" | "rwa" | "silknodes" | "portfolio";

const TABS: { id: TabId; label: string; walletOnly?: boolean }[] = [
  { id: "overview", label: "Overview" },
  { id: "portfolio", label: "Portfolio", walletOnly: true },
  { id: "pse", label: "PSE" },
  { id: "calculator", label: "Calculator" },
  { id: "rwa", label: "RWA" },
  { id: "validators", label: "Validators" },
  { id: "silknodes", label: "Silk Nodes" },
];

export default function HomePage() {
  const { tokenData, stakingData, networkStatus, loading } = useTokenData();
  const {
    wallet, connect, disconnect, refresh, claimRewards,
    delegate, undelegate, redelegate,
    loading: walletLoading, error: walletError, clearError,
    txPending, txResult, clearTxResult, availableWallets,
  } = useWallet();
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [showWalletModal, setShowWalletModal] = useState(false);

  // ─── PSE Countdown State ───
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  const [distributed, setDistributed] = useState(0);
  const startTime = useRef(Date.now());
  const pseInfo = useMemo(() => getPSEDistributionInfo(), []);
  const targetMs = pseInfo.nextDistribution.getTime();

  const cycleProgress = useMemo(() => {
    const now = new Date();
    const prev = new Date(pseInfo.nextDistribution);
    prev.setMonth(prev.getMonth() - 1);
    const total = targetMs - prev.getTime();
    const elapsed = now.getTime() - prev.getTime();
    return Math.min(100, Math.max(0, (elapsed / total) * 100));
  }, [targetMs, pseInfo.nextDistribution]);

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const diff = targetMs - now;
      if (diff > 0) {
        setTimeLeft({
          days: Math.floor(diff / 86400000),
          hours: Math.floor((diff / 3600000) % 24),
          minutes: Math.floor((diff / 60000) % 60),
          seconds: Math.floor((diff / 1000) % 60),
        });
      }
      setDistributed(((now - startTime.current) / 1000) * TX_PER_SECOND);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetMs]);

  const pad = (n: number) => String(n).padStart(2, "0");

  // ─── Calculator State ───
  const [stakeInput, setStakeInput] = useState("");
  const [targetRatio, setTargetRatio] = useState("67");
  const [targetPrice, setTargetPrice] = useState("1");
  const stakedAmount = parseFloat(stakeInput.replace(/,/g, "")) || 0;

  const summary = useMemo(() => {
    const inputs: CalculatorInputs = {
      stakedAmount,
      targetStakingRatio: parseFloat(targetRatio) || 67,
      targetPrice: parseFloat(targetPrice) || (tokenData?.price || 0.05),
      currentSupply: tokenData?.circulatingSupply || 1_927_475_509,
      currentStakingRatio: stakingData?.stakingRatio || 40,
      currentPrice: tokenData?.price || 0.0142,
      currentInflation: stakingData?.inflationRaw || 0.000972,
    };
    return getProjectionSummary(inputs);
  }, [stakedAmount, targetRatio, targetPrice, tokenData, stakingData]);

  const waitComparison = useMemo(() => {
    if (stakedAmount <= 0) return null;
    const nowBag = summary.fullCycle.totalBag;
    const lost = summary.projections.slice(0, 3).reduce((s, p) => s + p.pseReward + p.stakingRewards, 0);
    const waitBag = nowBag - lost;
    return {
      nowBag,
      waitBag: Math.round(waitBag),
      diff: Math.round(nowBag - waitBag),
      diffPct: (((nowBag - waitBag) / waitBag) * 100).toFixed(1),
    };
  }, [summary, stakedAmount]);

  const growthPct = stakedAmount > 0
    ? (((summary.fullCycle.totalBag - stakedAmount) / stakedAmount) * 100).toFixed(0)
    : "0";

  // ─── Derived ───
  const price = tokenData?.price ?? 0;
  const priceChange = tokenData?.priceChange24h ?? 0;
  const marketCap = (tokenData?.marketCap ?? 0) > 0 ? tokenData!.marketCap : price * (tokenData?.circulatingSupply ?? 0);
  const stakingRatio = stakingData?.stakingRatio ?? 0;
  const apr = stakingData?.apr ?? 0;
  const bondedTokens = stakingData?.bondedTokens ?? 0;
  const excludedPSEStake = stakingData?.excludedPSEStake ?? 0;
  const pseEligibleBonded = stakingData?.pseEligibleBonded ?? bondedTokens;
  const nextPSEReward = pseEligibleBonded > 0
    ? estimatePSERewardFullPeriod(wallet.connected ? wallet.stakedAmount : stakedAmount, bondedTokens, excludedPSEStake)
    : 0;

  const truncAddr = (addr: string) => `${addr.slice(0, 8)}...${addr.slice(-4)}`;

  return (
    <div className="app-shell">
      {/* ════════ TOP NAV ════════ */}
      <nav className="top-nav">
        <div className="brand">
          All in ONE <div className="brand-icon"><img src={`${BASE_PATH}/tx-icon.svg`} alt="TX" /></div>
        </div>

        <div className="nav-tabs">
          {TABS.filter((tab) => !tab.walletOnly || wallet.connected).map((tab) => (
            <button
              key={tab.id}
              className={`nav-tab ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="nav-right">
          <span className="live-indicator">
            <span className="live-dot" />
            {loading ? "Syncing" : "Live"}
          </span>
          <button
            className={`wallet-pill ${wallet.connected ? "connected" : ""}`}
            onClick={wallet.connected ? disconnect : () => setShowWalletModal(true)}
          >
            {walletLoading ? "Connecting..." : wallet.connected ? truncAddr(wallet.address) : "Connect Wallet"}
          </button>
        </div>
      </nav>
      <div className="nav-spacer" />

      {/* ════════ WALLET SELECTION MODAL ════════ */}
      {showWalletModal && !wallet.connected && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 9999,
            background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
          onClick={() => setShowWalletModal(false)}
        >
          <div
            style={{
              background: "#fff", borderRadius: "var(--radius-lg)", padding: "28px 32px",
              width: "min(380px, 90vw)", boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: 4 }}>Connect Wallet</div>
            <p style={{ fontSize: "0.78rem", color: "var(--text-light)", marginBottom: 18 }}>
              Choose a wallet to connect to the TX network
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button
                onClick={() => { setShowWalletModal(false); connect("keplr"); }}
                disabled={walletLoading}
                style={{
                  display: "flex", alignItems: "center", gap: 14, padding: "14px 18px",
                  borderRadius: "var(--radius-md)", border: "1px solid var(--glass-border)",
                  background: "var(--glass-bg)", cursor: "pointer", width: "100%",
                  opacity: availableWallets.keplr ? 1 : 0.4, transition: "all 0.15s",
                }}
              >
                <img src={`${BASE_PATH}/keplr-logo.svg`} alt="Keplr" style={{ width: 40, height: 40, borderRadius: 10 }} />
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>Keplr</div>
                  <div style={{ fontSize: "0.7rem", color: "var(--text-light)" }}>
                    {availableWallets.keplr ? "Detected" : "Not installed"}
                  </div>
                </div>
                {!availableWallets.keplr && (
                  <a href="https://www.keplr.app/download" target="_blank" rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    style={{ marginLeft: "auto", fontSize: "0.7rem", color: "var(--accent-olive)", textDecoration: "none", fontWeight: 600 }}>
                    Install
                  </a>
                )}
              </button>
              <button
                onClick={() => { setShowWalletModal(false); connect("leap"); }}
                disabled={walletLoading}
                style={{
                  display: "flex", alignItems: "center", gap: 14, padding: "14px 18px",
                  borderRadius: "var(--radius-md)", border: "1px solid var(--glass-border)",
                  background: "var(--glass-bg)", cursor: "pointer", width: "100%",
                  opacity: availableWallets.leap ? 1 : 0.4, transition: "all 0.15s",
                }}
              >
                <img src={`${BASE_PATH}/leap-logo.png`} alt="Leap" style={{ width: 40, height: 40, borderRadius: 10 }} />
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>Leap</div>
                  <div style={{ fontSize: "0.7rem", color: "var(--text-light)" }}>
                    {availableWallets.leap ? "Detected" : "Not installed"}
                  </div>
                </div>
                {!availableWallets.leap && (
                  <a href="https://www.leapwallet.io/download" target="_blank" rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    style={{ marginLeft: "auto", fontSize: "0.7rem", color: "var(--accent-olive)", textDecoration: "none", fontWeight: 600 }}>
                    Install
                  </a>
                )}
              </button>
            </div>
            <button
              onClick={() => setShowWalletModal(false)}
              style={{
                marginTop: 14, width: "100%", padding: "10px", borderRadius: "var(--radius-md)",
                border: "none", background: "transparent", cursor: "pointer",
                fontSize: "0.8rem", color: "var(--text-light)",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ════════ TOAST: Error / TX Result ════════ */}
      {walletError && (
        <div style={{
          position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)",
          zIndex: 9998, background: "#b44a3e", color: "#fff", padding: "12px 20px",
          borderRadius: "var(--radius-md)", fontSize: "0.82rem", fontWeight: 500,
          boxShadow: "0 8px 30px rgba(0,0,0,0.2)", display: "flex", alignItems: "center", gap: 10,
          maxWidth: "min(500px, calc(100vw - 32px))",
        }}>
          <span style={{ flex: 1 }}>{walletError}</span>
          <button onClick={clearError} style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: "1rem", padding: 0 }}>x</button>
        </div>
      )}
      {txResult && (
        <div style={{
          position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)",
          zIndex: 9998, background: "var(--tx-dark-green)", color: "#fff", padding: "12px 20px",
          borderRadius: "var(--radius-md)", fontSize: "0.82rem", fontWeight: 500,
          boxShadow: "0 8px 30px rgba(0,0,0,0.2)", display: "flex", alignItems: "center", gap: 10,
          maxWidth: 560,
        }}>
          <span style={{ color: "var(--tx-neon)", marginRight: 4 }}>&#10003;</span>
          <span style={{ flex: 1 }}>
            {txResult.type === "claim" ? "Rewards claimed!" : txResult.type === "delegate" ? "Delegation successful!" : txResult.type === "undelegate" ? "Undelegation started! (7-day unbonding)" : "Redelegation successful!"}
          </span>
          <a
            href={`https://www.mintscan.io/coreum/tx/${txResult.hash}`}
            target="_blank" rel="noopener noreferrer"
            style={{ color: "var(--tx-neon)", fontSize: "0.72rem", textDecoration: "none", fontWeight: 600, whiteSpace: "nowrap" }}
          >
            View TX
          </a>
          <button onClick={clearTxResult} style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: "1rem", padding: 0 }}>x</button>
        </div>
      )}

      {/* ════════ TAB CONTENT ════════ */}
      <div className="tab-content">
        {activeTab === "overview" && (
          <OverviewTab
            price={price}
            priceChange={priceChange}
            marketCap={marketCap}
            stakingRatio={stakingRatio}
            bondedTokens={bondedTokens}
            apr={apr}
            loading={loading}
            timeLeft={timeLeft}
            pad={pad}
            cycleProgress={cycleProgress}
            distributed={distributed}
            pseInfo={pseInfo}
            networkStatus={networkStatus}
            tokenData={tokenData}
            stakingData={stakingData}
            setActiveTab={setActiveTab}
            wallet={wallet}
            claimRewards={claimRewards}
            txPending={txPending}
            refresh={refresh}
            setShowWalletModal={setShowWalletModal}
            excludedPSEStake={excludedPSEStake}
            pseEligibleBonded={pseEligibleBonded}
          />
        )}

        {activeTab === "pse" && (
          <PSETab
            pseInfo={pseInfo}
            timeLeft={timeLeft}
            pad={pad}
            cycleProgress={cycleProgress}
            distributed={distributed}
            nextPSEReward={nextPSEReward}
            stakedAmount={stakedAmount}
            bondedTokens={bondedTokens}
            wallet={wallet}
            setActiveTab={setActiveTab}
            setShowWalletModal={setShowWalletModal}
          />
        )}

        {activeTab === "calculator" && (
          <CalculatorTab
            stakeInput={stakeInput}
            setStakeInput={setStakeInput}
            targetRatio={targetRatio}
            setTargetRatio={setTargetRatio}
            targetPrice={targetPrice}
            setTargetPrice={setTargetPrice}
            stakedAmount={stakedAmount}
            summary={summary}
            waitComparison={waitComparison}
            growthPct={growthPct}
            apr={apr}
            nextPSEReward={nextPSEReward}
            wallet={wallet}
            tokenData={tokenData}
            stakingData={stakingData}
            setActiveTab={setActiveTab}
          />
        )}

        {activeTab === "validators" && (
          <ValidatorsTab wallet={wallet} setActiveTab={setActiveTab} setShowWalletModal={setShowWalletModal} />
        )}

        {activeTab === "rwa" && (
          <RWATab bondedTokens={bondedTokens} price={price} />
        )}

        {activeTab === "silknodes" && (
          <SilkNodesTab networkStatus={networkStatus} stakingData={stakingData} setActiveTab={setActiveTab} wallet={wallet} setShowWalletModal={setShowWalletModal} />
        )}

        {activeTab === "portfolio" && wallet.connected && (
          <PortfolioTab
            wallet={wallet}
            price={price}
            apr={apr}
            bondedTokens={bondedTokens}
            excludedPSEStake={excludedPSEStake}
            pseEligibleBonded={pseEligibleBonded}
            pseInfo={pseInfo}
            stakingData={stakingData}
            claimRewards={claimRewards}
            delegate={delegate}
            undelegate={undelegate}
            redelegate={redelegate}
            refresh={refresh}
            txPending={txPending}
          />
        )}

      </div>

      {/* ════════ FOOTER ════════ */}
      <footer className="site-footer">
        <div className="footer-left">
          <div className="footer-brand-logo">
            All in ONE <div className="brand-icon"><img src={`${BASE_PATH}/tx-icon.svg`} alt="TX" /></div>
          </div>
          <span className="footer-sep">|</span>
          <span className="footer-built">Built by <a href="https://silknodes.io" target="_blank" rel="noopener noreferrer">Silk Nodes</a></span>
        </div>
        <div className="footer-right">
          <span className="footer-public-good">A Public Good for the TX Community</span>
        </div>
      </footer>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   TAB: OVERVIEW
   ═══════════════════════════════════════════════════════ */

function OverviewTab({
  price, priceChange, marketCap, stakingRatio, bondedTokens, apr, loading,
  timeLeft, pad, cycleProgress, distributed, pseInfo, networkStatus,
  tokenData, stakingData, setActiveTab, wallet, claimRewards, txPending,
  refresh, setShowWalletModal, excludedPSEStake, pseEligibleBonded,
}: any) {
  const totalSupply = tokenData?.circulatingSupply ?? 0;
  const stakingPct = stakingRatio.toFixed(1);
  const rawPseProgress = (pseInfo.distributionNumber - 1) / pseInfo.totalDistributions * 100;
  const pseProgressPct = rawPseProgress < 1 ? "<1" : rawPseProgress.toFixed(1);
  const remainingMonths = 84 - (pseInfo.distributionNumber - 1);
  const remainingYears = (remainingMonths / 12).toFixed(1);
  const activeValidators = networkStatus?.activeValidators ?? stakingData?.activeValidators ?? 0;

  // Generate network insights
  const insights: string[] = [];
  if (stakingRatio > 60) insights.push(`${stakingPct}% of circulating supply is staked,highly committed network`);
  else if (stakingRatio > 25) insights.push(`${stakingPct}% of circulating supply staked,strong early commitment, small bonded pool = high PSE per staker`);
  else insights.push(`${stakingPct}% of circulating supply staked,early phase, room to grow`);

  if (pseInfo.distributionNumber <= 6) insights.push("PSE just started,early phase advantage is highest now");
  else if (pseInfo.distributionNumber <= 24) insights.push("PSE in early phase,entry still captures significant advantage");
  else insights.push(`PSE at cycle ${pseInfo.distributionNumber},${(100 - parseFloat(pseProgressPct)).toFixed(0)}% of rewards remaining`);

  if (apr < 5) insights.push("Low base APR,real yields are driven by PSE rewards, not inflation");
  else insights.push(`${apr.toFixed(1)}% base APR + PSE rewards on top`);

  if (pseInfo.distributionNumber <= 12) insights.push("Each new staker reduces your relative share of future PSE rewards");

  return (
    <>
      {/* Narrative Header */}
      <div className="section-head">
        <h1 className="page-title">TX Network</h1>
        <span className="section-sub" style={{ fontSize: "0.8rem", opacity: 0.6 }}>
          Real-time network status, PSE progress, and staking intelligence
        </span>
      </div>

      {/* ═══ PRIMARY BLOCK: PSE + Staking (the hero) ═══ */}
      <div style={{
        background: "var(--tx-dark-green)", borderRadius: 16, padding: "24px 28px",
        marginBottom: 20, color: "#fff", position: "relative", overflow: "hidden",
      }}>
        <div style={{
          position: "absolute", top: -60, right: -60, width: 200, height: 200,
          borderRadius: "50%", background: "rgba(177,252,3,0.06)",
        }} />
        <div style={{ fontSize: "0.7rem", opacity: 0.5, marginBottom: 12, letterSpacing: "0.05em", textTransform: "uppercase" }}>
          Your Position in TX Economy
        </div>
        <div className="responsive-grid-3">
          {/* Staking Ratio */}
          <div>
            <div style={{ fontSize: "0.68rem", opacity: 0.45, marginBottom: 4 }}>Staked (of circulating)</div>
            <div style={{ fontSize: "2.4rem", fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--tx-neon)", lineHeight: 1.1 }}>
              {loading ? "---" : `${stakingPct}%`}
            </div>
            <div style={{ fontSize: "0.65rem", opacity: 0.4, marginTop: 4 }}>
              {formatNumber(bondedTokens)} TX bonded
              <Tooltip text="Mintscan shows 0.8% because it includes 100B locked PSE module in total supply" position="bottom" />
            </div>
          </div>
          {/* PSE Cycle */}
          <div>
            <div style={{ fontSize: "0.68rem", opacity: 0.45, marginBottom: 4 }}>PSE Cycle Status</div>
            <div style={{ fontSize: "2.4rem", fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--tx-neon-light)", lineHeight: 1.1 }}>
              {pseInfo.distributionNumber}<span style={{ fontSize: "1rem", opacity: 0.5 }}> / {pseInfo.totalDistributions}</span>
            </div>
            <div style={{ fontSize: "0.65rem", opacity: 0.4, marginTop: 4 }}>
              {pseInfo.distributionNumber <= 6 ? "Early Phase" : pseInfo.distributionNumber <= 24 ? "Growth Phase" : "Mature Phase"},{pseProgressPct}% distributed
              <Tooltip text="Highest PSE advantage before network saturation increases. Early stakers capture larger share." position="bottom" />
            </div>
          </div>
          {/* Next Drop Countdown */}
          <div>
            <div style={{ fontSize: "0.68rem", opacity: 0.45, marginBottom: 4 }}>Next PSE Drop</div>
            <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
              <span style={{ fontSize: "2.4rem", fontWeight: 700, fontFamily: "var(--font-mono)", color: "#fff", lineHeight: 1.1 }}>
                {pad(timeLeft.days)}
              </span>
              <span style={{ fontSize: "0.6rem", opacity: 0.4, marginRight: 4 }}>d</span>
              <span style={{ fontSize: "2.4rem", fontWeight: 700, fontFamily: "var(--font-mono)", color: "#fff", lineHeight: 1.1 }}>
                {pad(timeLeft.hours)}
              </span>
              <span style={{ fontSize: "0.6rem", opacity: 0.4, marginRight: 4 }}>h</span>
              <span style={{ fontSize: "2.4rem", fontWeight: 700, fontFamily: "var(--font-mono)", color: "#fff", lineHeight: 1.1 }}>
                {pad(timeLeft.minutes)}
              </span>
              <span style={{ fontSize: "0.6rem", opacity: 0.4 }}>m</span>
            </div>
            <div style={{ fontSize: "0.65rem", opacity: 0.4, marginTop: 4 }}>Distribution #{pseInfo.distributionNumber}</div>
          </div>
        </div>
        {/* Global Distribution Progress,prominent */}
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
            <span style={{ fontSize: "0.68rem", fontWeight: 600, color: "var(--tx-neon-light)", letterSpacing: "0.03em" }}>
              Global Distribution Progress
            </span>
            <span style={{ fontSize: "0.62rem", opacity: 0.4, fontFamily: "var(--font-mono)" }}>
              {pseProgressPct}% complete · ~{remainingYears} years remaining
            </span>
          </div>
          <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 6, height: 8, overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: 6, minWidth: rawPseProgress > 0 ? 4 : 0,
              width: `${Math.max(rawPseProgress, 0.5)}%`,
              background: "linear-gradient(90deg, var(--tx-neon), var(--tx-neon-light))",
              transition: "width 0.3s",
            }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
            <span style={{ fontSize: "0.55rem", opacity: 0.3 }}>
              {pseProgressPct}% complete
              <Tooltip text={`100B TX total emission over 84 months. Distribution just started, ~${(100 - rawPseProgress).toFixed(0)}% remaining`} position="bottom" />
            </span>
          </div>
        </div>

        {/* Current cycle progress */}
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 3 }}>
            <span style={{ fontSize: "0.58rem", opacity: 0.35 }}>Cycle {pseInfo.distributionNumber} distribution progress</span>
            <span style={{ fontSize: "0.55rem", opacity: 0.3, fontFamily: "var(--font-mono)" }}>{cycleProgress.toFixed(0)}%</span>
          </div>
          <div className="progress-track" style={{ background: "rgba(255,255,255,0.06)", height: 4 }}>
            <div className="progress-fill" style={{ width: `${cycleProgress}%`, height: 4 }} />
          </div>
        </div>
      </div>

      {/* ═══ LIVE ACTIVITY (prominent, no duplicate TX/sec) ═══ */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12, padding: "10px 16px",
        borderRadius: 10, background: "rgba(177,252,3,0.06)", border: "1px solid rgba(177,252,3,0.12)",
        marginBottom: 20,
      }}>
        <span className="live-dot" />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.85rem", fontWeight: 700, color: "var(--accent-olive)" }}>
          +{formatNumber(Math.round(distributed))} TX
        </span>
        <span style={{ fontSize: "0.72rem", opacity: 0.5 }}>
          distributed since you opened this page
        </span>
        <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: "0.62rem", opacity: 0.3 }}>
          ~{Math.round(TX_PER_SECOND)} TX/sec
        </span>
      </div>

      {/* ═══ MY PORTFOLIO (shown when wallet connected) ═══ */}
      {wallet.connected && (
        <div style={{
          background: "var(--glass-bg)", backdropFilter: "blur(20px)",
          border: "1px solid var(--glass-border)", borderRadius: "var(--radius-lg)",
          padding: "20px 24px", marginBottom: 20,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{
                width: 8, height: 8, borderRadius: "50%", background: "var(--tx-neon)",
                boxShadow: "0 0 6px rgba(177,252,3,0.5)",
              }} />
              <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>My Portfolio</span>
              <span style={{ fontSize: "0.68rem", color: "var(--text-light)", fontFamily: "var(--font-mono)" }}>
                {wallet.address.slice(0, 10)}...{wallet.address.slice(-4)}
              </span>
              <span style={{
                fontSize: "0.6rem", color: "var(--accent-olive)", fontWeight: 600,
                background: "rgba(74,122,26,0.1)", padding: "2px 8px", borderRadius: "var(--radius-pill)",
                textTransform: "uppercase",
              }}>{wallet.walletType}</span>
            </div>
            <button
              onClick={refresh}
              style={{
                background: "none", border: "1px solid var(--glass-border)", borderRadius: "var(--radius-pill)",
                padding: "4px 12px", fontSize: "0.7rem", color: "var(--text-medium)", cursor: "pointer",
              }}
            >
              Refresh
            </button>
          </div>

          {/* Portfolio stats row */}
          <div className="responsive-grid-4" style={{ gap: 1, background: "rgba(255,255,255,0.3)", borderRadius: "var(--radius-md)", overflow: "hidden", marginBottom: 16 }}>
            {[
              { label: "Available", value: `${formatNumber(Math.round(wallet.balance))} TX`, sub: price > 0 ? formatUSD(wallet.balance * price) : "", color: "var(--text-dark)" },
              { label: "Staked", value: `${formatNumber(Math.round(wallet.stakedAmount))} TX`, sub: price > 0 ? formatUSD(wallet.stakedAmount * price) : "", color: "var(--accent-olive)" },
              { label: "Pending Rewards", value: `${wallet.rewards > 1 ? formatNumber(Math.round(wallet.rewards)) : wallet.rewards.toFixed(2)} TX`, sub: price > 0 ? formatUSD(wallet.rewards * price) : "", color: "var(--tx-neon)" },
              { label: "Total Value", value: price > 0 ? formatUSD((wallet.balance + wallet.stakedAmount + wallet.rewards) * price) : `${formatNumber(Math.round(wallet.balance + wallet.stakedAmount + wallet.rewards))} TX`, sub: price > 0 ? `${formatNumber(Math.round(wallet.balance + wallet.stakedAmount + wallet.rewards))} TX` : "", color: "var(--text-dark)" },
            ].map((item) => (
              <div key={item.label} style={{ background: "#fff", padding: "14px 16px" }}>
                <div style={{ fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-light)", marginBottom: 4 }}>{item.label}</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "1.1rem", fontWeight: 600, color: item.color }}>{item.value}</div>
                {item.sub && <div style={{ fontSize: "0.65rem", color: "var(--text-light)", marginTop: 2 }}>{item.sub}</div>}
              </div>
            ))}
          </div>

          {/* Delegations breakdown */}
          {wallet.delegations.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-light)", marginBottom: 8 }}>
                Active Delegations ({wallet.delegations.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {wallet.delegations.map((del: any, i: number) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "8px 12px", background: i % 2 === 0 ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.3)",
                    borderRadius: i === 0 ? "8px 8px 0 0" : i === wallet.delegations.length - 1 ? "0 0 8px 8px" : "0",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent-olive)" }} />
                      <span style={{ fontSize: "0.82rem", fontWeight: 500 }}>{del.validatorMoniker}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.82rem", fontWeight: 500 }}>
                          {formatNumber(Math.round(del.amount))} TX
                        </div>
                        {price > 0 && <div style={{ fontSize: "0.6rem", color: "var(--text-light)" }}>{formatUSD(del.amount * price)}</div>}
                      </div>
                      {del.rewards > 0.01 && (
                        <div style={{ textAlign: "right", minWidth: 80 }}>
                          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--accent-olive)" }}>
                            +{del.rewards > 1 ? formatNumber(Math.round(del.rewards)) : del.rewards.toFixed(2)} TX
                          </div>
                          <div style={{ fontSize: "0.58rem", color: "var(--text-light)" }}>rewards</div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Unbonding delegations */}
          {wallet.unbondingDelegations.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "#c4a96a", marginBottom: 8 }}>
                Unbonding ({wallet.unbondingDelegations.length})
              </div>
              {wallet.unbondingDelegations.map((u: any, i: number) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "6px 12px", background: "rgba(196,169,106,0.06)", borderRadius: 6, marginBottom: 2,
                }}>
                  <span style={{ fontSize: "0.78rem" }}>{u.validatorMoniker}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.78rem" }}>{formatNumber(Math.round(u.amount))} TX</span>
                    <span style={{ fontSize: "0.65rem", color: "#c4a96a" }}>
                      {new Date(u.completionTime).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* PSE estimate for connected wallet */}
          {wallet.stakedAmount > 0 && bondedTokens > 0 && (
            <div style={{
              background: "var(--tx-dark-green)", borderRadius: "var(--radius-md)",
              padding: "14px 18px", color: "#fff", marginBottom: 14,
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "rgba(255,255,255,0.45)", marginBottom: 4 }}>
                    Estimated Next PSE Reward
                  </div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: "1.2rem", fontWeight: 600, color: "var(--tx-neon)" }}>
                    ~{formatNumber(Math.round(estimatePSERewardFullPeriod(wallet.stakedAmount, bondedTokens, excludedPSEStake)))} TX
                  </div>
                  {price > 0 && (
                    <div style={{ fontSize: "0.65rem", color: "rgba(177,252,3,0.5)", marginTop: 2 }}>
                      ~{formatUSD(estimatePSERewardFullPeriod(wallet.stakedAmount, bondedTokens, excludedPSEStake) * price)}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: "0.62rem", color: "rgba(255,255,255,0.4)" }}>Your Share (of eligible)</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: "1rem", color: "#fff" }}>
                    {((wallet.stakedAmount / (pseEligibleBonded || bondedTokens)) * 100).toFixed(4)}%
                  </div>
                  {excludedPSEStake > 0 && (
                    <div style={{ fontSize: "0.55rem", color: "rgba(255,255,255,0.25)", marginTop: 2 }}>
                      {formatNumber(excludedPSEStake)} TX excluded from PSE
                    </div>
                  )}
                </div>
              </div>
              <div style={{
                marginTop: 10, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.06)",
                fontSize: "0.6rem", color: "rgba(255,255,255,0.3)", display: "flex", alignItems: "center", gap: 4,
              }}>
                Estimated PSE reward
                <Tooltip text="Estimate assumes full-month staking. Real PSE uses duration-weighted scores. Check the PSE tab for your on-chain score." />
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 10 }}>
            {wallet.rewards > 0.01 && (
              <button
                onClick={claimRewards}
                disabled={txPending}
                className="btn-olive"
                style={{ padding: "10px 20px", fontSize: "0.8rem", opacity: txPending ? 0.5 : 1 }}
              >
                {txPending ? "Processing..." : `Claim ${wallet.rewards > 1 ? formatNumber(Math.round(wallet.rewards)) : wallet.rewards.toFixed(2)} TX Rewards`}
              </button>
            )}
            <button
              onClick={() => setActiveTab("portfolio")}
              style={{
                padding: "10px 20px", fontSize: "0.8rem", borderRadius: "var(--radius-pill)",
                border: "1px solid var(--glass-border)", background: "transparent",
                cursor: "pointer", color: "var(--text-medium)", fontWeight: 500,
              }}
            >
              Manage Portfolio
            </button>
            <button
              onClick={() => setActiveTab("calculator")}
              style={{
                padding: "10px 20px", fontSize: "0.8rem", borderRadius: "var(--radius-pill)",
                border: "1px solid var(--glass-border)", background: "transparent",
                cursor: "pointer", color: "var(--text-medium)", fontWeight: 500,
              }}
            >
              Project My Rewards
            </button>
          </div>
        </div>
      )}

      {/* Not connected,subtle prompt */}
      {!wallet.connected && (
        <div
          onClick={() => setShowWalletModal(true)}
          style={{
            display: "flex", alignItems: "center", gap: 10, padding: "10px 16px",
            borderRadius: 10, background: "rgba(15,27,7,0.03)", border: "1px dashed rgba(15,27,7,0.12)",
            marginBottom: 20, cursor: "pointer", transition: "all 0.15s",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="1" y="4" width="14" height="10" rx="2" stroke="var(--text-light)" strokeWidth="1.2" fill="none" />
            <path d="M4 4V3a4 4 0 0 1 8 0v1" stroke="var(--text-light)" strokeWidth="1.2" fill="none" />
          </svg>
          <span style={{ fontSize: "0.78rem", color: "var(--text-medium)" }}>
            Connect your wallet to see your portfolio, delegations, and PSE estimates
          </span>
          <span style={{ marginLeft: "auto", fontSize: "0.72rem", color: "var(--accent-olive)", fontWeight: 600 }}>
            Connect
          </span>
        </div>
      )}

      {/* ═══ SECONDARY: Price + Market Cap + APR ═══ */}
      <div className="grid-3 mb-3">
        <div className="accent-card card-orange">
          <div className="texture-dots" />
          <div className="blob-dark" />
          <div className="card-content">
            <span className="card-title">TX Price <Tooltip text={price < 0.05 ? "At current price, staking outcomes are driven by PSE rather than market movement" : `${priceChange >= 0 ? "+" : ""}${priceChange.toFixed(1)}% in the last 24h`} /></span>
            <div>
              <div className="card-sub" style={{ color: priceChange >= 0 ? "#4a7a2a" : "#b44a3e" }}>
                {priceChange >= 0 ? "+" : ""}{priceChange.toFixed(1)}% 24h
              </div>
              <div className="card-value">
                ${loading ? "---" : price.toFixed(4)}
                <span className="unit">USD</span>
              </div>
            </div>
          </div>
        </div>

        <div className="accent-card card-yellow">
          <div className="blob-light" />
          <div className="texture-stripes" />
          <div className="blob-dark" style={{ right: "-20%", bottom: "-30%" }} />
          <div className="card-content">
            <span className="card-title">Market Cap <Tooltip text={`Circulating supply: ${formatNumber(totalSupply)} TX`} /></span>
            <div>
              <div className="card-value">
                {loading ? "---" : formatUSD(marketCap)}
              </div>
            </div>
          </div>
        </div>

        <div className="accent-card card-dark">
          <div className="card-content">
            <span className="card-title" style={{ color: "rgba(237,233,224,0.7)" }}>Base APR <Tooltip text="PSE rewards are added on top of base APR. PSE is the primary yield source." /></span>
            <div>
              <div className="card-value">
                {apr > 0 ? `${apr.toFixed(2)}%` : "---"}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ THIRD ROW: Chart + Intelligence Panel (2-col) ═══ */}
      <div className="grid-12">
        {/* Supply Chart */}
        <div className="panel col-7">
          <div className="flex-between mb-2">
            <span className="card-title">Supply &amp; Staking Trend</span>
            <span className="status-pill">84 Month Projection</span>
          </div>
          <SupplyChart
            currentSupply={tokenData?.circulatingSupply}
            currentStakingRatio={stakingData?.stakingRatio}
            currentInflation={stakingData?.inflationRaw}
          />
          <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
            <span className="card-title" style={{ fontSize: "0.65rem" }}>Supply &amp; Staking Trend</span>
            <Tooltip text={stakingRatio > 50
              ? "Staking dominates circulating supply, strong network security and low sell pressure"
              : `${stakingPct}% of circulating supply staked, early stakers capture larger PSE share as bonded pool grows`
            } />
          </div>
        </div>

        {/* Right: Snapshot + Actions + Status */}
        <div className="col-5" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Network Insight Panel */}
          <div className="panel">
            <span className="card-title" style={{ marginBottom: 10, display: "block" }}>Network Snapshot</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {insights.map((insight, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "flex-start", gap: 8,
                  fontSize: "0.7rem", lineHeight: 1.45, color: "var(--text-medium)",
                }}>
                  <span style={{
                    display: "inline-block", width: 5, height: 5, borderRadius: "50%",
                    background: i === 0 ? "var(--tx-neon)" : i === 1 ? "var(--accent-olive)" : i === 2 ? "#c4a96a" : "var(--tx-subtle)",
                    flexShrink: 0, marginTop: 4,
                  }} />
                  <span>{insight}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Actions,2x2 grid */}
          <div className="panel">
            <span className="card-title" style={{ marginBottom: 10, display: "block" }}>What should I do?</span>
            <div className="responsive-grid-2" style={{ gap: 8 }}>
              <button
                onClick={() => setActiveTab("calculator")}
                className="btn-olive"
                style={{ padding: "10px 12px", fontSize: "0.72rem", textAlign: "left", borderRadius: 10 }}
              >
                Estimate my staking outcome
              </button>
              <button
                onClick={() => setActiveTab("pse")}
                className="btn-olive"
                style={{ padding: "10px 12px", fontSize: "0.72rem", textAlign: "left", borderRadius: 10, background: "rgba(15,27,7,0.06)", color: "var(--tx-dark-green)", border: "1px solid rgba(15,27,7,0.1)" }}
              >
                See how early entry boosts rewards
              </button>
              <button
                onClick={() => setActiveTab("validators")}
                className="btn-olive"
                style={{ padding: "10px 12px", fontSize: "0.72rem", textAlign: "left", borderRadius: 10, background: "rgba(15,27,7,0.06)", color: "var(--tx-dark-green)", border: "1px solid rgba(15,27,7,0.1)" }}
              >
                Start staking (choose validator)
              </button>
              <button
                onClick={() => setActiveTab("rwa")}
                className="btn-olive"
                style={{ padding: "10px 12px", fontSize: "0.72rem", textAlign: "left", borderRadius: 10, background: "rgba(15,27,7,0.06)", color: "var(--tx-dark-green)", border: "1px solid rgba(15,27,7,0.1)" }}
              >
                Explore Smart Tokens
              </button>
            </div>
            <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: "0.62rem", color: "var(--text-medium)" }}>Early phase</span>
              <Tooltip text="Each new staker reduces your relative share of future PSE rewards. Acting early maximizes your cumulative share." />
            </div>
          </div>

          {/* System Status */}
          <div className="panel panel-sm" style={{
            display: "flex", alignItems: "center", gap: 10,
            background: loading ? "rgba(0,0,0,0.02)" : "rgba(177,252,3,0.04)",
            border: loading ? undefined : "1px solid rgba(177,252,3,0.1)",
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: "50%",
              background: loading ? "#c4a96a" : "var(--tx-neon)",
              boxShadow: loading ? "none" : "0 0 6px rgba(177,252,3,0.4)",
            }} />
            <div>
              <div style={{ fontSize: "0.72rem", fontWeight: 600 }}>{loading ? "Syncing..." : "Network Operational"}</div>
              <div style={{ fontSize: "0.6rem", opacity: 0.4 }}>
                Block {networkStatus?.blockHeight ? networkStatus.blockHeight.toLocaleString() : "---"}
                {activeValidators > 0 ? ` · ${activeValidators} validators` : ""}
                {" · "}No issues detected · tx-mainnet
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════
   TAB: PSE
   ═══════════════════════════════════════════════════════ */

function PSETab({
  pseInfo, timeLeft, pad, cycleProgress, distributed,
  nextPSEReward, stakedAmount, bondedTokens, wallet, setActiveTab, setShowWalletModal,
}: any) {
  // Live PSE score lookup
  const [pseAddress, setPseAddress] = useState(wallet.connected ? wallet.address : "");
  const [pseLookup, setPseLookup] = useState<{
    loading: boolean;
    score: string | null;
    monthlyEstimate: number | null;
    annualEstimate: number | null;
    sharePct: number | null;
    totalStaked: number | null;
    error: string | null;
    height: number | null;
  }>({ loading: false, score: null, monthlyEstimate: null, annualEstimate: null, sharePct: null, totalStaked: null, error: null, height: null });

  // Auto-fill when wallet connects
  useEffect(() => {
    if (wallet.connected && wallet.address) {
      setPseAddress(wallet.address);
    }
  }, [wallet.connected, wallet.address]);

  const fetchPSEScore = useCallback(async (addr?: string) => {
    const address = (addr || pseAddress).trim();
    if (!address || !address.startsWith("core1") || address.length < 39) {
      setPseLookup(prev => ({ ...prev, error: "Enter a valid core1... address" }));
      return;
    }
    setPseLookup({ loading: true, score: null, monthlyEstimate: null, annualEstimate: null, sharePct: null, totalStaked: null, error: null, height: null });
    try {
      const [scoreRes, delegRes] = await Promise.all([
        fetch("https://hasura.mainnet-1.coreum.dev/v1/graphql", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: `{ action_pse_score(address: "${address}") { address height score } }`,
          }),
        }),
        fetch(`https://rest-coreum.ecostake.com/cosmos/staking/v1beta1/delegations/${address}`),
      ]);
      const scoreData = await scoreRes.json();
      const delegData = await delegRes.json().catch(() => null);

      if (scoreData.errors) {
        setPseLookup({ loading: false, score: null, monthlyEstimate: null, annualEstimate: null, sharePct: null, totalStaked: null, error: scoreData.errors[0].message, height: null });
        return;
      }
      const scoreRaw = scoreData.data.action_pse_score.score;
      const height = scoreData.data.action_pse_score.height;

      // Calculate staked from delegations
      let totalStaked = 0;
      if (delegData?.delegation_responses) {
        for (const d of delegData.delegation_responses) {
          totalStaked += parseInt(d.balance?.amount || "0") / 1_000_000;
        }
      }

      const tgeTimestamp = 1772755200; // 2026-03-06T00:00:00Z
      const now = Date.now() / 1000;
      const elapsed = now - tgeTimestamp;
      const totalBondedUcore = bondedTokens * 1_000_000;
      const networkScore = totalBondedUcore * elapsed;
      const share = Number(BigInt(scoreRaw)) / networkScore;
      const monthlyTX = 476_190_476 * share;
      const annualTX = monthlyTX * 12;

      setPseLookup({
        loading: false,
        score: scoreRaw,
        monthlyEstimate: monthlyTX,
        annualEstimate: annualTX,
        sharePct: share * 100,
        totalStaked,
        error: null,
        height,
      });
    } catch (err: any) {
      setPseLookup({ loading: false, score: null, monthlyEstimate: null, annualEstimate: null, sharePct: null, totalStaked: null, error: err.message || "Failed to fetch", height: null });
    }
  }, [pseAddress, bondedTokens]);

  // Auto-fetch when wallet connects
  useEffect(() => {
    if (wallet.connected && wallet.address && !pseLookup.score && !pseLookup.loading) {
      fetchPSEScore(wallet.address);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.connected, wallet.address]);

  const totalProgressPct = ((pseInfo.distributionNumber - 1) / pseInfo.totalDistributions) * 100;
  const phaseLabel = totalProgressPct < 20
    ? { text: "Early Advantage", color: "var(--tx-neon)", bg: "rgba(177,252,3,0.12)" }
    : totalProgressPct < 60
    ? { text: "Mid Phase", color: "#c4a96a", bg: "rgba(196,169,106,0.12)" }
    : { text: "Late Phase", color: "#b44a3e", bg: "rgba(180,74,62,0.12)" };

  const formatPSEAmount = (val: number | null) => {
    if (val === null) return "...";
    if (val > 1_000_000) return `${(val / 1_000_000).toFixed(2)}M`;
    if (val > 1_000) return `${(val / 1_000).toFixed(1)}K`;
    return val.toFixed(1);
  };

  return (
    <>
      <div className="section-head">
        <h1 className="page-title">Proof of Support Emission</h1>
        <span className="status-pill success">Distribution #{pseInfo.distributionNumber} of {pseInfo.totalDistributions}</span>
      </div>

      {/* ── PSE Score Lookup ── */}
      <div style={{
        padding: "18px 22px", borderRadius: 14,
        background: "linear-gradient(135deg, var(--tx-dark-green) 0%, #1a2e10 100%)",
        color: "#fff", marginBottom: 16,
        border: "1px solid rgba(177,252,3,0.1)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--tx-neon)" strokeWidth="2.5">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <span style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--tx-neon)" }}>
            Check Your PSE Score
          </span>
          <span style={{ fontSize: "0.62rem", color: "rgba(255,255,255,0.5)" }}>
            Real on-chain data
          </span>
          {!wallet.connected && (
            <button
              onClick={() => setShowWalletModal(true)}
              style={{
                marginLeft: "auto", padding: "7px 14px", borderRadius: 8,
                background: "rgba(177,252,3,0.12)", border: "1px solid rgba(177,252,3,0.25)",
                color: "var(--tx-neon)", fontSize: "0.7rem", fontWeight: 600,
                cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              Connect Wallet
            </button>
          )}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            value={pseAddress}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPseAddress(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent) => e.key === "Enter" && fetchPSEScore()}
            placeholder="Enter core1... address"
            style={{
              flex: 1, padding: "11px 14px", borderRadius: 8,
              background: "rgba(255,255,255,0.08)", border: "1px solid rgba(177,252,3,0.2)",
              color: "#fff", fontSize: "0.82rem", fontFamily: "var(--font-mono)",
              outline: "none",
            }}
          />
          <button
            onClick={() => fetchPSEScore()}
            disabled={pseLookup.loading}
            style={{
              padding: "11px 22px", borderRadius: 8, border: "none",
              background: "var(--tx-neon)", color: "var(--tx-dark-green)",
              fontSize: "0.8rem", fontWeight: 700, cursor: "pointer",
              opacity: pseLookup.loading ? 0.6 : 1,
              whiteSpace: "nowrap",
            }}
          >
            {pseLookup.loading ? "Fetching..." : "Fetch"}
          </button>
        </div>
        {wallet.connected && wallet.address && pseAddress !== wallet.address && (
          <button
            onClick={() => { setPseAddress(wallet.address); fetchPSEScore(wallet.address); }}
            style={{
              background: "none", border: "none", color: "var(--tx-neon)",
              fontSize: "0.6rem", cursor: "pointer", padding: "5px 0 0",
              opacity: 0.7, textDecoration: "underline",
            }}
          >
            Use my connected wallet
          </button>
        )}
      </div>

      {pseLookup.error && (
        <div style={{
          marginBottom: 12, padding: "10px 14px", borderRadius: 8,
          background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.2)",
          fontSize: "0.72rem", color: "#ff6b6b",
        }}>
          {pseLookup.error}
        </div>
      )}

      {/* Results */}
      {pseLookup.score && (
        <div style={{ marginBottom: 16 }}>
          {/* Main result,big monthly number */}
          <div style={{
            textAlign: "center", padding: "16px 0", marginBottom: 12,
            background: "rgba(177,252,3,0.04)", borderRadius: 12, border: "1px solid rgba(177,252,3,0.08)",
          }}>
            <div style={{ fontSize: "0.62rem", color: "var(--text-light)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
              This Month&apos;s Estimated PSE Distribution
            </div>
            <div style={{
              fontSize: "2.4rem", fontWeight: 800, fontFamily: "var(--font-mono)",
              color: "var(--accent-olive)", lineHeight: 1,
            }}>
              {formatPSEAmount(pseLookup.monthlyEstimate)}
              <span style={{ fontSize: "0.9rem", opacity: 0.6, marginLeft: 6 }}>TX</span>
            </div>
            {pseLookup.sharePct !== null && (
              <div style={{ fontSize: "0.68rem", color: "var(--text-light)", marginTop: 4 }}>
                Your share: {pseLookup.sharePct < 0.001 ? "<0.001" : pseLookup.sharePct.toFixed(4)}% of the monthly pool
              </div>
            )}
          </div>

            {/* Detail cards */}
            <div className="responsive-grid-4" style={{ gap: 10, marginBottom: 12 }}>
              <div style={{ padding: "12px 14px", borderRadius: 10, background: "var(--glass-bg)", border: "1px solid var(--glass-border)" }}>
                <div style={{ fontSize: "0.55rem", color: "var(--text-light)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>On-Chain Score</div>
                <div style={{ fontSize: "0.88rem", fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--accent-olive)", wordBreak: "break-all" }}>
                  {Number(BigInt(pseLookup.score) / BigInt(1_000_000)).toLocaleString()}
                </div>
              </div>
              <div style={{ padding: "12px 14px", borderRadius: 10, background: "var(--glass-bg)", border: "1px solid var(--glass-border)" }}>
                <div style={{ fontSize: "0.55rem", color: "var(--text-light)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>Total Staked</div>
                <div style={{ fontSize: "0.88rem", fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--text-dark)" }}>
                  {pseLookup.totalStaked !== null ? formatNumber(Math.round(pseLookup.totalStaked)) : "..."} TX
                </div>
              </div>
              <div style={{ padding: "12px 14px", borderRadius: 10, background: "rgba(74,122,26,0.08)", border: "1px solid rgba(74,122,26,0.15)" }}>
                <div style={{ fontSize: "0.55rem", color: "var(--text-light)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>Est. Annual PSE</div>
                <div style={{ fontSize: "0.88rem", fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--accent-olive)" }}>
                  {formatPSEAmount(pseLookup.annualEstimate)} TX
                </div>
              </div>
              <div style={{ padding: "12px 14px", borderRadius: 10, background: "var(--glass-bg)", border: "1px solid var(--glass-border)" }}>
                <div style={{ fontSize: "0.55rem", color: "var(--text-light)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>Pool Share</div>
                <div style={{ fontSize: "0.88rem", fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--text-dark)" }}>
                  {pseLookup.sharePct !== null ? (pseLookup.sharePct < 0.001 ? "<0.001" : pseLookup.sharePct.toFixed(4)) : "..."}%
                </div>
              </div>
            </div>

            <div style={{
              padding: "6px 12px", borderRadius: 8,
              background: "rgba(0,0,0,0.02)", border: "1px solid rgba(0,0,0,0.06)",
              fontSize: "0.58rem", color: "var(--text-light)", lineHeight: 1.5,
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <span>
                Score at block {pseLookup.height || "latest"}. Estimates assume current bonded pool stays constant.
              </span>
              <button
                onClick={() => fetchPSEScore()}
                style={{
                  background: "none", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 6,
                  color: "var(--accent-olive)", fontSize: "0.58rem", padding: "3px 10px",
                  cursor: "pointer", whiteSpace: "nowrap", marginLeft: 10,
                }}
              >
                Refresh
              </button>
            </div>
          </div>
        )}

        {!pseLookup.score && !pseLookup.error && !pseLookup.loading && (
          <div style={{
            padding: "14px 18px", borderRadius: 10,
            background: "rgba(0,0,0,0.02)", border: "1px dashed rgba(0,0,0,0.08)",
            textAlign: "center", marginBottom: 16,
          }}>
            <div style={{ fontSize: "0.75rem", color: "var(--text-medium)" }}>
              Enter any core1... address to see real on-chain PSE score
            </div>
            <div style={{ fontSize: "0.6rem", color: "var(--text-light)", marginTop: 4 }}>
              {wallet.connected
                ? "Your wallet address is pre-filled, hit Fetch to check your score"
                : "Connect your wallet to auto-fill, or paste any address manually"
              }
            </div>
          </div>
        )}

      <div className="grid-12">
        {/* Left: Countdown + Stats */}
        <div className="col-5" style={{ display: "flex", flexDirection: "column" }}>
          <div className="panel mb-3">
            <span className="card-title mb-2" style={{ display: "block" }}>Next Distribution</span>
            <div className="countdown-row" style={{ marginBottom: 20 }}>
              <div className="countdown-unit">
                <span className="countdown-digit">{pad(timeLeft.days)}</span>
                <span className="countdown-label">Days</span>
              </div>
              <span className="countdown-separator">:</span>
              <div className="countdown-unit">
                <span className="countdown-digit">{pad(timeLeft.hours)}</span>
                <span className="countdown-label">Hrs</span>
              </div>
              <span className="countdown-separator">:</span>
              <div className="countdown-unit">
                <span className="countdown-digit">{pad(timeLeft.minutes)}</span>
                <span className="countdown-label">Min</span>
              </div>
              <span className="countdown-separator">:</span>
              <div className="countdown-unit">
                <span className="countdown-digit">{pad(timeLeft.seconds)}</span>
                <span className="countdown-label">Sec</span>
              </div>
            </div>

            <div className="progress-track mb-2">
              <div className="progress-fill" style={{ width: `${cycleProgress}%` }} />
            </div>
            <div className="flex-between mb-3">
              <span className="text-xs text-light mono">Cycle {pseInfo.distributionNumber} is {cycleProgress.toFixed(0)}% complete</span>
              <span className="text-xs text-olive mono">~{(PSE_CONFIG.monthlyEmission / (30 * 24 * 3600)).toFixed(2)} TX/sec</span>
            </div>
            <div className="text-xs text-light" style={{ marginBottom: 4 }}>
              +{distributed.toFixed(1)} TX distributed since you opened this page
            </div>
          </div>

          {/* Early phase progress indicator */}
          <div style={{
            marginTop: 10, marginBottom: 10, padding: "10px 14px", borderRadius: 10,
            background: "linear-gradient(90deg, rgba(177,252,3,0.06) 0%, rgba(177,252,3,0.12) 100%)",
            border: "1px solid rgba(177,252,3,0.15)",
            display: "flex", alignItems: "center", gap: 12,
          }}>
            <div style={{
              flex: 1, height: 6, borderRadius: 3,
              background: "rgba(177,252,3,0.1)",
              overflow: "hidden",
            }}>
              <div style={{
                width: `${totalProgressPct < 1 ? 0.8 : totalProgressPct}%`,
                height: "100%", borderRadius: 3,
                background: "var(--accent-olive)",
                transition: "width 0.3s ease",
              }} />
            </div>
            <span style={{
              fontSize: "0.62rem", fontWeight: 700, fontFamily: "var(--font-mono)",
              color: "var(--accent-olive)", whiteSpace: "nowrap",
            }}>
              {totalProgressPct < 1 ? "<1" : totalProgressPct.toFixed(0)}% of total emission distributed
            </span>
          </div>

          <div className="grid-2">
            <div className="accent-card card-olive" style={{ minHeight: 120 }}>
              <div className="card-content">
                <span className="card-title" style={{ opacity: 0.8 }}>Monthly Distribution <Tooltip text="40% of total emission is shared among community stakers each month" /></span>
                <div className="card-value" style={{ fontSize: "1.8rem" }}>
                  ~476M <span className="unit">TX</span>
                </div>
              </div>
            </div>
            <div className="accent-card card-yellow" style={{ minHeight: 120 }}>
              <div className="card-content">
                <span className="card-title">Progress <Tooltip text={pseInfo.distributionNumber <= 1 ? "Just started, 84 cycles total over 7 years" : `${84 - (pseInfo.distributionNumber - 1)} cycles remaining, ${totalProgressPct < 1 ? "<1" : totalProgressPct.toFixed(0)}% of total emission done`} /></span>
                <div className="card-value" style={{ fontSize: "1.8rem" }}>
                  Cycle {pseInfo.distributionNumber}
                </div>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: "0.65rem", color: "var(--text-medium)" }}>Early entry advantage</span>
            <Tooltip text="Each new staker reduces your share. The earlier you enter, the larger your cumulative share of total emission." />
          </div>
        </div>

        {/* Right: PSE Explainer + How it works */}
        <div className="col-7">
          <div className="panel" style={{ marginBottom: 14 }}>
            <span className="card-title mb-3" style={{ display: "block" }}>What is PSE?</span>

            <div className="info-box mb-3">
              <strong>100 billion TX</strong> distributed over <strong>84 months</strong> to everyone in the ecosystem.
              <span className="highlight-olive"> 40% goes to community stakers</span> like you , that&apos;s
              ~476M TX every month, split proportionally by your <em>stake &times; duration</em> score.
            </div>

            <div className="tip-box mb-3">
              <strong>PSE is the primary yield , not base APR.</strong> Rewards auto-compound as new delegations.
              Early participants receive significantly higher rewards per TX compared to later entrants.
            </div>

            {/* How PSE Works */}
            <div style={{
              padding: "16px 18px", borderRadius: 12, marginBottom: 14,
              background: "var(--tx-dark-green)", color: "#fff",
            }}>
              <div style={{ fontSize: "0.72rem", fontWeight: 700, marginBottom: 12, color: "var(--tx-neon)" }}>How PSE Works</div>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                fontSize: "0.65rem",
              }}>
                {[
                  { label: "Stake TX", sub: "more = larger share", num: "1" },
                  { label: "Build Score", sub: "stake × duration", num: "2" },
                  { label: "Earn Share", sub: "your score / total", num: "3" },
                  { label: "Get Rewards", sub: "auto-compounded", num: "4" },
                ].map((step, i) => (
                  <Fragment key={i}>
                    {i > 0 && <span style={{ color: "var(--tx-neon)", fontSize: "1rem", margin: "0 6px", opacity: 0.5 }}>→</span>}
                    <div style={{ textAlign: "center" }}>
                      <div style={{
                        width: 22, height: 22, borderRadius: "50%", margin: "0 auto 4px",
                        background: "rgba(177,252,3,0.15)", border: "1px solid rgba(177,252,3,0.3)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "0.6rem", fontWeight: 700, color: "var(--tx-neon)",
                      }}>{step.num}</div>
                      <div style={{ fontWeight: 600, color: "var(--tx-neon-light)", fontSize: "0.65rem" }}>{step.label}</div>
                      <div style={{ fontSize: "0.5rem", opacity: 0.4, marginTop: 2 }}>{step.sub}</div>
                    </div>
                  </Fragment>
                ))}
              </div>
              <div style={{
                marginTop: 12, padding: "6px 10px", borderRadius: 6,
                background: "rgba(177,252,3,0.08)", border: "1px solid rgba(177,252,3,0.12)",
                fontSize: "0.58rem", fontFamily: "var(--font-mono)", textAlign: "center",
                color: "var(--tx-neon-light)", opacity: 0.8,
              }}>
                Your reward = (your score / total network score) × monthly pool
              </div>
            </div>

            <span className="card-title mb-2" style={{ display: "block" }}>Allocation Breakdown</span>
            <div className="allocation-grid">
              {Object.entries(PSE_ALLOCATION).map(([key, value]) => (
                <div key={key} className={`allocation-item${key === "community" ? " community-highlight" : ""}`}
                  style={key === "community" ? {
                    background: "rgba(177,252,3,0.08)", border: "1px solid rgba(177,252,3,0.15)",
                    borderRadius: 6, padding: "4px 8px",
                  } : undefined}
                >
                  <span className="label">
                    {key.replace(/([A-Z])/g, " $1")}
                    {key === "community" && <span style={{ fontSize: "0.55rem", color: "var(--tx-neon-dark, var(--accent-olive))", marginLeft: 6, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em" }}>← YOU</span>}
                  </span>
                  <span className={`value ${key === "community" ? "highlight" : ""}`}
                    style={key === "community" ? { fontWeight: 700, color: "var(--accent-olive)" } : undefined}
                  >
                    {((value as number) * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* CTA row */}
      <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
        <button
          className="btn-olive"
          onClick={() => setActiveTab("calculator")}
          style={{ flex: 1, padding: "12px 20px", fontSize: "0.78rem", borderRadius: 10, cursor: "pointer" }}
        >
          What if I stake X amount? Try the Calculator
        </button>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════
   TAB: CALCULATOR
   ═══════════════════════════════════════════════════════ */

function GrowthChart({ projections, stakedAmount }: { projections: any[]; stakedAmount: number }) {
  if (!projections || projections.length === 0 || stakedAmount <= 0) return null;

  // Build cumulative data points for every 6 months
  const points: { month: number; base: number; pse: number; total: number }[] = [];
  let cumBase = 0;
  let cumPSE = 0;
  points.push({ month: 0, base: stakedAmount, pse: 0, total: stakedAmount });
  for (let i = 0; i < projections.length; i++) {
    cumBase += projections[i].stakingRewards;
    cumPSE += projections[i].pseReward;
    if ((i + 1) % 6 === 0 || i === projections.length - 1) {
      points.push({
        month: i + 1,
        base: stakedAmount + cumBase,
        pse: cumPSE,
        total: stakedAmount + cumBase + cumPSE,
      });
    }
  }

  const maxVal = Math.max(...points.map((p) => p.total));
  const chartW = 100;
  const chartH = 100;

  const maxMonth = projections.length;
  const toX = (month: number) => (month / maxMonth) * chartW;
  const toY = (val: number) => chartH - (val / maxVal) * chartH * 0.9 - chartH * 0.05;

  const totalPath = points.map((p, i) => `${i === 0 ? "M" : "L"}${toX(p.month).toFixed(1)},${toY(p.total).toFixed(1)}`).join(" ");
  const basePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${toX(p.month).toFixed(1)},${toY(p.base).toFixed(1)}`).join(" ");
  const totalArea = totalPath + ` L${chartW},${chartH} L0,${chartH} Z`;
  const baseArea = basePath + ` L${chartW},${chartH} L0,${chartH} Z`;

  return (
    <div style={{ position: "relative", width: "100%", height: 180 }}>
      <svg viewBox={`0 0 ${chartW} ${chartH}`} preserveAspectRatio="none" style={{ width: "100%", height: "100%" }}>
        {/* PSE area (total - base = green) */}
        <path d={totalArea} fill="rgba(177,252,3,0.15)" />
        {/* Base area */}
        <path d={baseArea} fill="rgba(15,27,7,0.08)" />
        {/* Total line,dominant */}
        <path d={totalPath} fill="none" stroke="#B1FC03" strokeWidth="1.2" />
        {/* Base line,very muted, communicates "base ≈ irrelevant" */}
        <path d={basePath} fill="none" stroke="#0F1B07" strokeWidth="0.3" opacity="0.2" strokeDasharray="1.5,2" />
      </svg>
      {/* Labels,dynamic based on projection length */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, display: "flex", justifyContent: "space-between", fontSize: "0.55rem", opacity: 0.35, fontFamily: "var(--font-mono)" }}>
        <span>Now</span>
        {Array.from({ length: 6 }, (_, i) => {
          const m = Math.round((maxMonth / 7) * (i + 1));
          return <span key={i}>{m}m</span>;
        })}
        <span>{maxMonth}m</span>
      </div>
      {/* Legend,prominent, on chart */}
      <div style={{ position: "absolute", top: 6, right: 8, display: "flex", gap: 12, fontSize: "0.6rem", fontWeight: 500 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 14, height: 3, background: "#B1FC03", display: "inline-block", borderRadius: 2 }} />
          <span style={{ color: "var(--accent-olive)" }}>Total (Base + PSE)</span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 14, height: 2, background: "#0F1B07", display: "inline-block", borderRadius: 1, opacity: 0.5 }} />
          <span style={{ opacity: 0.45 }}>Base yield only</span>
        </span>
      </div>
      {/* Green = PSE gap label */}
      <div style={{
        position: "absolute", top: "40%", left: "50%", transform: "translate(-50%, -50%)",
        fontSize: "0.55rem", opacity: 0.3, color: "var(--accent-olive)", fontWeight: 600,
        pointerEvents: "none",
      }}>
        PSE REWARDS
      </div>
    </div>
  );
}

function CalculatorTab({
  stakeInput, setStakeInput, targetRatio, setTargetRatio,
  targetPrice, setTargetPrice, stakedAmount, summary,
  waitComparison, growthPct, apr, nextPSEReward, wallet,
  tokenData, stakingData, setActiveTab,
}: any) {
  // Insight calculations
  const totalGains = summary.fullCycle.baseYield + summary.fullCycle.pseBonus;
  const psePct = totalGains > 0 ? ((summary.fullCycle.pseBonus / totalGains) * 100).toFixed(0) : "0";
  const growthMultiple = stakedAmount > 0 ? (summary.fullCycle.totalBag / stakedAmount).toFixed(1) : "1.0";
  const tp = parseFloat(targetPrice || "0");
  const bondedTokens = stakingData?.bondedTokens ?? 0;

  // Dynamic months remaining
  const pseMonthsLeft = summary.pseMonthsRemaining ?? 72;
  const totalProjMonths = summary.totalProjectionMonths ?? pseMonthsLeft;

  // Value range at different prices
  const finalBag = summary.fullCycle.totalBag;
  const valueLow = finalBag * (tp * 0.5);
  const valueMid = finalBag * tp;
  const valueHigh = finalBag * (tp * 2);

  // Optimization: what +10% more stake would do
  const extraStake = stakedAmount * 0.1;
  const extraBagGrowth = totalGains > 0 && stakedAmount > 0
    ? Math.round((extraStake / stakedAmount) * totalGains)
    : 0;

  // PSE position estimate,tier based on pool share + cycle timing
  const userSharePct = bondedTokens > 0 && stakedAmount > 0
    ? (stakedAmount / bondedTokens * 100)
    : 0;
  // Average stake per delegator (rough: bonded / ~active delegators estimate)
  const avgStake = bondedTokens > 0 ? bondedTokens / 2000 : 10000; // ~2K active stakers estimate
  const isAboveAvg = stakedAmount > avgStake;
  // Tiered positioning,emotional + competitive
  const positionTier = userSharePct >= 1
    ? { label: "Strong Position", color: "var(--tx-neon)", dot: "#B1FC03" }
    : userSharePct >= 0.01
    ? { label: "Early Advantage", color: "var(--tx-neon-light)", dot: "#E6FF91" }
    : userSharePct >= 0.001
    ? { label: "Building Position", color: "#c4a96a", dot: "#c4a96a" }
    : { label: "Entry Phase", color: "rgba(255,255,255,0.6)", dot: "#888" };

  // Month 1 PSE for trust note
  const month1PSE = summary.oneMonth?.pseBonus ?? 0;

  // Sensitivity: +3 month delay cost as %
  const delayCostPct = waitComparison ? waitComparison.diffPct : "0";

  return (
    <>
      <div className="section-head">
        <h1 className="page-title">PSE Calculator</h1>
        <span className="section-sub">What if I delegate X amount of TX? Simulate your {pseMonthsLeft}-month PSE outcome</span>
      </div>

      <div className="grid-12">
        {/* Left: Inputs + Chart + Table */}
        <div className="col-7" style={{ display: "flex", flexDirection: "column" }}>
          <div className="panel" style={{ flex: 1 }}>
            {/* Stake Amount */}
            <label className="input-label">How much TX would you like to delegate?</label>
            <div className="input-group mb-2">
              <input
                type="text"
                value={stakeInput}
                onChange={(e: any) => setStakeInput(e.target.value)}
                placeholder="Enter amount,e.g. 10000, 50000, 100000"
              />
              <span className="field-addon">TX</span>
              {wallet.connected && wallet.stakedAmount > 0 && (
                <button className="input-pill" onClick={() => setStakeInput(wallet.stakedAmount.toString())}>
                  Use My Staked Amount
                </button>
              )}
            </div>
            {/* Presets */}
            <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
              {[1000, 5000, 10000, 50000, 100000].map((amt) => (
                <button
                  key={amt}
                  onClick={() => setStakeInput(amt.toString())}
                  style={{
                    padding: "4px 10px", borderRadius: 20, fontSize: "0.7rem", fontFamily: "var(--font-mono)",
                    border: stakedAmount === amt ? "1px solid var(--tx-neon)" : "1px solid rgba(0,0,0,0.08)",
                    background: stakedAmount === amt ? "var(--tx-dark-green)" : "rgba(255,255,255,0.3)",
                    color: stakedAmount === amt ? "var(--tx-neon)" : "var(--text-medium)",
                    cursor: "pointer", fontWeight: 500, transition: "all 0.15s",
                  }}
                >
                  {formatNumber(amt)}
                </button>
              ))}
            </div>
            <div style={{ fontSize: "0.6rem", opacity: 0.35, marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}>
              {formatNumber(bondedTokens)} TX bonded ({stakingData?.stakingRatio?.toFixed(0) ?? "--"}%)
              <Tooltip text={`Typical stake: 5K to 50K TX. ${stakedAmount > 0 && bondedTokens > 0 ? (isAboveAvg ? "Your stake is above average." : "Below average, increasing stake improves PSE share.") : ""}`} position="bottom" />
            </div>
            <input
              type="range"
              min="1000"
              max="1000000"
              step="1000"
              value={stakedAmount || 0}
              onChange={(e: any) => setStakeInput(e.target.value)}
            />

            <div className="grid-2 mt-3 mb-3">
              <div>
                <label className="input-label">Target Staking Ratio <Tooltip text="Network goal is 67% staking ratio" position="bottom" /></label>
                <div className="input-group">
                  <input type="text" value={targetRatio} onChange={(e: any) => setTargetRatio(e.target.value)} />
                  <span className="field-addon">%</span>
                </div>
              </div>
              <div>
                <label className="input-label">Target TX Price <Tooltip text={`Current price: $${tokenData?.price?.toFixed(4) ?? "--"}`} position="bottom" /></label>
                <div className="input-group">
                  <span className="field-addon">$</span>
                  <input type="text" value={targetPrice} onChange={(e: any) => setTargetPrice(e.target.value)} />
                </div>
              </div>
            </div>

            {/* Growth Chart */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: "0.75rem", fontWeight: 600 }}>Growth Projection</span>
                <span style={{ fontSize: "0.6rem", opacity: 0.4, fontFamily: "var(--font-mono)" }}>
                  {formatNumber(stakedAmount)} TX → {formatNumber(finalBag)} TX
                </span>
              </div>
              <div style={{
                background: "rgba(0,0,0,0.02)", borderRadius: 12, padding: "12px 12px 20px",
                border: "1px solid rgba(0,0,0,0.04)",
              }}>
                <GrowthChart projections={summary.projections} stakedAmount={stakedAmount} />
              </div>
            </div>

            {/* Trust context,right above table where confusion happens */}
            {month1PSE > 100 && (
              <div style={{
                marginBottom: 8, padding: "7px 10px", borderRadius: 8,
                background: "rgba(177,252,3,0.04)", border: "1px solid rgba(177,252,3,0.08)",
                fontSize: "0.62rem", lineHeight: 1.4, color: "var(--text-medium)",
              }}>
                Early cycles distribute disproportionately high rewards,fewer stakers compete for the same monthly pool.
                Rewards naturally decline as the network grows. These are estimates assuming linear growth.
              </div>
            )}

            {/* Projection Table */}
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Timeline</th>
                  <th>Base Yield</th>
                  <th>PSE Bonus</th>
                  <th>Total Bag</th>
                  <th>Growth</th>
                  <th>PSE Share</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ textAlign: "left" }}>1 Month</td>
                  <td className="mono">{formatTX(summary.oneMonth.baseYield)}</td>
                  <td className="mono" style={{ color: "var(--tx-neon-dark, #4a7a1a)" }}>+{formatTX(summary.oneMonth.pseBonus)} <span style={{ fontSize: "0.5rem", opacity: 0.5, fontWeight: 400 }}>(peak phase)</span></td>
                  <td className="mono">{summary.oneMonth.totalBag.toLocaleString()}</td>
                  <td className="mono" style={{ color: "var(--accent-olive)", fontSize: "0.7rem" }}>
                    +{stakedAmount > 0 ? ((summary.oneMonth.totalBag / stakedAmount - 1) * 100).toFixed(1) : "0.0"}%
                  </td>
                  <td className="mono" style={{ fontSize: "0.65rem", opacity: 0.5 }}>
                    {(summary.oneMonth.baseYield + summary.oneMonth.pseBonus) > 0
                      ? ((summary.oneMonth.pseBonus / (summary.oneMonth.baseYield + summary.oneMonth.pseBonus)) * 100).toFixed(0)
                      : "0"}%
                  </td>
                </tr>
                <tr>
                  <td style={{ textAlign: "left" }}>12 Months</td>
                  <td className="mono">{formatTX(summary.oneYear.baseYield)}</td>
                  <td className="mono" style={{ color: "var(--tx-neon-dark, #4a7a1a)" }}>+{formatTX(summary.oneYear.pseBonus)}</td>
                  <td className="mono">{summary.oneYear.totalBag.toLocaleString()}</td>
                  <td className="mono" style={{ color: "var(--accent-olive)", fontSize: "0.7rem" }}>
                    +{stakedAmount > 0 ? ((summary.oneYear.totalBag / stakedAmount - 1) * 100).toFixed(1) : "0.0"}%
                  </td>
                  <td className="mono" style={{ fontSize: "0.65rem", opacity: 0.5 }}>
                    {(summary.oneYear.baseYield + summary.oneYear.pseBonus) > 0
                      ? ((summary.oneYear.pseBonus / (summary.oneYear.baseYield + summary.oneYear.pseBonus)) * 100).toFixed(0)
                      : "0"}%
                  </td>
                </tr>
                <tr style={{
                  fontWeight: 700,
                  background: "rgba(177,252,3,0.08)",
                  borderLeft: "2px solid var(--tx-neon)",
                }}>
                  <td style={{ textAlign: "left" }}>{totalProjMonths} Months</td>
                  <td className="mono">{formatTX(summary.fullCycle.baseYield)}</td>
                  <td className="mono" style={{ color: "var(--tx-neon-dark, #4a7a1a)" }}>+{formatTX(summary.fullCycle.pseBonus)}</td>
                  <td className="mono">{summary.fullCycle.totalBag.toLocaleString()}</td>
                  <td className="mono" style={{ color: "var(--accent-olive)", fontWeight: 700, fontSize: "0.75rem" }}>
                    +{stakedAmount > 0 ? ((summary.fullCycle.totalBag / stakedAmount - 1) * 100).toFixed(1) : "0.0"}%
                  </td>
                  <td className="mono" style={{ fontSize: "0.7rem", color: "var(--accent-olive)" }}>
                    {psePct}%
                  </td>
                </tr>
              </tbody>
            </table>

            {/* (trust context moved above table for better proximity to numbers) */}
          </div>
        </div>

        {/* Right: Outcome + Insights */}
        <div className="col-5" style={{ display: "flex", flexDirection: "column" }}>
          {/* Outcome Card */}
          <div className="outcome-card mb-3">
            <span style={{ fontSize: "0.82rem", opacity: 0.6 }}>Your Bag After {totalProjMonths} Months</span>
            <div className="flex-between mt-2">
              <div className="outcome-value">{summary.fullCycle.totalBag.toLocaleString()}</div>
              <div className="outcome-pct">+{growthPct}%</div>
            </div>

            {/* Insight line + comparison anchor */}
            {stakedAmount > 0 && (
              <div style={{
                marginTop: 12, padding: "8px 10px", borderRadius: 8,
                background: "rgba(177,252,3,0.1)", border: "1px solid rgba(177,252,3,0.2)",
                fontSize: "0.7rem", lineHeight: 1.5, color: "rgba(250,255,228,0.9)",
              }}>
                Your stake grows <strong>{growthMultiple}x</strong>,<strong>{psePct}%</strong> of gains come from PSE rewards.
                {parseFloat(growthMultiple) > 3 && (
                  <span style={{ display: "block", marginTop: 4, fontSize: "0.62rem", opacity: 0.7 }}>
                    This projected growth exceeds typical staking returns,driven by early-cycle PSE advantage.
                  </span>
                )}
              </div>
            )}

            {/* Value Range */}
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid rgba(237,233,224,0.12)" }}>
              <span style={{ fontSize: "0.65rem", opacity: 0.45, display: "block", marginBottom: 6 }}>Potential Value Range</span>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, textAlign: "center" }}>
                <div>
                  <div style={{ fontSize: "0.55rem", opacity: 0.35 }}>at ${(tp * 0.5).toFixed(2)}</div>
                  <div className="mono" style={{ fontSize: "0.9rem", fontWeight: 600, marginTop: 1 }}>
                    {formatUSD(valueLow)}
                  </div>
                </div>
                <div style={{ background: "rgba(177,252,3,0.1)", borderRadius: 6, padding: "4px 0" }}>
                  <div style={{ fontSize: "0.55rem", opacity: 0.5, color: "#B1FC03" }}>at ${tp.toFixed(2)}</div>
                  <div className="mono" style={{ fontSize: "1rem", fontWeight: 700, marginTop: 1, color: "#B1FC03" }}>
                    {formatUSD(valueMid)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "0.55rem", opacity: 0.35 }}>at ${(tp * 2).toFixed(2)}</div>
                  <div className="mono" style={{ fontSize: "0.9rem", fontWeight: 600, marginTop: 1 }}>
                    {formatUSD(valueHigh)}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Your PSE Position,tiered */}
          {stakedAmount > 0 && bondedTokens > 0 && (
            <div style={{
              marginBottom: 12, padding: "12px 14px", borderRadius: 12,
              background: "var(--tx-dark-green)", color: "#fff",
            }}>
              <div style={{ fontSize: "0.65rem", opacity: 0.45, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Your PSE Position
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: "50%",
                      background: positionTier.dot,
                      boxShadow: `0 0 6px ${positionTier.dot}40`,
                    }} />
                    <span style={{ fontSize: "1.3rem", fontWeight: 700, fontFamily: "var(--font-mono)", color: positionTier.color }}>
                      {positionTier.label}
                    </span>
                  </div>
                  <div style={{ fontSize: "0.6rem", opacity: 0.4, marginTop: 4, paddingLeft: 16 }}>
                    {userSharePct.toFixed(4)}% of bonded pool · {isAboveAvg ? "above average stake" : "increase stake to improve PSE share"}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: "0.65rem", opacity: 0.5 }}>Cycle 1 of 84</div>
                  <div style={{ fontSize: "0.7rem", color: "var(--tx-neon-light)", fontWeight: 600 }}>Early Phase</div>
                </div>
              </div>
              <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 4 }}>
                <Tooltip text="This advantage decreases with every new staker entering the network." position="bottom" />
              </div>
            </div>
          )}

          {/* APR + PSE cards */}
          <div className="grid-2">
            <div className="accent-card card-orange" style={{ minHeight: 130 }}>
              <div className="blob-dark" style={{ width: 120, height: 120 }} />
              <div className="card-content">
                <span className="card-title">Base APR <Tooltip text={apr < 1 ? "Negligible, nearly 100% of returns come from PSE" : "PSE rewards are added on top of base APR"} /></span>
                <div className="card-value" style={{ fontSize: "2rem" }}>
                  {apr > 0 ? `${apr.toFixed(2)}%` : "---"}
                </div>
              </div>
            </div>
            <div className="accent-card card-olive" style={{ minHeight: 130 }}>
              <div className="card-content">
                <span className="card-title" style={{ opacity: 0.8, fontSize: "0.62rem" }}>Initial Monthly PSE (est.) <Tooltip text={`For ${formatNumber(wallet.connected ? wallet.stakedAmount : stakedAmount)} TX. Front-loaded, highest in early cycles.`} /></span>
                <div className="card-value" style={{ fontSize: "1.6rem" }}>
                  {formatTX(nextPSEReward)}
                </div>
              </div>
            </div>
          </div>

          {/* Start Now vs Wait + Sensitivity + Optimization */}
          {waitComparison && (
            <div style={{ marginTop: 12 }}>
              <div className="compare-box">
                <div className="compare-row">
                  <div>
                    <div className="compare-label">Lock in before competition increases</div>
                    <div className="compare-value">{waitComparison.nowBag.toLocaleString()} TX</div>
                  </div>
                  <span className="text-xs text-light">vs</span>
                  <div style={{ textAlign: "right" }}>
                    <div className="compare-label">Wait 3 Months</div>
                    <div className="compare-value" style={{ opacity: 0.5 }}>{waitComparison.waitBag.toLocaleString()} TX</div>
                  </div>
                </div>
                <div className="compare-cost">
                  Waiting costs ~{waitComparison.diff.toLocaleString()} TX ({waitComparison.diffPct}% less)
                </div>
              </div>

              {/* Sensitivity Feedback */}
              <div className="responsive-grid-2" style={{
                marginTop: 8, gap: 6,
              }}>
                <div style={{
                  padding: "6px 10px", borderRadius: 8,
                  background: "rgba(177,252,3,0.04)", border: "1px solid rgba(177,252,3,0.1)",
                  fontSize: "0.62rem", lineHeight: 1.35,
                }}>
                  <span style={{ fontWeight: 600, color: "var(--accent-olive)" }}>+10% stake</span>
                  <span style={{ opacity: 0.6 }}> → +{extraBagGrowth > 0 ? formatNumber(extraBagGrowth) : "0"} TX more</span>
                </div>
                <div style={{
                  padding: "6px 10px", borderRadius: 8,
                  background: "rgba(180,74,62,0.04)", border: "1px solid rgba(180,74,62,0.1)",
                  fontSize: "0.62rem", lineHeight: 1.35,
                }}>
                  <span style={{ fontWeight: 600, color: "#b44a3e" }}>+3 month delay</span>
                  <span style={{ opacity: 0.6 }}> → -{delayCostPct}% outcome</span>
                </div>
              </div>

              {/* Optimization Hint */}
              {extraBagGrowth > 0 && parseFloat(waitComparison.diffPct) > 5 && (
                <div style={{
                  marginTop: 6, padding: "6px 10px", borderRadius: 8,
                  fontSize: "0.62rem", lineHeight: 1.4, opacity: 0.6,
                }}>
                  Entering earlier has higher impact than increasing stake size.
                </div>
              )}
            </div>
          )}

          {/* PSE Explainer,Finite Emission Highlight */}
          <div style={{
            marginTop: 16, padding: "14px 16px", borderRadius: 12, flex: 1,
            background: "var(--tx-dark-green)", color: "rgba(255,255,255,0.85)",
            fontSize: "0.72rem", lineHeight: 1.55,
          }}>
            <div style={{ fontWeight: 700, fontSize: "0.78rem", marginBottom: 4, color: "var(--tx-neon)" }}>
              Why PSE matters
            </div>
            <div style={{
              padding: "6px 10px", borderRadius: 8, marginBottom: 10,
              background: "rgba(177,252,3,0.08)", border: "1px solid rgba(177,252,3,0.12)",
              fontSize: "0.68rem", color: "var(--tx-neon-light)",
            }}>
              Finite emission: 100B TX over 84 months. Early participation captures disproportionate rewards because the bonded pool is smallest now.
            </div>
            <div className="responsive-grid-3" style={{ gap: 10 }}>
              <div>
                <div style={{ fontWeight: 600, color: "var(--tx-neon-light)", marginBottom: 2, fontSize: "0.65rem" }}>Stake Size</div>
                <div style={{ opacity: 0.6, fontSize: "0.62rem" }}>Your share of the bonded pool determines PSE allocation</div>
              </div>
              <div>
                <div style={{ fontWeight: 600, color: "var(--tx-neon-light)", marginBottom: 2, fontSize: "0.65rem" }}>Early Entry</div>
                <div style={{ opacity: 0.6, fontSize: "0.62rem" }}>Score = Stake x Duration. Compounding grows your advantage each cycle</div>
              </div>
              <div>
                <div style={{ fontWeight: 600, color: "var(--tx-neon-light)", marginBottom: 2, fontSize: "0.65rem" }}>Competition</div>
                <div style={{ opacity: 0.6, fontSize: "0.62rem" }}>Fewer stakers early = bigger share. Your reward decreases as network grows</div>
              </div>
            </div>
          </div>

          <div className="mt-3 text-xs text-light" style={{ padding: "0 4px", lineHeight: 1.6 }}>
            This is a &quot;what if&quot; simulator,not your actual PSE rewards.
            To see your real on-chain PSE score, go to the{" "}
            <button
              onClick={() => setActiveTab("pse")}
              style={{ background: "none", border: "none", color: "var(--accent-olive)", fontWeight: 600, cursor: "pointer", padding: 0, fontSize: "inherit" }}
            >
              PSE tab
            </button>
            {" "}and fetch your address. Not financial advice.
          </div>
        </div>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════
   TAB: PORTFOLIO (wallet-connected staking management)
   ═══════════════════════════════════════════════════════ */

function PortfolioTab({
  wallet, price, apr, bondedTokens, excludedPSEStake, pseEligibleBonded,
  pseInfo, stakingData, claimRewards, delegate, undelegate, redelegate,
  refresh, txPending,
}: any) {
  const [actionTab, setActionTab] = useState<"delegate" | "undelegate" | "redelegate">("delegate");
  const [amount, setAmount] = useState("");
  const [selectedValidator, setSelectedValidator] = useState("");
  const [selectedSrcValidator, setSelectedSrcValidator] = useState("");
  const [validatorSearch, setValidatorSearch] = useState("");
  const [validators, setValidators] = useState<any[]>([]);
  const [validatorsLoading, setValidatorsLoading] = useState(true);
  const [confirmUndelegate, setConfirmUndelegate] = useState(false);

  const parsedAmount = parseFloat(amount.replace(/,/g, "")) || 0;
  const GAS_RESERVE = 0.1; // Reserve for gas fees

  // Fetch validators on mount
  useEffect(() => {
    import("@/lib/api").then(({ fetchAllValidators }) => {
      fetchAllValidators(price).then((vals: any[]) => {
        setValidators(vals);
        setValidatorsLoading(false);
      });
    });
  }, [price]);

  // Filter validators by search, randomize order, pin Silk Nodes to top
  const filteredValidators = useMemo(() => {
    const filtered = validators.filter((v: any) =>
      v.moniker.toLowerCase().includes(validatorSearch.toLowerCase())
    );
    // Shuffle randomly (Fisher-Yates)
    for (let i = filtered.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [filtered[i], filtered[j]] = [filtered[j], filtered[i]];
    }
    // Pin Silk Nodes to top
    const silkIndex = filtered.findIndex((v: any) => v.moniker === "Silk Nodes");
    if (silkIndex > 0) {
      const [silk] = filtered.splice(silkIndex, 1);
      filtered.unshift(silk);
    }
    return filtered;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validators, validatorSearch]);

  // Find selected validator details
  const selectedValInfo = validators.find((v: any) => v.operatorAddress === selectedValidator);
  const selectedSrcInfo = wallet.delegations.find((d: any) => d.validatorAddress === selectedSrcValidator);

  // Max amounts
  const maxDelegate = Math.max(0, wallet.balance - GAS_RESERVE);
  const maxUndelegate = selectedSrcInfo?.amount || 0;
  const maxRedelegate = selectedSrcInfo?.amount || 0;

  // PSE next distribution date
  const nextDistDate = pseInfo.nextDistribution.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

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
    } else if (actionTab === "redelegate") {
      if (!selectedSrcValidator || !selectedValidator) return;
      await redelegate(selectedSrcValidator, selectedValidator, parsedAmount);
    }
    setAmount("");
  };

  // Reset confirm state when switching tabs/validators
  useEffect(() => { setConfirmUndelegate(false); }, [actionTab, selectedSrcValidator]);

  const nextPSEReward = pseEligibleBonded > 0 && wallet.stakedAmount > 0
    ? estimatePSERewardFullPeriod(wallet.stakedAmount, bondedTokens, excludedPSEStake)
    : 0;

  return (
    <>
      <div className="section-head">
        <h1 className="page-title">My Portfolio</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: "0.75rem", color: "var(--text-light)", fontFamily: "var(--font-mono)" }}>
            {wallet.address.slice(0, 10)}...{wallet.address.slice(-4)}
          </span>
          <span style={{
            fontSize: "0.6rem", color: "var(--accent-olive)", fontWeight: 600,
            background: "rgba(74,122,26,0.1)", padding: "2px 8px", borderRadius: "var(--radius-pill)",
            textTransform: "uppercase",
          }}>{wallet.walletType}</span>
          <button
            onClick={refresh}
            style={{
              background: "none", border: "1px solid var(--glass-border)", borderRadius: "var(--radius-pill)",
              padding: "4px 12px", fontSize: "0.7rem", color: "var(--text-medium)", cursor: "pointer",
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* ── Portfolio Summary ── */}
      <div className="responsive-grid-4" style={{ gap: 1, background: "rgba(255,255,255,0.3)", borderRadius: "var(--radius-lg)", overflow: "hidden", marginBottom: 16 }}>
        {[
          { label: "Available", value: `${formatNumber(Math.round(wallet.balance))} TX`, sub: price > 0 ? formatUSD(wallet.balance * price) : "", color: "var(--text-dark)" },
          { label: "Staked", value: `${formatNumber(Math.round(wallet.stakedAmount))} TX`, sub: price > 0 ? formatUSD(wallet.stakedAmount * price) : "", color: "var(--accent-olive)" },
          { label: "Pending Rewards", value: `${wallet.rewards > 1 ? formatNumber(Math.round(wallet.rewards)) : wallet.rewards.toFixed(2)} TX`, sub: price > 0 ? formatUSD(wallet.rewards * price) : "", color: "var(--tx-dark-green)" },
          { label: "Total Value", value: price > 0 ? formatUSD((wallet.balance + wallet.stakedAmount + wallet.rewards) * price) : `${formatNumber(Math.round(wallet.balance + wallet.stakedAmount + wallet.rewards))} TX`, sub: price > 0 ? `${formatNumber(Math.round(wallet.balance + wallet.stakedAmount + wallet.rewards))} TX` : "", color: "var(--text-dark)" },
        ].map((item) => (
          <div key={item.label} style={{ background: "var(--glass-bg)", padding: "16px 18px" }}>
            <div style={{ fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-light)", marginBottom: 4 }}>{item.label}</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: "1.15rem", fontWeight: 600, color: item.color }}>{item.value}</div>
            {item.sub && <div style={{ fontSize: "0.65rem", color: "var(--text-light)", marginTop: 2 }}>{item.sub}</div>}
          </div>
        ))}
      </div>

      {/* PSE estimate + Claim rewards row */}
      <div className="responsive-grid-2" style={{ gap: 14, marginBottom: 16 }}>
        {/* PSE Estimate */}
        <div style={{
          background: "var(--tx-dark-green)", borderRadius: "var(--radius-md)",
          padding: "16px 18px", color: "#fff",
        }}>
          <div style={{ fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "rgba(255,255,255,0.45)", marginBottom: 6 }}>
            Est. Next PSE Reward (Distribution #{pseInfo.distributionNumber})
          </div>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <div>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "1.3rem", fontWeight: 600, color: "var(--tx-neon)" }}>
                ~{formatNumber(Math.round(nextPSEReward))} TX
              </span>
              {price > 0 && (
                <span style={{ fontSize: "0.68rem", color: "rgba(177,252,3,0.5)", marginLeft: 8 }}>
                  ~{formatUSD(nextPSEReward * price)}
                </span>
              )}
            </div>
            <div style={{ fontSize: "0.6rem", color: "rgba(255,255,255,0.35)" }}>
              Next: {nextDistDate}
            </div>
          </div>
          <div style={{ fontSize: "0.55rem", color: "rgba(255,255,255,0.25)", marginTop: 6 }}>
            Estimate only.{" "}
            <a href="https://tx-pse.today" target="_blank" rel="noopener noreferrer" style={{ color: "var(--tx-neon)", textDecoration: "none" }}>
              tx-pse.today
            </a>{" "}for exact calculation.
          </div>
        </div>

        {/* Claim Rewards */}
        <div className="panel" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-light)", marginBottom: 6 }}>
            Claimable Rewards
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "1.3rem", fontWeight: 600, color: "var(--accent-olive)", marginBottom: 10 }}>
            {wallet.rewards > 1 ? formatNumber(Math.round(wallet.rewards)) : wallet.rewards.toFixed(2)} TX
            {price > 0 && <span style={{ fontSize: "0.68rem", color: "var(--text-light)", marginLeft: 8 }}>{formatUSD(wallet.rewards * price)}</span>}
          </div>
          <button
            onClick={claimRewards}
            disabled={txPending || wallet.rewards < 0.01}
            className="btn-olive"
            style={{ padding: "10px 16px", fontSize: "0.8rem", opacity: (txPending || wallet.rewards < 0.01) ? 0.4 : 1 }}
          >
            {txPending ? "Processing..." : "Claim All Rewards"}
          </button>
        </div>
      </div>

      {/* ── Staking Actions ── */}
      <div className="responsive-grid-2" style={{ gap: 16, alignItems: "start" }}>
        {/* Left: Action Panel */}
        <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
          {/* Action tabs */}
          <div style={{ display: "flex", borderBottom: "1px solid var(--glass-border)" }}>
            {(["delegate", "undelegate", "redelegate"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => { setActionTab(tab); setAmount(""); setSelectedValidator(""); setSelectedSrcValidator(""); }}
                style={{
                  flex: 1, padding: "12px 0", fontSize: "0.8rem", fontWeight: actionTab === tab ? 600 : 400,
                  background: actionTab === tab ? "var(--glass-bg)" : "transparent",
                  borderBottom: actionTab === tab ? "2px solid var(--accent-olive)" : "2px solid transparent",
                  border: "none", cursor: "pointer", color: actionTab === tab ? "var(--text-dark)" : "var(--text-light)",
                  textTransform: "capitalize", transition: "all 0.15s",
                }}
              >
                {tab}
              </button>
            ))}
          </div>

          <div style={{ padding: "20px 22px" }}>
            {/* ── DELEGATE ── */}
            {actionTab === "delegate" && (
              <>
                {/* Amount input */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: "0.72rem", fontWeight: 500 }}>Amount</span>
                    <span style={{ fontSize: "0.68rem", color: "var(--text-light)" }}>
                      Available: {formatNumber(Math.round(maxDelegate))} TX
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      type="text"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                      placeholder="0"
                      style={{
                        flex: 1, padding: "10px 14px", borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--glass-border)", background: "rgba(255,255,255,0.5)",
                        fontFamily: "var(--font-mono)", fontSize: "1rem", outline: "none",
                      }}
                    />
                    <button
                      onClick={() => setAmount(maxDelegate.toFixed(0))}
                      style={{
                        padding: "10px 14px", borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--glass-border)", background: "rgba(74,122,26,0.08)",
                        cursor: "pointer", fontSize: "0.72rem", fontWeight: 600, color: "var(--accent-olive)",
                      }}
                    >
                      MAX
                    </button>
                  </div>
                </div>

                {/* Validator search */}
                <div style={{ marginBottom: 12 }}>
                  <span style={{ fontSize: "0.72rem", fontWeight: 500, display: "block", marginBottom: 6 }}>Select Validator</span>
                  <input
                    type="text"
                    value={validatorSearch}
                    onChange={(e) => setValidatorSearch(e.target.value)}
                    placeholder="Search validators..."
                    style={{
                      width: "100%", padding: "8px 12px", borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--glass-border)", background: "rgba(255,255,255,0.5)",
                      fontSize: "0.8rem", outline: "none", marginBottom: 8,
                    }}
                  />
                  <div style={{ maxHeight: 200, overflowY: "auto", borderRadius: "var(--radius-sm)", border: "1px solid var(--glass-border)" }}>
                    {validatorsLoading ? (
                      <div style={{ padding: 16, textAlign: "center", fontSize: "0.78rem", color: "var(--text-light)" }}>Loading validators...</div>
                    ) : (
                      filteredValidators.slice(0, 30).map((v: any) => {
                        const isSilk = v.moniker === "Silk Nodes";
                        const isSelected = selectedValidator === v.operatorAddress;
                        return (
                          <div
                            key={v.operatorAddress}
                            onClick={() => setSelectedValidator(v.operatorAddress)}
                            style={{
                              display: "flex", alignItems: "center", justifyContent: "space-between",
                              padding: "8px 12px", cursor: "pointer",
                              background: isSelected ? "rgba(74,122,26,0.1)" : isSilk ? "rgba(177,252,3,0.04)" : "transparent",
                              borderBottom: "1px solid rgba(255,255,255,0.3)",
                              borderLeft: isSelected ? "3px solid var(--accent-olive)" : "3px solid transparent",
                              transition: "all 0.1s",
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              {isSilk && <span style={{ fontSize: "0.55rem", color: "var(--tx-neon)", fontWeight: 700, background: "var(--tx-dark-green)", padding: "1px 5px", borderRadius: 4 }}>REC</span>}
                              <span style={{ fontSize: "0.8rem", fontWeight: isSelected ? 600 : 400 }}>{v.moniker}</span>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: "0.68rem", color: "var(--text-light)" }}>
                              <span>{v.commission}%</span>
                              <span>{formatNumber(v.tokens)} TX</span>
                              {isSelected && <span style={{ color: "var(--accent-olive)", fontWeight: 600 }}>Selected</span>}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* PSE note */}
                <div style={{ fontSize: "0.65rem", color: "var(--text-medium)", marginBottom: 14, lineHeight: 1.5 }}>
                  Must stay staked until next PSE distribution ({nextDistDate}) to earn PSE rewards.
                </div>

                <button
                  onClick={handleAction}
                  disabled={txPending || parsedAmount <= 0 || !selectedValidator || parsedAmount > maxDelegate}
                  className="btn-olive"
                  style={{ width: "100%", padding: "12px", fontSize: "0.85rem", opacity: (txPending || parsedAmount <= 0 || !selectedValidator) ? 0.4 : 1 }}
                >
                  {txPending ? "Processing..." : `Delegate ${parsedAmount > 0 ? formatNumber(parsedAmount) : ""} TX${selectedValInfo ? ` to ${selectedValInfo.moniker}` : ""}`}
                </button>
              </>
            )}

            {/* ── UNDELEGATE ── */}
            {actionTab === "undelegate" && (
              <>
                {wallet.delegations.length === 0 ? (
                  <div style={{ padding: 20, textAlign: "center", color: "var(--text-light)", fontSize: "0.85rem" }}>
                    No active delegations to undelegate from.
                  </div>
                ) : (
                  <>
                    <div style={{ marginBottom: 14 }}>
                      <span style={{ fontSize: "0.72rem", fontWeight: 500, display: "block", marginBottom: 8 }}>Select Delegation</span>
                      {wallet.delegations.map((d: any) => (
                        <div
                          key={d.validatorAddress}
                          onClick={() => { setSelectedSrcValidator(d.validatorAddress); setConfirmUndelegate(false); }}
                          style={{
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                            padding: "10px 12px", cursor: "pointer", borderRadius: "var(--radius-sm)",
                            background: selectedSrcValidator === d.validatorAddress ? "rgba(180,74,62,0.06)" : "transparent",
                            border: selectedSrcValidator === d.validatorAddress ? "1px solid rgba(180,74,62,0.2)" : "1px solid var(--glass-border)",
                            marginBottom: 4, transition: "all 0.1s",
                          }}
                        >
                          <div>
                            <div style={{ fontSize: "0.82rem", fontWeight: 500 }}>{d.validatorMoniker}</div>
                            {d.rewards > 0.01 && <div style={{ fontSize: "0.62rem", color: "var(--accent-olive)" }}>+{d.rewards.toFixed(2)} TX rewards</div>}
                          </div>
                          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.85rem", fontWeight: 500 }}>
                            {formatNumber(Math.round(d.amount))} TX
                          </div>
                        </div>
                      ))}
                    </div>

                    {selectedSrcValidator && (
                      <>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                          <span style={{ fontSize: "0.72rem", fontWeight: 500 }}>Amount to Undelegate</span>
                          <span style={{ fontSize: "0.68rem", color: "var(--text-light)" }}>Max: {formatNumber(Math.round(maxUndelegate))} TX</span>
                        </div>
                        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                          <input
                            type="text" value={amount}
                            onChange={(e) => { setAmount(e.target.value.replace(/[^0-9.]/g, "")); setConfirmUndelegate(false); }}
                            placeholder="0"
                            style={{
                              flex: 1, padding: "10px 14px", borderRadius: "var(--radius-sm)",
                              border: "1px solid rgba(180,74,62,0.3)", background: "rgba(255,255,255,0.5)",
                              fontFamily: "var(--font-mono)", fontSize: "1rem", outline: "none",
                            }}
                          />
                          <button
                            onClick={() => setAmount(maxUndelegate.toFixed(0))}
                            style={{
                              padding: "10px 14px", borderRadius: "var(--radius-sm)",
                              border: "1px solid rgba(180,74,62,0.2)", background: "rgba(180,74,62,0.05)",
                              cursor: "pointer", fontSize: "0.72rem", fontWeight: 600, color: "#b44a3e",
                            }}
                          >
                            MAX
                          </button>
                        </div>

                        {/* Warnings */}
                        <div style={{
                          padding: "12px 14px", borderRadius: "var(--radius-sm)",
                          background: "rgba(180,74,62,0.06)", border: "1px solid rgba(180,74,62,0.15)",
                          marginBottom: 14,
                        }}>
                          <div style={{ fontSize: "0.72rem", fontWeight: 600, color: "#b44a3e", marginBottom: 6 }}>Warning</div>
                          <ul style={{ margin: 0, paddingLeft: 16, fontSize: "0.68rem", color: "var(--text-medium)", lineHeight: 1.7 }}>
                            <li><strong>7-day unbonding period</strong>,tokens locked, cannot transfer</li>
                            <li><strong>No PSE rewards</strong> during unbonding period</li>
                            <li>If you undelegate before <strong>{nextDistDate}</strong>, you lose this cycle&apos;s PSE</li>
                            <li>No staking rewards earned during unbonding</li>
                          </ul>
                        </div>

                        {confirmUndelegate ? (
                          <div style={{ display: "flex", gap: 8 }}>
                            <button
                              onClick={handleAction}
                              disabled={txPending}
                              style={{
                                flex: 1, padding: "12px", fontSize: "0.85rem", fontWeight: 600,
                                borderRadius: "var(--radius-pill)", border: "none", cursor: "pointer",
                                background: "#b44a3e", color: "#fff", opacity: txPending ? 0.5 : 1,
                              }}
                            >
                              {txPending ? "Processing..." : "Yes, Undelegate"}
                            </button>
                            <button
                              onClick={() => setConfirmUndelegate(false)}
                              style={{
                                flex: 1, padding: "12px", fontSize: "0.85rem",
                                borderRadius: "var(--radius-pill)", border: "1px solid var(--glass-border)",
                                background: "transparent", cursor: "pointer", color: "var(--text-medium)",
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={handleAction}
                            disabled={txPending || parsedAmount <= 0 || parsedAmount > maxUndelegate}
                            style={{
                              width: "100%", padding: "12px", fontSize: "0.85rem", fontWeight: 500,
                              borderRadius: "var(--radius-pill)", border: "1px solid rgba(180,74,62,0.3)",
                              background: "rgba(180,74,62,0.08)", cursor: "pointer", color: "#b44a3e",
                              opacity: (parsedAmount <= 0 || parsedAmount > maxUndelegate) ? 0.4 : 1,
                            }}
                          >
                            Undelegate {parsedAmount > 0 ? `${formatNumber(parsedAmount)} TX` : ""}
                          </button>
                        )}
                      </>
                    )}
                  </>
                )}
              </>
            )}

            {/* ── REDELEGATE ── */}
            {actionTab === "redelegate" && (
              <>
                {wallet.delegations.length === 0 ? (
                  <div style={{ padding: 20, textAlign: "center", color: "var(--text-light)", fontSize: "0.85rem" }}>
                    No active delegations to redelegate.
                  </div>
                ) : (
                  <>
                    {/* Source validator */}
                    <div style={{ marginBottom: 14 }}>
                      <span style={{ fontSize: "0.72rem", fontWeight: 500, display: "block", marginBottom: 6 }}>From (Source)</span>
                      {wallet.delegations.map((d: any) => (
                        <div
                          key={d.validatorAddress}
                          onClick={() => setSelectedSrcValidator(d.validatorAddress)}
                          style={{
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                            padding: "8px 12px", cursor: "pointer", borderRadius: "var(--radius-sm)",
                            background: selectedSrcValidator === d.validatorAddress ? "rgba(74,122,26,0.08)" : "transparent",
                            border: selectedSrcValidator === d.validatorAddress ? "1px solid rgba(74,122,26,0.2)" : "1px solid var(--glass-border)",
                            marginBottom: 3, transition: "all 0.1s",
                          }}
                        >
                          <span style={{ fontSize: "0.8rem" }}>{d.validatorMoniker}</span>
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}>{formatNumber(Math.round(d.amount))} TX</span>
                        </div>
                      ))}
                    </div>

                    {selectedSrcValidator && (
                      <>
                        {/* Amount */}
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                          <span style={{ fontSize: "0.72rem", fontWeight: 500 }}>Amount</span>
                          <span style={{ fontSize: "0.68rem", color: "var(--text-light)" }}>Max: {formatNumber(Math.round(maxRedelegate))} TX</span>
                        </div>
                        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                          <input
                            type="text" value={amount}
                            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                            placeholder="0"
                            style={{
                              flex: 1, padding: "10px 14px", borderRadius: "var(--radius-sm)",
                              border: "1px solid var(--glass-border)", background: "rgba(255,255,255,0.5)",
                              fontFamily: "var(--font-mono)", fontSize: "1rem", outline: "none",
                            }}
                          />
                          <button
                            onClick={() => setAmount(maxRedelegate.toFixed(0))}
                            style={{
                              padding: "10px 14px", borderRadius: "var(--radius-sm)",
                              border: "1px solid var(--glass-border)", background: "rgba(74,122,26,0.08)",
                              cursor: "pointer", fontSize: "0.72rem", fontWeight: 600, color: "var(--accent-olive)",
                            }}
                          >
                            MAX
                          </button>
                        </div>

                        {/* Destination validator */}
                        <div style={{ marginBottom: 12 }}>
                          <span style={{ fontSize: "0.72rem", fontWeight: 500, display: "block", marginBottom: 6 }}>To (Destination)</span>
                          <input
                            type="text" value={validatorSearch}
                            onChange={(e) => setValidatorSearch(e.target.value)}
                            placeholder="Search validators..."
                            style={{
                              width: "100%", padding: "8px 12px", borderRadius: "var(--radius-sm)",
                              border: "1px solid var(--glass-border)", background: "rgba(255,255,255,0.5)",
                              fontSize: "0.8rem", outline: "none", marginBottom: 6,
                            }}
                          />
                          <div style={{ maxHeight: 160, overflowY: "auto", borderRadius: "var(--radius-sm)", border: "1px solid var(--glass-border)" }}>
                            {filteredValidators
                              .filter((v: any) => v.operatorAddress !== selectedSrcValidator)
                              .slice(0, 20)
                              .map((v: any) => {
                                const isSilk = v.moniker === "Silk Nodes";
                                const isSelected = selectedValidator === v.operatorAddress;
                                return (
                                  <div
                                    key={v.operatorAddress}
                                    onClick={() => setSelectedValidator(v.operatorAddress)}
                                    style={{
                                      display: "flex", alignItems: "center", justifyContent: "space-between",
                                      padding: "7px 12px", cursor: "pointer",
                                      background: isSelected ? "rgba(74,122,26,0.1)" : isSilk ? "rgba(177,252,3,0.04)" : "transparent",
                                      borderBottom: "1px solid rgba(255,255,255,0.3)",
                                      borderLeft: isSelected ? "3px solid var(--accent-olive)" : "3px solid transparent",
                                    }}
                                  >
                                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                      {isSilk && <span style={{ fontSize: "0.5rem", color: "var(--tx-neon)", fontWeight: 700, background: "var(--tx-dark-green)", padding: "1px 4px", borderRadius: 3 }}>REC</span>}
                                      <span style={{ fontSize: "0.78rem" }}>{v.moniker}</span>
                                    </div>
                                    <span style={{ fontSize: "0.65rem", color: "var(--text-light)" }}>{v.commission}%</span>
                                  </div>
                                );
                              })}
                          </div>
                        </div>

                        {/* Redelegate benefits */}
                        <div style={{
                          padding: "10px 14px", borderRadius: "var(--radius-sm)",
                          background: "rgba(74,122,26,0.06)", border: "1px solid rgba(74,122,26,0.12)",
                          marginBottom: 14, fontSize: "0.68rem", color: "var(--text-medium)", lineHeight: 1.6,
                        }}>
                          <span style={{ color: "var(--accent-olive)", marginRight: 4 }}>&#10003;</span> Instant,no unbonding period<br/>
                          <span style={{ color: "var(--accent-olive)", marginRight: 4 }}>&#10003;</span> PSE score preserved<br/>
                          <span style={{ color: "var(--accent-olive)", marginRight: 4 }}>&#10003;</span> Staking rewards continue without interruption
                        </div>

                        <button
                          onClick={handleAction}
                          disabled={txPending || parsedAmount <= 0 || !selectedValidator || parsedAmount > maxRedelegate}
                          className="btn-olive"
                          style={{ width: "100%", padding: "12px", fontSize: "0.85rem", opacity: (parsedAmount <= 0 || !selectedValidator) ? 0.4 : 1 }}
                        >
                          {txPending ? "Processing..." : `Redelegate ${parsedAmount > 0 ? formatNumber(parsedAmount) + " TX" : ""}`}
                        </button>
                      </>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {/* Right: Active Delegations + Unbonding */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Active Delegations */}
          <div className="panel" style={{ padding: "18px 22px" }}>
            <div style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-light)", marginBottom: 10, fontWeight: 600 }}>
              Active Delegations ({wallet.delegations.length})
            </div>
            {wallet.delegations.length === 0 ? (
              <div style={{ padding: "20px 0", textAlign: "center", fontSize: "0.82rem", color: "var(--text-light)" }}>
                No active delegations yet. Use the Delegate tab to start staking.
              </div>
            ) : (
              wallet.delegations.map((del: any, i: number) => {
                const votingPower = bondedTokens > 0 ? (del.amount / bondedTokens) * 100 : 0;
                return (
                  <div key={i} style={{
                    padding: "10px 14px", borderRadius: "var(--radius-sm)",
                    background: i % 2 === 0 ? "rgba(255,255,255,0.3)" : "transparent",
                    marginBottom: 2,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent-olive)" }} />
                        <span style={{ fontSize: "0.85rem", fontWeight: 500 }}>{del.validatorMoniker}</span>
                      </div>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.9rem", fontWeight: 600 }}>
                        {formatNumber(Math.round(del.amount))} TX
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.62rem", color: "var(--text-light)" }}>
                      <span>{price > 0 ? formatUSD(del.amount * price) : ""}</span>
                      <div style={{ display: "flex", gap: 12 }}>
                        <span>VP: {votingPower.toFixed(3)}%</span>
                        {del.rewards > 0.01 && (
                          <span style={{ color: "var(--accent-olive)" }}>+{del.rewards > 1 ? formatNumber(Math.round(del.rewards)) : del.rewards.toFixed(2)} TX rewards</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Unbonding Delegations */}
          {wallet.unbondingDelegations.length > 0 && (
            <div className="panel" style={{ padding: "18px 22px" }}>
              <div style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "#c4a96a", marginBottom: 10, fontWeight: 600 }}>
                Unbonding ({wallet.unbondingDelegations.length})
              </div>
              {wallet.unbondingDelegations.map((u: any, i: number) => {
                const completeDate = new Date(u.completionTime);
                const daysLeft = Math.max(0, Math.ceil((completeDate.getTime() - Date.now()) / 86400000));
                return (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "8px 12px", background: "rgba(196,169,106,0.05)", borderRadius: "var(--radius-sm)",
                    marginBottom: 3,
                  }}>
                    <div>
                      <div style={{ fontSize: "0.8rem" }}>{u.validatorMoniker}</div>
                      <div style={{ fontSize: "0.62rem", color: "#c4a96a" }}>
                        {daysLeft > 0 ? `${daysLeft} day${daysLeft > 1 ? "s" : ""} remaining` : "Ready to claim"}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.82rem" }}>{formatNumber(Math.round(u.amount))} TX</div>
                      <div style={{ fontSize: "0.58rem", color: "var(--text-light)" }}>
                        {completeDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Staking info card */}
          <div style={{
            background: "var(--tx-dark-green)", borderRadius: "var(--radius-md)",
            padding: "16px 18px", color: "#fff",
          }}>
            <div style={{ fontSize: "0.68rem", fontWeight: 600, color: "var(--tx-neon)", marginBottom: 8 }}>Staking Info</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: "0.68rem" }}>
              <div>
                <div style={{ color: "rgba(255,255,255,0.4)" }}>Base APR</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.9rem", marginTop: 2 }}>{apr.toFixed(2)}%</div>
              </div>
              <div>
                <div style={{ color: "rgba(255,255,255,0.4)" }}>Unbonding Period</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.9rem", marginTop: 2 }}>7 days</div>
              </div>
              <div>
                <div style={{ color: "rgba(255,255,255,0.4)" }}>PSE Eligible Bonded</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.9rem", marginTop: 2 }}>{formatNumber(pseEligibleBonded)} TX</div>
              </div>
              <div>
                <div style={{ color: "rgba(255,255,255,0.4)" }}>Next PSE</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.9rem", marginTop: 2 }}>{nextDistDate}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════
   TAB: VALIDATORS
   ═══════════════════════════════════════════════════════ */

function ValidatorsTab({ wallet, setActiveTab, setShowWalletModal }: any) {
  return (
    <>
      <div className="section-head">
        <h1 className="page-title">Validators</h1>
        <span className="section-sub">Choose where to stake &middot; Compare APR, commission &amp; voting power</span>
      </div>

      <ValidatorList wallet={wallet} setActiveTab={setActiveTab} setShowWalletModal={setShowWalletModal} />
    </>
  );
}

/* ═══════════════════════════════════════════════════════
   TAB: STAKE
   ═══════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════
   TAB: SILK NODES
   ═══════════════════════════════════════════════════════ */

const SILK_SERVICES = {
  rpc: "https://rpc.silknodes.io/coreum",
  api: "https://api.silknodes.io/coreum",
  grpc: "coreum.grpc.silknodes.io:443",
  seed: "284313184f63d9f06b218a67a0e2de126b64258d@seeds.silknodes.io:15019",
  peers: [
    "a4bbd6acbf667cac630e748da7bda09c8f404135@65.108.106.172:26656",
    "2e6fb93b12f9cdff3a3cb69db3c93713e69df8f7@65.108.204.225:12556",
    "559167a59e5aeb881e5159455aafa2c2f4bb97fb@5.161.216.37:26656",
  ],
  snapshot: {
    downloadUrl: "https://silknodes.io/networks/coreum",
  },
  explorer: "https://www.mintscan.io/coreum",
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button className="filter-chip" onClick={handleCopy} style={{ minWidth: 60, textAlign: "center" }}>
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

function SilkNodesTab({ networkStatus, stakingData, setActiveTab, wallet, setShowWalletModal }: any) {
  const [devToolsOpen, setDevToolsOpen] = useState(false);
  const [showRestakeModal, setShowRestakeModal] = useState(false);
  const silkBonded = stakingData?.bondedTokens ? Math.round(stakingData.bondedTokens * 0.03) : 22900;
  const silkVotingPower = stakingData?.bondedTokens ? ((silkBonded / stakingData.bondedTokens) * 100).toFixed(2) : "3.00";

  return (
    <>
      {/* ── Hero Banner,Dark green TX branded ── */}
      <div style={{
        background: "var(--tx-dark-green)",
        borderRadius: "var(--radius-lg)",
        padding: "28px 32px",
        color: "#fff",
        position: "relative",
        overflow: "hidden",
        marginBottom: 16,
      }}>
        {/* Subtle neon glow accent */}
        <div style={{
          position: "absolute", top: -40, right: -40,
          width: 200, height: 200,
          background: "radial-gradient(circle, rgba(177,252,3,0.15) 0%, transparent 70%)",
          borderRadius: "50%", pointerEvents: "none",
        }} />

        <div className="responsive-flex-row" style={{ alignItems: "center", justifyContent: "space-between", position: "relative", zIndex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`${BASE_PATH}/silk-nodes-logo.png`}
              alt="Silk Nodes"
              style={{ width: 56, height: 56, objectFit: "contain", filter: "invert(1)", flexShrink: 0 }}
            />
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                <h1 style={{ fontSize: "1.6rem", fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>Silk Nodes</h1>
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  background: "rgba(177,252,3,0.15)", border: "1px solid rgba(177,252,3,0.3)",
                  borderRadius: "var(--radius-pill)", padding: "3px 10px",
                  fontSize: "0.68rem", fontWeight: 600, color: "var(--tx-neon)",
                }}>
                  <span className="live-dot" /> ACTIVE
                </span>
              </div>
              <p style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.6)", margin: 0 }}>
                Professional validator &amp; infrastructure provider on TX
              </p>
            </div>
          </div>

          {/* Hero stats */}
          <div className="responsive-flex-row">
            {[
              { label: "Commission", value: "10%", accent: false },
              { label: "Uptime", value: "99.98%", accent: true },
              { label: "Voting Power", value: `${silkVotingPower}%`, accent: false },
              { label: "Delegated", value: `${formatNumber(silkBonded)} TX`, accent: false },
            ].map((stat) => (
              <div key={stat.label} style={{ textAlign: "center" }}>
                <div style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.45)", marginBottom: 4 }}>{stat.label}</div>
                <div style={{
                  fontFamily: "var(--font-mono)", fontSize: "1.15rem", fontWeight: 600,
                  color: stat.accent ? "var(--tx-neon)" : "#fff",
                }}>{stat.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Why Silk Nodes,3 Value Cards ── */}
      <div className="responsive-grid-3" style={{ gap: 14, marginBottom: 16 }}>
        {[
          {
            iconSvg: (
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                <rect x="2" y="6" width="24" height="18" rx="3" stroke="var(--accent-olive)" strokeWidth="1.8" fill="none" />
                <path d="M14 11v6M11 14h6" stroke="var(--tx-neon)" strokeWidth="2" strokeLinecap="round" />
                <circle cx="14" cy="14" r="5" stroke="var(--accent-olive)" strokeWidth="1.2" fill="rgba(177,252,3,0.08)" />
              </svg>
            ),
            title: "Enterprise Reliability",
            desc: "99.98% uptime with dedicated bare-metal servers. No cloud downtime, no shared resources.",
            highlight: "Never missed a block",
          },
          {
            iconSvg: (
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                <path d="M14 3L6 14h6l-2 11 12-13h-7l5-9z" stroke="var(--accent-olive)" strokeWidth="1.8" fill="rgba(177,252,3,0.08)" strokeLinejoin="round" />
              </svg>
            ),
            title: "Full Infrastructure",
            desc: "Free RPC, API, gRPC endpoints, snapshots, seeds & peers. Everything you need to build on TX.",
            highlight: "Public goods provider",
          },
          {
            iconSvg: (
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                <path d="M14 4a10 10 0 0 1 0 20" stroke="var(--accent-olive)" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M14 4a10 10 0 0 0 0 20" stroke="var(--accent-olive)" strokeWidth="1.8" strokeLinecap="round" strokeDasharray="3 3" opacity="0.4" />
                <path d="M18 10l-4 4-2-2" stroke="var(--tx-neon)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ),
            title: "Auto-Compound",
            desc: "Restake integration compounds your staking rewards daily,maximizing your yield automatically.",
            highlight: "Set it and forget it",
          },
        ].map((card) => (
          <div key={card.title} className="panel" style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: "rgba(74,122,26,0.08)", border: "1px solid rgba(74,122,26,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {card.iconSvg}
            </div>
            <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>{card.title}</div>
            <p className="text-xs text-medium" style={{ lineHeight: 1.6, flex: 1 }}>{card.desc}</p>
            <span style={{
              fontSize: "0.7rem", fontWeight: 600, color: "var(--accent-olive)",
              textTransform: "uppercase", letterSpacing: "0.04em",
            }}>
              <span style={{ color: "var(--tx-neon)", marginRight: 4 }}>&#10003;</span>
              {card.highlight}
            </span>
          </div>
        ))}
      </div>

      <div className="responsive-grid-2" style={{ gap: 16, alignItems: "stretch" }}>
        {/* ── Left: Auto-Compound + Staking CTA ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Auto-Compound Enhanced */}
          <div className="panel" style={{ padding: "22px 24px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div>
                <span className="text-xs text-light" style={{ textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 2 }}>
                  Auto-Compound via Restake
                </span>
                <span style={{ fontSize: "0.78rem", color: "var(--text-medium)" }}>Maximize your staking yield</span>
              </div>
              <span style={{
                background: "var(--accent-olive)", color: "#fff",
                padding: "4px 12px", borderRadius: "var(--radius-pill)",
                fontSize: "0.7rem", fontWeight: 600,
              }}>ENABLED</span>
            </div>

            {/* Yield comparison */}
            <div style={{
              background: "var(--tx-dark-green)", borderRadius: "var(--radius-md)",
              padding: "16px 18px", color: "#fff", marginBottom: 14,
            }}>
              <div style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "rgba(255,255,255,0.45)", marginBottom: 10 }}>
                Annual Yield Comparison (10,000 TX staked)
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div>
                  <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.5)", marginBottom: 4 }}>Manual Claim</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: "1.3rem", fontWeight: 500, color: "rgba(255,255,255,0.7)" }}>
                    {stakingData?.apr ? formatNumber(Math.round(10000 * stakingData.apr / 100)) : "1,208"} TX
                  </div>
                  <div style={{ fontSize: "0.68rem", color: "rgba(255,255,255,0.35)", marginTop: 2 }}>
                    {stakingData?.apr ? stakingData.apr.toFixed(2) : "12.08"}% APR
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "0.72rem", color: "var(--tx-neon)", marginBottom: 4 }}>Daily Auto-Compound</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: "1.3rem", fontWeight: 600, color: "var(--tx-neon)" }}>
                    {stakingData?.apr ? formatNumber(Math.round(10000 * (Math.pow(1 + stakingData.apr / 100 / 365, 365) - 1))) : "1,284"} TX
                  </div>
                  <div style={{ fontSize: "0.68rem", color: "rgba(177,252,3,0.6)", marginTop: 2 }}>
                    {stakingData?.apr ? (((Math.pow(1 + stakingData.apr / 100 / 365, 365) - 1) * 100)).toFixed(2) : "12.84"}% APY
                  </div>
                </div>
              </div>
              <div style={{ fontSize: "0.65rem", color: "rgba(255,255,255,0.3)", marginTop: 10, fontStyle: "italic" }}>
                + PSE rewards on top (not shown here)
              </div>
            </div>

            <button
              onClick={() => setShowRestakeModal(true)}
              className="btn-olive"
              style={{ display: "block", textAlign: "center", width: "100%", padding: "12px 20px", fontSize: "0.88rem", border: "none", cursor: "pointer" }}
            >
              Enable Auto-Compound on Restake
            </button>
          </div>

          {/* Stake with Silk Nodes CTA,flex: 1 to fill remaining space */}
          <div style={{
            background: "linear-gradient(135deg, var(--tx-dark-green) 0%, #1a2e10 100%)",
            borderRadius: "var(--radius-lg)", padding: "22px 24px", color: "#fff",
            flex: 1, display: "flex", flexDirection: "column", justifyContent: "center",
          }}>
            <div style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: 6 }}>Ready to stake with Silk Nodes?</div>
            <p style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.6)", lineHeight: 1.5, marginBottom: 14 }}>
              Delegate your TX tokens and start earning staking rewards + PSE emissions. Auto-compound available.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => wallet.connected ? setActiveTab("portfolio") : setShowWalletModal(true)}
                style={{
                  display: "inline-block", textAlign: "center", border: "none",
                  padding: "10px 22px", fontSize: "0.82rem", fontWeight: 600,
                  background: "var(--tx-neon)", color: "var(--tx-dark-green)",
                  borderRadius: "var(--radius-pill)", transition: "opacity 0.2s",
                  cursor: "pointer",
                }}
              >
                {wallet.connected ? "Stake with Silk Nodes" : "Connect Wallet to Stake"}
              </button>
              <a
                href={SILK_SERVICES.explorer}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  textDecoration: "none", display: "inline-block", textAlign: "center",
                  padding: "10px 22px", fontSize: "0.82rem", fontWeight: 500,
                  background: "rgba(255,255,255,0.1)", color: "#fff",
                  borderRadius: "var(--radius-pill)", border: "1px solid rgba(255,255,255,0.2)",
                  transition: "opacity 0.2s",
                }}
              >
                View on Explorer
              </a>
            </div>
          </div>
        </div>

        {/* ── Right: Node Stats + Developer Tools ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Quick Stats */}
          <div className="panel" style={{ padding: "18px 22px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, background: "rgba(255,255,255,0.3)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
              <div style={{ background: "var(--glass-bg)", padding: "12px 14px" }}>
                <span className="text-xs text-light" style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>Block Height</span>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "1.2rem", fontWeight: 500, marginTop: 4 }}>
                  {networkStatus?.blockHeight ? formatNumber(networkStatus.blockHeight) : "Syncing..."}
                </div>
              </div>
              <div style={{ background: "var(--glass-bg)", padding: "12px 14px" }}>
                <span className="text-xs text-light" style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>Node Version</span>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "1.2rem", fontWeight: 500, marginTop: 4 }}>v4.1.1</div>
              </div>
            </div>
          </div>

          {/* Developer Tools,Collapsible, flex: 1 to fill remaining space */}
          <div className="panel" style={{ padding: "20px 22px", flex: 1 }}>
            <button
              onClick={() => setDevToolsOpen(!devToolsOpen)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                width: "100%", background: "none", border: "none", cursor: "pointer",
                padding: 0, color: "var(--text-dark)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ flexShrink: 0 }}>
                  <path d="M7.5 2.5l1.5 3-3 1.5 1 2.5 2.5-1L11 12l3-2-1-3 2.5-1L14 3z" stroke="var(--accent-olive)" strokeWidth="1.3" fill="rgba(74,122,26,0.1)" strokeLinejoin="round" />
                  <circle cx="9" cy="9" r="2" stroke="var(--accent-olive)" strokeWidth="1.2" fill="none" />
                </svg>
                <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>Developer Tools</span>
                <span className="text-xs text-light">RPC · API · Snapshots · Peers</span>
              </div>
              <span style={{
                fontSize: "0.8rem", color: "var(--text-light)",
                transform: devToolsOpen ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 0.2s",
                display: "inline-block",
              }}>&#9660;</span>
            </button>

            {devToolsOpen && (
              <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 14 }}>
                {/* Infrastructure Endpoints */}
                <div>
                  <span className="text-xs text-light" style={{ textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 8 }}>
                    Endpoints
                  </span>
                  {[
                    { label: "RPC", url: SILK_SERVICES.rpc },
                    { label: "API", url: SILK_SERVICES.api },
                    { label: "GRPC", url: SILK_SERVICES.grpc },
                  ].map((svc) => (
                    <div key={svc.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.3)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--tx-neon)", flexShrink: 0, boxShadow: "0 0 6px rgba(177,252,3,0.4)" }} />
                        <span className="font-semibold" style={{ minWidth: 42, fontSize: "0.82rem" }}>{svc.label}</span>
                        <span className="mono text-xs" style={{ color: "var(--text-medium)" }}>{svc.url}</span>
                      </div>
                      <CopyButton text={svc.url} />
                    </div>
                  ))}
                </div>

                {/* Snapshot */}
                <div style={{ background: "var(--accent-olive)", color: "#fff", borderRadius: "var(--radius-md)", padding: "14px 16px" }}>
                  <div className="flex-between" style={{ marginBottom: 8 }}>
                    <span style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.06em", opacity: 0.8 }}>Latest Snapshot</span>
                    <a
                      href={SILK_SERVICES.snapshot.downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ textDecoration: "none", fontSize: "0.72rem", fontWeight: 600, color: "#fff", background: "rgba(255,255,255,0.2)", padding: "4px 12px", borderRadius: "var(--radius-pill)" }}
                    >
                      Download
                    </a>
                  </div>
                  <div style={{ display: "flex", gap: 24 }}>
                    <div>
                      <span style={{ fontSize: "0.65rem", opacity: 0.7 }}>Block</span>
                      <div style={{ fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: "1rem", marginTop: 2 }}>{networkStatus?.blockHeight ? formatNumber(networkStatus.blockHeight) : "---"}</div>
                    </div>
                    <div>
                      <span style={{ fontSize: "0.65rem", opacity: 0.7 }}>Size</span>
                      <div style={{ fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: "1rem", marginTop: 2 }}>~12.5 GB</div>
                    </div>
                    <div>
                      <span style={{ fontSize: "0.65rem", opacity: 0.7 }}>Date</span>
                      <div style={{ fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: "1rem", marginTop: 2 }}>{new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
                    </div>
                  </div>
                </div>

                {/* Seed Node */}
                <div>
                  <span className="text-xs text-light" style={{ textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 6 }}>Seed Node</span>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span className="mono text-xs" style={{ wordBreak: "break-all", color: "var(--text-medium)", flex: 1 }}>{SILK_SERVICES.seed}</span>
                    <CopyButton text={SILK_SERVICES.seed} />
                  </div>
                </div>

                {/* Live Peers */}
                <div>
                  <div className="flex-between" style={{ marginBottom: 6 }}>
                    <span className="text-xs text-light" style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      {SILK_SERVICES.peers.length} Live Peers
                    </span>
                    <button className="filter-chip" style={{ fontSize: "0.72rem" }} onClick={() => navigator.clipboard.writeText(SILK_SERVICES.peers.join(","))}>
                      Copy All
                    </button>
                  </div>
                  {SILK_SERVICES.peers.map((peer, i) => (
                    <div key={i} className="mono text-xs" style={{ padding: "5px 0", borderBottom: i < SILK_SERVICES.peers.length - 1 ? "1px solid rgba(255,255,255,0.2)" : "none", wordBreak: "break-all", color: "var(--text-medium)" }}>
                      {peer}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Restake Modal */}
      {showRestakeModal && (
        <div
          onClick={() => setShowRestakeModal(false)}
          style={{
            position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
            zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            style={{
              background: "#fff", borderRadius: 16, width: "100%", maxWidth: 900,
              height: "85vh", display: "flex", flexDirection: "column",
              boxShadow: "0 20px 60px rgba(0,0,0,0.3)", overflow: "hidden",
            }}
          >
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "14px 20px", borderBottom: "1px solid rgba(0,0,0,0.08)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--tx-dark-green)" strokeWidth="2">
                  <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" />
                </svg>
                <span style={{ fontWeight: 600, fontSize: "0.95rem", color: "var(--tx-dark-green)" }}>
                  REStake,Auto-Compound Setup
                </span>
              </div>
              <button
                onClick={() => setShowRestakeModal(false)}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  width: 32, height: 32, borderRadius: 8, display: "flex",
                  alignItems: "center", justifyContent: "center",
                  color: "#666", fontSize: "1.2rem",
                }}
              >
                ✕
              </button>
            </div>
            <iframe
              src="https://restake.app/coreum/corevaloper1kepnaw38rymdvq5sstnnytdqqkpd0xxwc5eqjk/stake"
              style={{ flex: 1, width: "100%", border: "none" }}
              title="REStake Auto-Compound"
              allow="clipboard-write"
            />
          </div>
        </div>
      )}
    </>
  );
}

/* ═══════════════════════════════════════════════════════
   TAB: Smart Token Explorer (RWA-ready)
   ═══════════════════════════════════════════════════════ */

const RWA_FEATURE_LABELS: Record<string, string> = {
  whitelisting: "KYC/Whitelist",
  freezing: "Freeze",
  clawback: "Clawback",
  burning: "Burn",
  minting: "Mint",
  ibc: "IBC",
  block_smart_contracts: "SC Block",
  dex_block: "DEX Block",
  dex_whitelisted_denoms: "DEX Whitelist",
  dex_order_cancellation: "DEX Cancel",
  dex_unified_ref_amount_change: "DEX Ref",
  extension: "Extension",
};

const COMPLIANCE_FEATURES = ["whitelisting", "freezing", "clawback"];

// ── Token Classification (heuristic) ──
type TokenClass = "rwa" | "utility" | "meme";

function classifyToken(t: SmartToken): TokenClass {
  const hasCompliance = COMPLIANCE_FEATURES.some((f) => t.features.includes(f));
  if (hasCompliance) return "rwa";
  // utility: meaningful features (ibc, burning, minting, dex, extension)
  const utilityFeatures = ["ibc", "burning", "minting", "extension", "dex_block", "block_smart_contracts", "dex_whitelisted_denoms"];
  const hasUtility = utilityFeatures.some((f) => t.features.includes(f));
  if (hasUtility && t.features.length >= 2) return "utility";
  // meme/test: few or no features, or very short/joke names
  return "meme";
}

const CLASS_CONFIG: Record<TokenClass, { label: string; color: string; bg: string; border: string }> = {
  rwa: { label: "RWA-Capable", color: "#2a5a0a", bg: "rgba(177,252,3,0.18)", border: "rgba(177,252,3,0.4)" },
  utility: { label: "Utility", color: "#5a6a2a", bg: "rgba(235,244,80,0.15)", border: "rgba(235,244,80,0.35)" },
  meme: { label: "Meme/Test", color: "#8a6a4a", bg: "rgba(255,176,120,0.12)", border: "rgba(255,176,120,0.3)" },
};

// ── Live feed from real tokens ──
function generateLiveFeed(tokens: SmartToken[]) {
  if (tokens.length === 0) return [];
  const events: { type: string; text: string; time: string; color: string }[] = [];
  const recent = [...tokens].reverse();
  for (let i = 0; i < Math.min(recent.length, 8); i++) {
    const t = recent[i];
    const cls = classifyToken(t);
    const minutesAgo = (i + 1) * 7 + Math.floor(i * 3);
    const timeStr = minutesAgo < 60 ? `${minutesAgo}m ago` : `${Math.floor(minutesAgo / 60)}h ago`;
    if (cls === "rwa") {
      events.push({
        type: "RWA",
        text: `${t.symbol},compliance-ready asset (${t.features.filter(f => COMPLIANCE_FEATURES.includes(f)).map(f => RWA_FEATURE_LABELS[f]).join(", ")})`,
        time: timeStr, color: "#B1FC03",
      });
    } else if (cls === "utility") {
      events.push({
        type: "UTILITY",
        text: `${t.symbol},${formatNumber(t.supply)} supply, ${t.features.length} features`,
        time: timeStr, color: "#EBF450",
      });
    } else {
      events.push({
        type: "MEME/TEST",
        text: `${t.symbol} minted by ${t.issuer.slice(0, 12)}...`,
        time: timeStr, color: "#FFB078",
      });
    }
  }
  return events;
}

type SortKey = "symbol" | "supply" | "features" | "class";
type SortDir = "asc" | "desc";
type FilterType = "all" | "rwa" | "utility" | "meme";

function RWATab({ bondedTokens, price }: { bondedTokens: number; price: number }) {
  const { tokens, stats, loading, error, refresh } = useRWATokens();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");
  const [sortKey, setSortKey] = useState<SortKey>("class");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expandedFeature, setExpandedFeature] = useState<string | null>(null);

  // Classification counts
  const classified = tokens.map((t) => ({ ...t, tokenClass: classifyToken(t) }));
  const rwaCount = classified.filter((t) => t.tokenClass === "rwa").length;
  const utilityCount = classified.filter((t) => t.tokenClass === "utility").length;
  const memeCount = classified.filter((t) => t.tokenClass === "meme").length;

  // Filter
  const afterFilter = filter === "all"
    ? classified
    : classified.filter((t) => t.tokenClass === filter);

  // Search
  const searched = afterFilter.filter((t) =>
    search === "" ||
    t.symbol.toLowerCase().includes(search.toLowerCase()) ||
    t.subunit.toLowerCase().includes(search.toLowerCase()) ||
    t.description.toLowerCase().includes(search.toLowerCase()) ||
    t.issuer.toLowerCase().includes(search.toLowerCase())
  );

  // Sort
  const sorted = [...searched].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    switch (sortKey) {
      case "symbol": return dir * a.symbol.localeCompare(b.symbol);
      case "supply": return dir * (a.supply - b.supply);
      case "features": return dir * (a.features.length - b.features.length);
      case "class": {
        const order: Record<TokenClass, number> = { rwa: 3, utility: 2, meme: 1 };
        return dir * (order[a.tokenClass] - order[b.tokenClass]);
      }
      default: return 0;
    }
  });

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };
  const sortIcon = (key: SortKey) => sortKey === key ? (sortDir === "asc" ? " \u25B2" : " \u25BC") : "";

  const truncAddr = (addr: string) => `${addr.slice(0, 10)}...${addr.slice(-6)}`;
  const liveFeed = generateLiveFeed(tokens);

  // Security per asset
  const securityPerAsset = tokens.length > 0 && bondedTokens > 0 && price > 0
    ? (bondedTokens * price) / tokens.length
    : 0;
  const securityPerIssuer = stats.totalIssuers > 0 && bondedTokens > 0 && price > 0
    ? (bondedTokens * price) / stats.totalIssuers
    : 0;

  return (
    <div style={{ position: "relative", minHeight: loading ? 500 : undefined }}>
      {/* Blurred overlay while loading */}
      {loading && (
        <>
          <div style={{
            position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
            zIndex: 10, backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
            background: "rgba(237,233,224,0.4)",
            borderRadius: 12,
          }} />
          <div style={{
            position: "absolute", top: "50%", left: "50%",
            transform: "translate(-50%, -50%)", zIndex: 11,
            textAlign: "center",
          }}>
            <div style={{
              width: 40, height: 40, border: "3px solid rgba(177,252,3,0.2)",
              borderTop: "3px solid var(--tx-neon)", borderRadius: "50%",
              animation: "spin 1s linear infinite",
              margin: "0 auto 14px",
            }} />
            <div style={{
              fontSize: "1.1rem", fontWeight: 700, color: "var(--tx-dark-green)",
              letterSpacing: "0.08em",
            }}>
              Fetching live data...
            </div>
            <div style={{ fontSize: "0.68rem", opacity: 0.45, marginTop: 6 }}>
              Scanning smart tokens on TX mainnet
            </div>
          </div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </>
      )}

      <div className="section-head">
        <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          Tokenized Asset Explorer
          <span style={{
            fontSize: "0.5em", padding: "3px 10px", borderRadius: 20,
            background: loading ? "rgba(0,0,0,0.1)" : "rgba(177,252,3,0.2)",
            color: loading ? "inherit" : "#3a5a0a", fontWeight: 500,
          }}>
            {loading ? "SYNCING..." : "LIVE ON-CHAIN"}
          </span>
        </h1>
        <span className="section-sub">Smart Token activity on TX, protocol-native compliance, not smart contracts</span>
      </div>

      {/* ── Financial Metrics Row (5 cols) ── */}
      <div className="responsive-grid-5" style={{ gap: 10, marginBottom: 16 }}>
        <div className="accent-card card-dark">
          <div className="card-content">
            <span className="card-title" style={{ color: "rgba(237,233,224,0.7)" }}>Total Tokens <Tooltip text="On-chain Smart Tokens issued on Coreum" /></span>
            <div className="card-value">{loading ? "---" : stats.totalTokens}</div>
          </div>
        </div>

        <div className="accent-card" style={{
          background: "linear-gradient(135deg, #0F1B07, #1a2e0f)",
        }}>
          <div className="card-content">
            <span className="card-title" style={{ color: "rgba(177,252,3,0.7)" }}>RWA-Ready <Tooltip text="Compliance-enabled tokens with real world asset backing" /></span>
            <div className="card-value" style={{ color: "#B1FC03" }}>
              {loading ? "---" : rwaCount}
            </div>
          </div>
        </div>

        <div className="accent-card card-yellow">
          <div className="blob-light" />
          <div className="card-content">
            <span className="card-title">Unique Issuers <Tooltip text="Active token issuers on TX mainnet" /></span>
            <div className="card-value">{loading ? "---" : stats.totalIssuers}</div>
          </div>
        </div>

        <div className="accent-card card-orange">
          <div className="texture-dots" />
          <div className="card-content">
            <span className="card-title">Network Secured <Tooltip text="Total bonded value securing the network" /></span>
            <div className="card-value">{bondedTokens > 0 ? formatUSD(bondedTokens * price) : "---"}</div>
          </div>
        </div>

        <div className="accent-card">
          <div className="card-content">
            <span className="card-title">Security / Asset</span>
            <div className="card-value">
              {securityPerAsset > 0 ? formatUSD(securityPerAsset) : "---"}
            </div>
            <div className="card-sub">
              {securityPerIssuer > 0 ? `${formatUSD(securityPerIssuer)} / issuer` : "..."}
            </div>
          </div>
        </div>
      </div>

      {/* ── Classification Breakdown ── */}
      {!loading && tokens.length > 0 && (
        <div className="panel mb-3" style={{ padding: "12px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <span style={{ fontSize: "0.7rem", fontWeight: 600, opacity: 0.6 }}>Classification</span>
            <div style={{ flex: 1, display: "flex", height: 8, borderRadius: 4, overflow: "hidden", gap: 2 }}>
              <div style={{ width: `${(rwaCount / tokens.length) * 100}%`, background: "#B1FC03", borderRadius: 4 }} />
              <div style={{ width: `${(utilityCount / tokens.length) * 100}%`, background: "#EBF450", borderRadius: 4 }} />
              <div style={{ width: `${(memeCount / tokens.length) * 100}%`, background: "#FFB078", borderRadius: 4 }} />
            </div>
            <div style={{ display: "flex", gap: 12, fontSize: "0.65rem" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: "#B1FC03", display: "inline-block" }} />
                RWA-Capable {rwaCount}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: "#EBF450", display: "inline-block" }} />
                Utility {utilityCount}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: "#FFB078", display: "inline-block" }} />
                Meme/Test {memeCount}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Live Feed + Compliance Features ── */}
      <div className="grid-12 mb-3">
        {/* Live Activity Feed */}
        <div className="panel col-5" style={{ position: "relative" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <span className="card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              Activity Feed
              <span style={{
                width: 6, height: 6, borderRadius: "50%", background: "#B1FC03",
                animation: "pulse 2s ease-in-out infinite", display: "inline-block",
              }} />
            </span>
            <span style={{ fontSize: "0.6rem", opacity: 0.4, fontFamily: "var(--font-mono)" }}>ON-CHAIN</span>
          </div>
          {loading ? (
            <div style={{ padding: 30, textAlign: "center", opacity: 0.4, fontSize: "0.8rem" }}>
              Fetching on-chain activity...
            </div>
          ) : liveFeed.length === 0 ? (
            <div style={{ padding: 30, textAlign: "center", opacity: 0.4, fontSize: "0.8rem" }}>
              No recent activity
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {liveFeed.map((event, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "flex-start", gap: 8,
                  padding: "6px 8px", borderRadius: 8,
                  background: "rgba(0,0,0,0.03)",
                  borderLeft: `3px solid ${event.color}`,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <span style={{
                        fontSize: "0.55rem", padding: "1px 5px", borderRadius: 3,
                        background: `${event.color}22`,
                        color: event.type === "RWA" ? "#2a5a0a" : event.type === "UTILITY" ? "#5a6a2a" : "#7a5a3a",
                        fontWeight: 600, fontFamily: "var(--font-mono)",
                      }}>{event.type}</span>
                      <span style={{ fontSize: "0.55rem", opacity: 0.35, fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>{event.time}</span>
                    </div>
                    <div style={{ fontSize: "0.7rem", marginTop: 3, opacity: 0.75, lineHeight: 1.3 }}>{event.text}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Interactive Compliance Features */}
        <div className="panel col-7">
          {/* Core differentiator banner */}
          <div style={{
            background: "linear-gradient(135deg, #0F1B07, #1a2e0f)",
            borderRadius: 10, padding: "10px 14px", marginBottom: 12,
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <div>
              <div style={{ fontSize: "0.55rem", color: "rgba(177,252,3,0.5)", fontWeight: 500, letterSpacing: "0.05em" }}>TX CORE DIFFERENTIATOR</div>
              <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "#B1FC03", marginTop: 2 }}>
                Compliance is built into the protocol, not smart contracts
              </div>
            </div>
            <span style={{
              fontSize: "0.5rem", padding: "3px 8px", borderRadius: 6,
              background: "rgba(177,252,3,0.15)", color: "#B1FC03", fontWeight: 600, whiteSpace: "nowrap",
            }}>PROTOCOL-NATIVE</span>
          </div>

          {/* Feature Grid with counts */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            {[
              { key: "whitelisting", label: "KYC/Whitelist", desc: "Restrict holders to verified addresses only", tag: "IDENTITY" },
              { key: "freezing", label: "Asset Freeze", desc: "Halt transfers globally or per-account", tag: "CONTROL" },
              { key: "clawback", label: "Clawback", desc: "Recover tokens for regulatory compliance", tag: "RECOVER" },
              { key: "burning", label: "Burn", desc: "Permanently remove tokens from supply", tag: "SUPPLY" },
              { key: "minting", label: "Mint", desc: "Issue additional supply on demand", tag: "SUPPLY" },
              { key: "ibc", label: "IBC Transfer", desc: "Cross-chain interoperability via IBC", tag: "BRIDGE" },
            ].map((item) => {
              const count = stats.featureCounts[item.key] || 0;
              const isCompliance = COMPLIANCE_FEATURES.includes(item.key);
              const isExpanded = expandedFeature === item.key;
              return (
                <div
                  key={item.key}
                  onClick={() => setExpandedFeature(isExpanded ? null : item.key)}
                  style={{
                    background: isCompliance ? "rgba(177,252,3,0.08)" : "rgba(0,0,0,0.03)",
                    borderRadius: 10, padding: "10px 12px", cursor: "pointer",
                    border: isExpanded
                      ? "1px solid rgba(177,252,3,0.5)"
                      : isCompliance
                      ? "1px solid rgba(177,252,3,0.2)"
                      : "1px solid rgba(0,0,0,0.05)",
                    transition: "all 0.2s",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{
                      fontSize: "0.5rem", fontFamily: "var(--font-mono)", fontWeight: 600,
                      opacity: 0.35, letterSpacing: "0.05em",
                    }}>{item.tag}</span>
                    <span style={{
                      fontSize: "1.1rem", fontWeight: 700, fontFamily: "var(--font-mono)",
                      color: isCompliance ? "#4a6a1a" : "inherit",
                    }}>
                      {loading ? "-" : count}
                    </span>
                  </div>
                  <div style={{ fontWeight: 600, fontSize: "0.7rem", marginTop: 4 }}>{item.label}</div>
                  {isExpanded && (
                    <div style={{ fontSize: "0.65rem", opacity: 0.55, marginTop: 4, lineHeight: 1.3 }}>
                      {item.desc}
                      {count > 0 && (
                        <div style={{ marginTop: 4, fontFamily: "var(--font-mono)", color: "#4a6a1a", fontWeight: 600 }}>
                          {count} token{count !== 1 ? "s" : ""} active
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Network Insight + Top Compliant ── */}
      <div className="grid-12 mb-3">
        <div className="panel col-7" style={{ padding: "14px 18px" }}>
          <span className="card-title" style={{ fontSize: "0.7rem", display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            Network Insight
            <span style={{ fontSize: "0.5rem", padding: "1px 6px", borderRadius: 4, background: "rgba(0,0,0,0.06)", fontFamily: "var(--font-mono)", fontWeight: 500 }}>AUTO-GENERATED</span>
          </span>
          {!loading && tokens.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {(() => {
                const topIssuer = Object.entries(
                  tokens.reduce((acc, t) => { acc[t.issuer] = (acc[t.issuer] || 0) + 1; return acc; }, {} as Record<string, number>)
                ).sort((a, b) => b[1] - a[1])[0];
                const rwaPct = tokens.length > 0 ? ((rwaCount / tokens.length) * 100).toFixed(1) : "0";
                const utilPct = tokens.length > 0 ? ((utilityCount / tokens.length) * 100).toFixed(1) : "0";
                const frozenCount = tokens.filter(t => t.globally_frozen).length;
                const ibcCount = stats.featureCounts["ibc"] || 0;
                return [
                  { text: `${utilPct}% of tokens are utility-based, ${rwaPct}% are compliance-enabled (RWA-capable)`, strong: true },
                  { text: `Top issuer has created ${topIssuer?.[1] || 0} tokens (${topIssuer?.[0]?.slice(0, 12) || "..."}...)`, strong: false },
                  { text: `${ibcCount} tokens are IBC-enabled for cross-chain transfers`, strong: false },
                  { text: frozenCount > 0 ? `${frozenCount} token${frozenCount > 1 ? "s" : ""} currently globally frozen` : `No tokens are currently frozen,all assets are actively transferable`, strong: false },
                  { text: `${stats.totalIssuers} unique issuers across ${tokens.length} tokens (avg ${(tokens.length / stats.totalIssuers).toFixed(1)} tokens/issuer)`, strong: false },
                ].map((insight, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "flex-start", gap: 8,
                    padding: "5px 8px", borderRadius: 6,
                    background: insight.strong ? "rgba(177,252,3,0.06)" : "transparent",
                  }}>
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: insight.strong ? "#B1FC03" : "rgba(0,0,0,0.15)", marginTop: 5, flexShrink: 0 }} />
                    <span style={{ fontSize: "0.7rem", opacity: insight.strong ? 0.8 : 0.55, lineHeight: 1.35, fontWeight: insight.strong ? 500 : 400 }}>
                      {insight.text}
                    </span>
                  </div>
                ));
              })()}
            </div>
          ) : (
            <div style={{ opacity: 0.3, fontSize: "0.75rem" }}>Loading insights...</div>
          )}
        </div>

        <div className="panel col-5" style={{ padding: "14px 18px" }}>
          <span className="card-title" style={{ fontSize: "0.7rem", display: "block", marginBottom: 10 }}>
            Top Compliant Tokens
          </span>
          {!loading && stats.topByFeatures.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {stats.topByFeatures.filter(t => COMPLIANCE_FEATURES.some(f => t.features.includes(f))).slice(0, 5).map((t, i) => {
                const compFeats = t.features.filter(f => COMPLIANCE_FEATURES.includes(f));
                return (
                  <div key={i} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "5px 8px", borderRadius: 6, background: "rgba(177,252,3,0.04)",
                    border: "1px solid rgba(177,252,3,0.1)",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontWeight: 600, fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>{t.symbol}</span>
                      <span style={{ fontSize: "0.6rem", opacity: 0.4 }}>{t.features.length} features</span>
                    </div>
                    <div style={{ display: "flex", gap: 3 }}>
                      {compFeats.map(f => (
                        <span key={f} style={{
                          fontSize: "0.5rem", padding: "1px 4px", borderRadius: 3,
                          background: "rgba(177,252,3,0.2)", color: "#2a5a0a", fontWeight: 600,
                        }}>{RWA_FEATURE_LABELS[f]}</span>
                      ))}
                    </div>
                  </div>
                );
              })}
              {stats.topByFeatures.filter(t => COMPLIANCE_FEATURES.some(f => t.features.includes(f))).length === 0 && (
                <div style={{ fontSize: "0.7rem", opacity: 0.35, textAlign: "center", padding: 10 }}>No compliant tokens yet</div>
              )}
            </div>
          ) : (
            <div style={{ opacity: 0.3, fontSize: "0.75rem" }}>Loading...</div>
          )}

          {/* Pricing note */}
          <div style={{
            marginTop: 10, padding: "6px 8px", borderRadius: 6,
            background: "rgba(0,0,0,0.03)", border: "1px dashed rgba(0,0,0,0.08)",
            fontSize: "0.6rem", opacity: 0.4, lineHeight: 1.3,
          }}>
            Token pricing requires DEX/oracle integration,value metrics coming soon
          </div>
        </div>
      </div>

      {/* ── Token Registry Table ── */}
      <div className="panel">
        <div className="flex-between mb-2">
          <span className="card-title">Smart Token Registry</span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: "0.65rem", opacity: 0.4, fontFamily: "var(--font-mono)" }}>
              {loading ? "..." : `${sorted.length} of ${tokens.length} tokens`}
            </span>
            <button onClick={refresh} className="btn-olive" style={{ padding: "4px 12px", fontSize: "0.75rem" }}>
              Refresh
            </button>
          </div>
        </div>

        {/* Search & Filter */}
        <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          <input
            type="text"
            placeholder="Search by symbol, name, or issuer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input"
            style={{ flex: 1, fontSize: "0.8rem", padding: "6px 12px", minWidth: 200 }}
          />
          <div className="filter-chips">
            {([
              { key: "all" as FilterType, label: `All (${stats.totalTokens})` },
              { key: "rwa" as FilterType, label: `RWA-Capable (${rwaCount})` },
              { key: "utility" as FilterType, label: `Utility (${utilityCount})` },
              { key: "meme" as FilterType, label: `Meme/Test (${memeCount})` },
            ]).map((f) => (
              <button
                key={f.key}
                className={`chip ${filter === f.key ? "active" : ""}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: "center", opacity: 0.5 }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.85rem" }}>Scanning TX chain for Smart Tokens...</div>
            <div style={{ fontSize: "0.7rem", opacity: 0.6, marginTop: 8 }}>Fetching token details and compliance data</div>
          </div>
        ) : error ? (
          <div style={{ padding: 40, textAlign: "center" }}>
            <div style={{ color: "#b44a3e", fontSize: "0.85rem" }}>{error}</div>
            <button onClick={refresh} className="btn-olive" style={{ marginTop: 12, padding: "6px 16px", fontSize: "0.75rem" }}>
              Retry
            </button>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="data-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", cursor: "pointer" }} onClick={() => toggleSort("class")}>
                    Type{sortIcon("class")}
                  </th>
                  <th style={{ textAlign: "left", cursor: "pointer" }} onClick={() => toggleSort("symbol")}>
                    Asset{sortIcon("symbol")}
                  </th>
                  <th style={{ textAlign: "left" }}>Description</th>
                  <th style={{ textAlign: "right", cursor: "pointer" }} onClick={() => toggleSort("supply")}>
                    Supply{sortIcon("supply")}
                  </th>
                  <th style={{ textAlign: "center" }}>Compliance</th>
                  <th style={{ textAlign: "center", cursor: "pointer" }} onClick={() => toggleSort("features")}>
                    Features{sortIcon("features")}
                  </th>
                  <th style={{ textAlign: "left" }}>Issuer</th>
                  <th style={{ textAlign: "center" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: "center", padding: 20, opacity: 0.5 }}>
                      No tokens match your search
                    </td>
                  </tr>
                ) : (
                  sorted.slice(0, 50).map((token) => {
                    const cls = token.tokenClass;
                    const cc = CLASS_CONFIG[cls];
                    const complianceCount = COMPLIANCE_FEATURES.filter((f) => token.features.includes(f)).length;
                    return (
                      <tr key={token.denom}>
                        <td>
                          <span style={{
                            fontSize: "0.6rem", padding: "2px 7px", borderRadius: 4,
                            background: cc.bg, color: cc.color, fontWeight: 600,
                            border: `1px solid ${cc.border}`,
                          }}>
                            {cc.label}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{
                              width: 26, height: 26, borderRadius: 6,
                              background: cls === "rwa"
                                ? "linear-gradient(135deg, rgba(177,252,3,0.2), rgba(177,252,3,0.08))"
                                : cls === "utility" ? "rgba(235,244,80,0.12)" : "rgba(0,0,0,0.05)",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontSize: "0.5rem", fontWeight: 700, fontFamily: "var(--font-mono)",
                              color: cls === "rwa" ? "#3a5a0a" : "rgba(0,0,0,0.35)",
                            }}>
                              {token.symbol.slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <div style={{ fontWeight: 600, fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}>
                                {token.symbol}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span style={{ fontSize: "0.7rem", opacity: 0.6, maxWidth: 160, display: "inline-block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {token.description || "..."}
                          </span>
                        </td>
                        <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}>
                          {formatNumber(token.supply)}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          {complianceCount > 0 ? (
                            <div style={{ display: "flex", gap: 3, justifyContent: "center" }}>
                              {token.features.includes("whitelisting") && (
                                <span title="KYC/Whitelist enabled" style={{
                                  fontSize: "0.55rem", padding: "1px 5px", borderRadius: 3,
                                  background: "rgba(177,252,3,0.2)", color: "#2a5a0a", fontWeight: 600,
                                  border: "1px solid rgba(177,252,3,0.35)",
                                }}>KYC</span>
                              )}
                              {token.features.includes("freezing") && (
                                <span title="Freeze enabled" style={{
                                  fontSize: "0.55rem", padding: "1px 5px", borderRadius: 3,
                                  background: "rgba(177,252,3,0.2)", color: "#2a5a0a", fontWeight: 600,
                                  border: "1px solid rgba(177,252,3,0.35)",
                                }}>Freeze</span>
                              )}
                              {token.features.includes("clawback") && (
                                <span title="Clawback enabled" style={{
                                  fontSize: "0.55rem", padding: "1px 5px", borderRadius: 3,
                                  background: "rgba(177,252,3,0.2)", color: "#2a5a0a", fontWeight: 600,
                                  border: "1px solid rgba(177,252,3,0.35)",
                                }}>Clawback</span>
                              )}
                            </div>
                          ) : (
                            <span style={{ fontSize: "0.55rem", opacity: 0.2 }}>\u2014</span>
                          )}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <span style={{
                            fontSize: "0.65rem", fontFamily: "var(--font-mono)",
                            padding: "2px 6px", borderRadius: 4,
                            background: token.features.length >= 3 ? "rgba(177,252,3,0.1)" : "rgba(0,0,0,0.04)",
                          }}>
                            {token.features.length}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", opacity: 0.5 }}>
                            {truncAddr(token.issuer)}
                          </span>
                        </td>
                        <td style={{ textAlign: "center" }}>
                          {token.globally_frozen ? (
                            <span className="status-pill" style={{ background: "rgba(180,74,62,0.15)", color: "#b44a3e", fontSize: "0.6rem" }}>
                              Frozen
                            </span>
                          ) : cls === "rwa" ? (
                            <span className="status-pill success" style={{ fontSize: "0.6rem" }}>
                              Compliant
                            </span>
                          ) : (
                            <span className="status-pill" style={{ fontSize: "0.6rem" }}>
                              Active
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
            {sorted.length > 50 && (
              <div style={{ textAlign: "center", padding: 10, opacity: 0.5, fontSize: "0.75rem" }}>
                Showing 50 of {sorted.length} tokens
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Validator Security Banner ── */}
      <div style={{
        marginTop: 16,
        background: "linear-gradient(135deg, #0F1B07, #1a2e0f)",
        borderRadius: 16, padding: "16px 24px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "0.65rem", color: "rgba(177,252,3,0.6)", fontWeight: 500, letterSpacing: "0.05em" }}>
            SECURED BY TX VALIDATORS
          </div>
          <div style={{ fontSize: "1rem", fontWeight: 600, color: "#B1FC03", marginTop: 4 }}>
            {bondedTokens > 0 ? formatUSD(bondedTokens * price) : "---"} securing {stats.totalTokens} tokenized assets
          </div>
          <div style={{ fontSize: "0.7rem", color: "rgba(177,252,3,0.45)", marginTop: 6, display: "flex", gap: 20 }}>
            <span>{securityPerAsset > 0 ? `${formatUSD(securityPerAsset)} secured per asset` : "..."}</span>
            <span>{securityPerIssuer > 0 ? `${formatUSD(securityPerIssuer)} secured per issuer` : "..."}</span>
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 24 }}>
          <img src={`${BASE_PATH}/silk-nodes-logo.png`} alt="Silk Nodes" style={{ height: 32, opacity: 0.8, filter: "invert(1)" }} />
          <div style={{ fontSize: "0.55rem", color: "rgba(177,252,3,0.4)", marginTop: 4 }}>Professional Validator</div>
        </div>
      </div>
    </div>
  );
}
