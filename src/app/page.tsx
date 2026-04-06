"use client";

const BASE_PATH = process.env.NODE_ENV === "production" ? "/tx-silknodes" : "";

import { useState, useEffect, useRef, useMemo, useCallback, Fragment } from "react";

// ─── Analytics helper ───
declare global { interface Window { gtag?: (...args: any[]) => void; } }
function trackEvent(action: string, params?: Record<string, any>) {
  if (typeof window !== "undefined" && window.gtag) {
    window.gtag("event", action, params);
  }
}
import { fetchWithTimeout } from "@/lib/chain-config";
import { useTokenData } from "@/hooks/useTokenData";
import { useWallet } from "@/hooks/useWallet";
import {
  getPSEDistributionInfo,
  fetchPSESchedule,
  estimatePSERewardFullPeriod,
  PSE_CONFIG,
  PSE_ALLOCATION,
  PSE_EXCLUDED_ADDRESSES,
} from "@/lib/pse-calculator";
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
  const { tokenData, stakingData, networkStatus, validators, loading } = useTokenData();
  const {
    wallet, connect, disconnect, refresh, claimRewards,
    delegate, undelegate, redelegate,
    loading: walletLoading, error: walletError, clearError,
    txPending, txResult, clearTxResult, availableWallets,
  } = useWallet();
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [cookieConsent, setCookieConsent] = useState<"accepted" | "declined" | null>(null);

  // ─── Cookie consent ───
  useEffect(() => {
    const stored = localStorage.getItem("tx-cookie-consent");
    if (stored === "accepted" || stored === "declined") setCookieConsent(stored);
  }, []);

  const handleCookieConsent = (choice: "accepted" | "declined") => {
    setCookieConsent(choice);
    localStorage.setItem("tx-cookie-consent", choice);
    trackEvent("cookie_consent", { choice });
    if (choice === "declined") {
      // Remove GA cookies
      document.cookie.split(";").forEach((c) => {
        const name = c.trim().split("=")[0];
        if (name.startsWith("_ga")) document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
      });
    }
  };

  // ─── Track successful transactions ───
  useEffect(() => {
    if (txResult) trackEvent("tx_success", { tx_type: txResult.type, tx_hash: txResult.hash });
  }, [txResult]);

  // ─── PSE Countdown State (uses real on-chain distribution schedule) ───
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  const [distributed, setDistributed] = useState(0);
  const startTime = useRef(Date.now());
  const [onChainSchedule, setOnChainSchedule] = useState<number[] | null>(null);
  useEffect(() => {
    fetchPSESchedule().then((schedule) => {
      if (schedule.length > 0) setOnChainSchedule(schedule);
    });
  }, []);
  const pseInfo = useMemo(() => getPSEDistributionInfo(onChainSchedule ?? undefined), [onChainSchedule]);
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
  const [targetPrice, setTargetPrice] = useState("");
  const stakedAmount = parseFloat(stakeInput.replace(/,/g, "")) || 0;

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
  const [addrCopied, setAddrCopied] = useState(false);
  const [showBrandPopover, setShowBrandPopover] = useState(false);
  const [brandClickedOnce, setBrandClickedOnce] = useState(false);
  const brandPopoverRef = useRef<HTMLDivElement>(null);

  const handleBrandClick = () => {
    if (!brandClickedOnce) {
      setShowBrandPopover(true);
      setBrandClickedOnce(true);
      trackEvent("brand_click", { first_time: true });
    } else {
      setActiveTab("overview");
      trackEvent("brand_click", { first_time: false });
    }
  };

  // Close popover on outside click
  useEffect(() => {
    if (!showBrandPopover) return;
    const handler = (e: MouseEvent) => {
      if (brandPopoverRef.current && !brandPopoverRef.current.contains(e.target as Node)) {
        setShowBrandPopover(false);
      }
    };
    setTimeout(() => document.addEventListener("click", handler), 0);
    return () => document.removeEventListener("click", handler);
  }, [showBrandPopover]);
  const copyAddress = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(wallet.address);
    setAddrCopied(true);
    setTimeout(() => setAddrCopied(false), 1500);
  };

  return (
    <div className="app-shell">
      {/* ════════ TOP NAV ════════ */}
      <nav className="top-nav">
        <div className="brand" onClick={handleBrandClick} style={{ cursor: "pointer", position: "relative" }}>
          All in ONE <div className="brand-icon"><img src={`${BASE_PATH}/tx-icon.svg`} alt="TX Network logo" /></div>
          {showBrandPopover && (
            <div
              ref={brandPopoverRef}
              style={{
                position: "absolute", top: "calc(100% + 12px)", left: 0,
                background: "#fff", borderRadius: "var(--radius-lg)",
                padding: "20px 22px", width: "min(380px, calc(100vw - 40px))",
                boxShadow: "0 12px 40px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05)",
                zIndex: 9999, animation: "fadeIn 0.2s ease",
              }}
            >
              <div style={{
                position: "absolute", top: -6, left: 24,
                width: 12, height: 12, background: "#fff",
                transform: "rotate(45deg)",
                boxShadow: "-1px -1px 0 rgba(0,0,0,0.05)",
              }} />
              <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "var(--tx-dark-green)", marginBottom: 8 }}>
                This tool is free and open source
              </div>
              <div style={{ fontSize: "0.78rem", color: "var(--text-medium)", lineHeight: 1.5, marginBottom: 14 }}>
                Built by <strong>Silk Nodes</strong> for the TX community.<br />Support us by delegating ... it keeps this project alive.
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); setShowBrandPopover(false); setActiveTab("silknodes"); trackEvent("brand_popover_delegate"); }}
                className="btn-olive"
                style={{ width: "100%", padding: "10px 16px", fontSize: "0.8rem", fontWeight: 600 }}
              >
                Delegate to Silk Nodes &rarr;
              </button>
              <div style={{ fontSize: "0.62rem", color: "var(--text-light)", textAlign: "center", marginTop: 8 }}>
                5% commission &middot; 99.98% uptime &middot; zero slashing
              </div>
            </div>
          )}
        </div>

        <div className="nav-tabs">
          {TABS.filter((tab) => !tab.walletOnly || wallet.connected).map((tab) => (
            <button
              key={tab.id}
              className={`nav-tab ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => { setActiveTab(tab.id); trackEvent("tab_switch", { tab_name: tab.id }); }}
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
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button
              className={`wallet-pill ${wallet.connected ? "connected" : ""}`}
              onClick={wallet.connected ? disconnect : () => setShowWalletModal(true)}
            >
              {walletLoading ? "Connecting..." : wallet.connected ? truncAddr(wallet.address) : "Connect Wallet"}
            </button>
            {wallet.connected && (
              <button
                onClick={copyAddress}
                title="Copy address"
                style={{
                  background: addrCopied ? "var(--tx-neon)" : "rgba(177,252,3,0.1)",
                  border: "1px solid rgba(177,252,3,0.3)",
                  borderRadius: 6, padding: "6px 8px", cursor: "pointer",
                  fontSize: "0.7rem", color: addrCopied ? "var(--tx-dark-green)" : "var(--text-medium)",
                  fontWeight: 600, transition: "all 0.2s",
                  display: "flex", alignItems: "center", gap: 3,
                }}
              >
                {addrCopied ? "✓" : "📋"}
              </button>
            )}
          </div>
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
                onClick={() => { setShowWalletModal(false); connect("keplr"); trackEvent("wallet_connect", { wallet_type: "keplr" }); }}
                disabled={walletLoading}
                style={{
                  display: "flex", alignItems: "center", gap: 14, padding: "14px 18px",
                  borderRadius: "var(--radius-md)", border: "1px solid var(--glass-border)",
                  background: "var(--glass-bg)", cursor: "pointer", width: "100%",
                  opacity: availableWallets.keplr ? 1 : 0.4, transition: "all 0.15s",
                }}
              >
                <img src={`${BASE_PATH}/keplr-logo.svg`} alt="Keplr wallet logo" style={{ width: 40, height: 40, borderRadius: 10 }} />
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
                onClick={() => { setShowWalletModal(false); connect("leap"); trackEvent("wallet_connect", { wallet_type: "leap" }); }}
                disabled={walletLoading}
                style={{
                  display: "flex", alignItems: "center", gap: 14, padding: "14px 18px",
                  borderRadius: "var(--radius-md)", border: "1px solid var(--glass-border)",
                  background: "var(--glass-bg)", cursor: "pointer", width: "100%",
                  opacity: availableWallets.leap ? 1 : 0.4, transition: "all 0.15s",
                }}
              >
                <img src={`${BASE_PATH}/leap-logo.png`} alt="Leap wallet logo" style={{ width: 40, height: 40, borderRadius: 10 }} />
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
              <button
                onClick={() => { setShowWalletModal(false); connect("cosmostation"); trackEvent("wallet_connect", { wallet_type: "cosmostation" }); }}
                disabled={walletLoading}
                style={{
                  display: "flex", alignItems: "center", gap: 14, padding: "14px 18px",
                  borderRadius: "var(--radius-md)", border: "1px solid var(--glass-border)",
                  background: "var(--glass-bg)", cursor: "pointer", width: "100%",
                  opacity: availableWallets.cosmostation ? 1 : 0.4, transition: "all 0.15s",
                }}
              >
                <img src={`${BASE_PATH}/cosmostation-logo.png`} alt="Cosmostation wallet logo" style={{ width: 40, height: 40, borderRadius: 10 }} />
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>Cosmostation</div>
                  <div style={{ fontSize: "0.7rem", color: "var(--text-light)" }}>
                    {availableWallets.cosmostation ? "Detected" : "Not installed"}
                  </div>
                </div>
                {!availableWallets.cosmostation && (
                  <a href="https://www.cosmostation.io/products/cosmostation_extension" target="_blank" rel="noopener noreferrer"
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
            targetPrice={targetPrice}
            setTargetPrice={setTargetPrice}
            stakedAmount={stakedAmount}
            apr={apr}
            nextPSEReward={nextPSEReward}
            wallet={wallet}
            tokenData={tokenData}
            stakingData={stakingData}
            setActiveTab={setActiveTab}
            pseInfo={pseInfo}
          />
        )}

        {activeTab === "validators" && (
          <ValidatorsTab wallet={wallet} setActiveTab={setActiveTab} setShowWalletModal={setShowWalletModal} />
        )}

        {activeTab === "rwa" && (
          <RWATab bondedTokens={bondedTokens} price={price} setActiveTab={setActiveTab} />
        )}

        {activeTab === "silknodes" && (
          <SilkNodesTab networkStatus={networkStatus} stakingData={stakingData} validators={validators} setActiveTab={setActiveTab} wallet={wallet} setShowWalletModal={setShowWalletModal} />
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
            All in ONE <div className="brand-icon"><img src={`${BASE_PATH}/tx-icon.svg`} alt="TX Network logo" /></div>
          </div>
          <span className="footer-sep">|</span>
          <span className="footer-built">Built by <a href="https://silknodes.io" target="_blank" rel="noopener noreferrer">Silk Nodes</a></span>
        </div>
        <div className="footer-right">
          <span className="footer-public-good">A Public Good for the TX Community</span>
        </div>
      </footer>

      {/* ════════ COOKIE CONSENT BANNER ════════ */}
      {cookieConsent === null && (
        <div style={{
          position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 9999,
          background: "var(--tx-dark-green)", borderTop: "1px solid rgba(177,252,3,0.2)",
          padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "center",
          gap: 16, flexWrap: "wrap",
        }}>
          <span style={{ color: "rgba(255,255,255,0.85)", fontSize: "0.78rem", maxWidth: 500 }}>
            We use cookies for analytics to improve your experience. No personal data is sold or shared.
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => handleCookieConsent("accepted")}
              style={{
                background: "var(--tx-neon)", color: "var(--tx-dark-green)",
                border: "none", borderRadius: "var(--radius-pill)",
                padding: "7px 18px", fontSize: "0.75rem", fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Accept
            </button>
            <button
              onClick={() => handleCookieConsent("declined")}
              style={{
                background: "transparent", color: "rgba(255,255,255,0.6)",
                border: "1px solid rgba(255,255,255,0.2)", borderRadius: "var(--radius-pill)",
                padding: "7px 18px", fontSize: "0.75rem", fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Decline
            </button>
          </div>
        </div>
      )}
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
              {loading ? "..." : `${stakingPct}%`}
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
              { label: "Pending Rewards", value: `${wallet.rewards > 1 ? formatNumber(Math.round(wallet.rewards)) : wallet.rewards < 0.01 ? wallet.rewards.toFixed(6) : wallet.rewards.toFixed(2)} TX`, sub: price > 0 ? formatUSD(wallet.rewards * price) : "", color: "var(--tx-neon)" },
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
                      {del.rewards > 0 && (
                        <div style={{ textAlign: "right", minWidth: 80 }}>
                          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--accent-olive)" }}>
                            +{del.rewards > 1 ? formatNumber(Math.round(del.rewards)) : del.rewards < 0.01 ? del.rewards.toFixed(6) : del.rewards.toFixed(2)} TX
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
                    Max Est. Next PSE Reward
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
                <Tooltip text="Theoretical maximum assuming full 30 day staking in the cycle. Real rewards are typically lower. Check the PSE tab for your actual on-chain score." />
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 10 }}>
            {wallet.rewards > 0 && (
              <button
                onClick={claimRewards}
                disabled={txPending}
                className="btn-olive"
                style={{ padding: "10px 20px", fontSize: "0.8rem", opacity: txPending ? 0.5 : 1 }}
              >
                {txPending ? "Processing..." : `Claim ${wallet.rewards > 1 ? formatNumber(Math.round(wallet.rewards)) : wallet.rewards < 0.01 ? wallet.rewards.toFixed(6) : wallet.rewards.toFixed(2)} TX Rewards`}
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
              PSE Calculator
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
                ${loading ? "..." : price.toFixed(4)}
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
                {loading ? "..." : formatUSD(marketCap)}
              </div>
            </div>
          </div>
        </div>

        <div className="accent-card card-dark">
          <div className="card-content">
            <span className="card-title" style={{ color: "rgba(237,233,224,0.7)" }}>Base APR <Tooltip text="PSE rewards are added on top of base APR. PSE is the primary yield source." /></span>
            <div>
              <div className="card-value">
                {apr > 0 ? `${apr.toFixed(2)}%` : "..."}
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
                PSE Calculator & Guide
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
                Block {networkStatus?.blockHeight ? networkStatus.blockHeight.toLocaleString() : "..."}
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

  // Fetch PSE params (excluded addresses) and clearing balances from Silk Nodes API
  const [pseParams, setPseParams] = useState<{ excludedAddresses: string[]; communityBalance: number }>({ excludedAddresses: PSE_EXCLUDED_ADDRESSES, communityBalance: 40_000_000_000 });
  useEffect(() => {
    async function fetchPSEParams() {
      try {
        const [paramsRes, balancesRes] = await Promise.all([
          fetchWithTimeout("https://api.silknodes.io/coreum/tx/pse/v1/params"),
          fetchWithTimeout("https://api.silknodes.io/coreum/tx/pse/v1/clearing_account_balances"),
        ]);
        const paramsData = await paramsRes.json();
        const balancesData = await balancesRes.json();
        const excluded = paramsData?.params?.excluded_addresses || PSE_EXCLUDED_ADDRESSES;
        const communityEntry = (balancesData?.balances || []).find((b: any) => b.clearing_account === "pse_community");
        const communityBalance = communityEntry ? Number(BigInt(communityEntry.balance) / BigInt(1_000_000)) : 40_000_000_000;
        setPseParams({ excludedAddresses: excluded, communityBalance });
      } catch { /* use defaults */ }
    }
    fetchPSEParams();
  }, []);

  const fetchPSEScore = useCallback(async (addr?: string) => {
    const address = (addr || pseAddress).trim();
    if (!address || !address.startsWith("core1") || address.length < 39) {
      setPseLookup(prev => ({ ...prev, error: "Enter a valid core1... address" }));
      return;
    }
    // Check if address is excluded from PSE
    if (pseParams.excludedAddresses.includes(address)) {
      setPseLookup({ loading: false, score: null, monthlyEstimate: null, annualEstimate: null, sharePct: null, totalStaked: null, error: "excluded", height: null });
      return;
    }
    setPseLookup({ loading: true, score: null, monthlyEstimate: null, annualEstimate: null, sharePct: null, totalStaked: null, error: null, height: null });
    try {
      const [scoreRes, delegRes, networkScoreRes] = await Promise.all([
        fetchWithTimeout(`https://api.silknodes.io/coreum/tx/pse/v1/score/${address}`),
        fetchWithTimeout(`https://api.silknodes.io/coreum/cosmos/staking/v1beta1/delegations/${address}`),
        fetch(`/tx-silknodes/pse-network-score.json`).catch(() => null),
      ]);
      const scoreData = await scoreRes.json();
      const delegData = await delegRes.json().catch(() => null);
      const networkScoreData = await networkScoreRes?.json().catch(() => null);

      if (scoreData.code || scoreData.error) {
        const rawError = scoreData.message || scoreData.error || "Failed to fetch PSE score";
        const isEndpointDown = rawError.includes("rpc error") || rawError.includes("timeout") || rawError.includes("Unavailable");
        setPseLookup({ loading: false, score: null, monthlyEstimate: null, annualEstimate: null, sharePct: null, totalStaked: null, error: isEndpointDown ? "PSE score service is temporarily unavailable." : rawError, height: null });
        return;
      }
      const scoreRaw = scoreData.score;
      const height = null;

      // Calculate staked from delegations
      let totalStaked = 0;
      if (delegData?.delegation_responses) {
        for (const d of delegData.delegation_responses) {
          totalStaked += parseInt(d.balance?.amount || "0") / 1_000_000;
        }
      }

      // Use cached real network total score (updated every 6h via GitHub Actions)
      // Falls back to estimation if cache is unavailable
      let networkScore: number;
      if (networkScoreData?.networkTotalScore) {
        // Use the real summed score from all eligible delegators
        networkScore = Number(BigInt(networkScoreData.networkTotalScore));
      } else {
        // Fallback: estimate from bonded tokens (less accurate)
        const tgeTimestamp = 1772755200; // 2026-03-06T00:00:00Z
        const now = Date.now() / 1000;
        const elapsed = now - tgeTimestamp;
        const totalBondedUcore = bondedTokens * 1_000_000;
        networkScore = totalBondedUcore * elapsed;
      }

      const share = Number(BigInt(scoreRaw)) / networkScore;
      // Use live community balance / 84 months for monthly estimate
      const monthlyFromPool = pseParams.communityBalance / 84;
      const monthlyTX = monthlyFromPool * share;
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
  }, [pseAddress, bondedTokens, pseParams]);

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
          <span style={{ fontSize: "0.62rem", color: "rgba(177,252,3,0.5)" }}>
            Powered by Silk Nodes API
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
          marginBottom: 12, padding: "16px 18px", borderRadius: 10,
          background: pseLookup.error === "excluded" ? "rgba(100,100,255,0.08)"
            : pseLookup.error.includes("temporarily") ? "rgba(255,180,0,0.08)"
            : "rgba(255,80,80,0.1)",
          border: pseLookup.error === "excluded" ? "1px solid rgba(100,100,255,0.2)"
            : pseLookup.error.includes("temporarily") ? "1px solid rgba(255,180,0,0.2)"
            : "1px solid rgba(255,80,80,0.2)",
        }}>
          <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: 6,
            color: pseLookup.error === "excluded" ? "#6666cc"
              : pseLookup.error.includes("temporarily") ? "#e6a800"
              : "#ff6b6b",
          }}>
            {pseLookup.error === "excluded" ? "ℹ️ Excluded Address"
              : pseLookup.error.includes("temporarily") ? "⚠️ PSE Score Temporarily Unavailable"
              : "⚠️ Error"}
          </div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-dark)", lineHeight: 1.5, opacity: 0.8 }}>
            {pseLookup.error === "excluded"
              ? "This address is excluded from community PSE rewards. Excluded addresses include foundation wallets, team accounts, smart contracts, and module accounts."
              : pseLookup.error.includes("temporarily")
              ? "The TX team is currently maintaining the on-chain score endpoint. We've reached out and are waiting for a fix. Your PSE rewards are safe and continue to accrue normally on-chain."
              : pseLookup.error}
          </div>
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
                Score at block {pseLookup.height || "latest"}. This is your real on-chain PSE data, more accurate than calculator estimates.
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
                Your reward = (your score / total network score) &times; monthly pool
              </div>

              {/* Score Reset Warning */}
              <div style={{
                marginTop: 12, padding: "10px 12px", borderRadius: 8,
                background: "rgba(255,180,0,0.1)", border: "1px solid rgba(255,180,0,0.2)",
              }}>
                <div style={{ fontSize: "0.62rem", fontWeight: 700, color: "#ffd54f", marginBottom: 4 }}>
                  Scores Reset Every Month
                </div>
                <div style={{ fontSize: "0.55rem", opacity: 0.7, lineHeight: 1.5 }}>
                  All PSE scores reset to zero after each distribution (6th of every month).
                  Your reward depends only on your staking during that cycle. Stay staked for the full cycle to maximize your score.
                </div>
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
          PSE Calculator & Guide: Understand How Your Rewards Work
        </button>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════
   TAB: CALCULATOR
   ═══════════════════════════════════════════════════════ */


function CalculatorTab({
  stakeInput, setStakeInput,
  targetPrice, setTargetPrice,
  stakedAmount, apr, nextPSEReward, wallet,
  tokenData, stakingData, setActiveTab, pseInfo,
}: any) {
  const bondedTokens = stakingData?.bondedTokens ?? 0;
  const excludedPSEStake = stakingData?.excludedPSEStake ?? 0;
  const pseEligibleBonded = stakingData?.pseEligibleBonded ?? bondedTokens;
  const price = tokenData?.price ?? 0;
  const tp = parseFloat(targetPrice) || 0;

  // Single month honest estimate
  const monthlyPSE = pseEligibleBonded > 0 && stakedAmount > 0
    ? estimatePSERewardFullPeriod(stakedAmount, bondedTokens, excludedPSEStake)
    : 0;
  const userSharePct = pseEligibleBonded > 0 && stakedAmount > 0
    ? (stakedAmount / pseEligibleBonded * 100)
    : 0;

  // Base staking reward (monthly)
  const monthlyBaseReward = stakedAmount > 0 && apr > 0
    ? stakedAmount * (apr / 100) / 12
    : 0;

  // Score rate: how fast user's score grows per second (in TX units)
  const scorePerSecond = stakedAmount > 0 ? stakedAmount : 0;

  // Days until next distribution
  const now = new Date();
  const daysUntil = Math.max(0, Math.ceil((pseInfo.nextDistribution.getTime() - now.getTime()) / 86400000));

  // Score accumulated if staking from now until next distribution
  const secondsUntil = Math.max(0, (pseInfo.nextDistribution.getTime() - now.getTime()) / 1000);
  const projectedScore = stakedAmount * secondsUntil;

  return (
    <>
      <div className="section-head">
        <h1 className="page-title">PSE Calculator & Guide</h1>
        <span className="section-sub">Understand how PSE works and estimate your next distribution</span>
      </div>

      {/* ── Section 1: How PSE Works (Educational) ── */}
      <div style={{
        padding: "20px 22px", borderRadius: 14, marginBottom: 16,
        background: "var(--tx-dark-green)", color: "#fff",
      }}>
        <div style={{ fontSize: "0.85rem", fontWeight: 700, marginBottom: 14, color: "var(--tx-neon)" }}>
          How PSE Works (from the TX Whitepaper)
        </div>

        {/* The Formula */}
        <div style={{
          padding: "14px 16px", borderRadius: 10, marginBottom: 14,
          background: "rgba(177,252,3,0.06)", border: "1px solid rgba(177,252,3,0.15)",
          textAlign: "center",
        }}>
          <div style={{ fontSize: "0.6rem", opacity: 0.5, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            The PSE Distribution Formula
          </div>
          <div style={{
            fontSize: "1.1rem", fontWeight: 700, fontFamily: "var(--font-mono)",
            color: "var(--tx-neon)", lineHeight: 1.6,
          }}>
            Your Reward = (Your Score / Total Scores) &times; Pool
          </div>
          <div style={{
            fontSize: "0.72rem", fontFamily: "var(--font-mono)", marginTop: 8,
            color: "rgba(177,252,3,0.7)",
          }}>
            Score = Staked Amount (uTX) &times; Duration (seconds)
          </div>
          <div style={{ fontSize: "0.58rem", opacity: 0.4, marginTop: 6 }}>
            Where 1 TX = 1,000,000 uTX &middot; Pool = ~476,190,476 TX per month (40% community share)
          </div>
        </div>

        {/* Visual Steps */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6,
          fontSize: "0.62rem", textAlign: "center", marginBottom: 14,
        }}>
          {[
            { label: "Stake TX", sub: "Delegate to a validator" },
            { label: "Build Score", sub: "Score grows every second" },
            { label: "Distribution Day", sub: "6th of each month" },
            { label: "Get Rewards", sub: "Based on your share" },
            { label: "Scores Reset", sub: "New cycle begins" },
          ].map((step, i) => (
            <div key={i} style={{
              padding: "10px 6px", borderRadius: 8,
              background: i === 4 ? "rgba(255,180,0,0.1)" : "rgba(177,252,3,0.05)",
              border: i === 4 ? "1px solid rgba(255,180,0,0.2)" : "1px solid rgba(177,252,3,0.08)",
            }}>
              <div style={{
                width: 22, height: 22, borderRadius: "50%", margin: "0 auto 4px",
                background: i === 4 ? "rgba(255,180,0,0.15)" : "rgba(177,252,3,0.15)",
                border: i === 4 ? "1px solid rgba(255,180,0,0.3)" : "1px solid rgba(177,252,3,0.3)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "0.6rem", fontWeight: 700, color: i === 4 ? "#ffd54f" : "var(--tx-neon)",
              }}>{i + 1}</div>
              <div style={{ fontWeight: 600, color: i === 4 ? "#ffd54f" : "var(--tx-neon-light)", fontSize: "0.62rem" }}>{step.label}</div>
              <div style={{ opacity: 0.45, fontSize: "0.52rem", marginTop: 2 }}>{step.sub}</div>
            </div>
          ))}
        </div>

        {/* Critical: Score Reset */}
        <div style={{
          padding: "12px 16px", borderRadius: 10,
          background: "rgba(255,180,0,0.08)", border: "1px solid rgba(255,180,0,0.2)",
        }}>
          <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#ffd54f", marginBottom: 6 }}>
            Scores Reset After Every Distribution
          </div>
          <div style={{ fontSize: "0.65rem", lineHeight: 1.6, opacity: 0.85 }}>
            On the 6th of each month, all PSE scores reset to zero and a new cycle begins.
            This means your reward each month depends only on your staking activity during that specific cycle,
            not your historical staking. Staying staked for the full 30 day cycle maximizes your score.
            If you unstake mid-cycle, you lose the remaining days of score accumulation.
          </div>
        </div>
      </div>

      <div className="grid-12">
        {/* Left: Estimator */}
        <div className="col-7" style={{ display: "flex", flexDirection: "column" }}>
          <div className="panel" style={{ flex: 1 }}>
            <div style={{ fontSize: "0.78rem", fontWeight: 700, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
              PSE Estimator
              <span style={{ fontSize: "0.58rem", fontWeight: 400, color: "var(--text-light)" }}>
                Single month upper bound estimate
              </span>
            </div>

            {/* Stake Amount Input */}
            <label className="input-label">How much TX would you like to delegate?</label>
            <div className="input-group mb-2">
              <input
                type="text"
                value={stakeInput}
                onChange={(e: any) => setStakeInput(e.target.value)}
                placeholder="Enter amount, e.g. 10000, 50000, 100000"
              />
              <span className="field-addon">TX</span>
              {wallet.connected && wallet.stakedAmount > 0 && (
                <button className="input-pill" onClick={() => setStakeInput(wallet.stakedAmount.toString())}>
                  Use My Staked Amount
                </button>
              )}
            </div>

            {/* Presets */}
            <div style={{ display: "flex", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
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
              {formatNumber(bondedTokens)} TX bonded on network ({stakingData?.stakingRatio?.toFixed(0) ?? "..."}%)
              {excludedPSEStake > 0 && <span> &middot; {formatNumber(excludedPSEStake)} TX excluded from PSE</span>}
            </div>
            <input
              type="range"
              min="1000"
              max="1000000"
              step="1000"
              value={stakedAmount || 0}
              onChange={(e: any) => setStakeInput(e.target.value)}
            />

            {/* Target Price Input */}
            <div style={{ marginTop: 12 }}>
              <label className="input-label">Target TX Price <Tooltip text={`Current price: $${price > 0 ? price.toFixed(4) : "..."}`} position="bottom" /></label>
              <div className="input-group mb-2">
                <span className="field-addon">$</span>
                <input
                  type="text"
                  value={targetPrice}
                  onChange={(e: any) => setTargetPrice(e.target.value)}
                  placeholder={price > 0 ? price.toFixed(4) : "0.05"}
                />
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[0.05, 0.10, 0.25, 0.50, 1.00].map((p) => (
                  <button
                    key={p}
                    onClick={() => setTargetPrice(p.toString())}
                    style={{
                      padding: "3px 8px", borderRadius: 16, fontSize: "0.65rem", fontFamily: "var(--font-mono)",
                      border: tp === p ? "1px solid var(--tx-neon)" : "1px solid rgba(0,0,0,0.08)",
                      background: tp === p ? "var(--tx-dark-green)" : "rgba(255,255,255,0.3)",
                      color: tp === p ? "var(--tx-neon)" : "var(--text-medium)",
                      cursor: "pointer", fontWeight: 500, transition: "all 0.15s",
                    }}
                  >
                    ${p.toFixed(2)}
                  </button>
                ))}
                {price > 0 && (
                  <button
                    onClick={() => setTargetPrice(price.toFixed(4))}
                    style={{
                      padding: "3px 8px", borderRadius: 16, fontSize: "0.65rem",
                      border: "1px solid rgba(0,0,0,0.08)",
                      background: "rgba(255,255,255,0.3)",
                      color: "var(--text-medium)",
                      cursor: "pointer", fontWeight: 500,
                    }}
                  >
                    Current (${price.toFixed(4)})
                  </button>
                )}
              </div>
            </div>

            {/* Results */}
            {stakedAmount > 0 && (
              <>
                {/* Main Result Card */}
                <div style={{
                  marginTop: 16, padding: "16px 18px", borderRadius: 12,
                  background: "rgba(177,252,3,0.06)", border: "1px solid rgba(177,252,3,0.12)",
                }}>
                  <div style={{ fontSize: "0.58rem", color: "var(--text-light)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                    Estimated Next PSE Distribution (Upper Bound)
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: "2rem", fontWeight: 800, fontFamily: "var(--font-mono)", color: "var(--accent-olive)" }}>
                      ~{formatNumber(Math.round(monthlyPSE))}
                    </span>
                    <span style={{ fontSize: "1rem", color: "var(--accent-olive)", opacity: 0.6 }}>TX</span>
                    {price > 0 && (
                      <span style={{ fontSize: "0.75rem", color: "var(--text-light)" }}>
                        (~{formatUSD(monthlyPSE * price)})
                      </span>
                    )}
                  </div>

                  <div style={{
                    marginTop: 12, padding: "8px 12px", borderRadius: 8,
                    background: "rgba(255,180,0,0.06)", border: "1px solid rgba(255,180,0,0.12)",
                    fontSize: "0.6rem", lineHeight: 1.5, color: "var(--text-medium)",
                  }}>
                    This is the <strong>upper bound</strong> assuming you stake for the entire 30 day cycle
                    and all other stakers have equal duration. Real rewards are typically lower because
                    the total network score (all stakers combined) is unknown. For your actual position,
                    check your <strong>real on-chain score</strong> in the PSE tab.
                  </div>
                </div>

                {/* Your Bag After 1 Month */}
                {(() => {
                  const totalBagAfterMonth = stakedAmount + monthlyBaseReward + monthlyPSE;
                  const usePrice = tp > 0 ? tp : price;
                  return (
                    <div style={{
                      marginTop: 12, padding: "14px 16px", borderRadius: 12,
                      background: "var(--tx-dark-green)", color: "#fff",
                    }}>
                      <div style={{ fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "0.05em", opacity: 0.5, marginBottom: 8 }}>
                        Your Bag After 1 Month (Upper Bound)
                      </div>
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                        <div>
                          <span style={{ fontSize: "1.6rem", fontWeight: 800, fontFamily: "var(--font-mono)", color: "var(--tx-neon)" }}>
                            {formatNumber(Math.round(totalBagAfterMonth))}
                          </span>
                          <span style={{ fontSize: "0.8rem", color: "var(--tx-neon)", opacity: 0.6, marginLeft: 4 }}>TX</span>
                        </div>
                        {usePrice > 0 && (
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontSize: "1.1rem", fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--tx-neon)" }}>
                              {formatUSD(totalBagAfterMonth * usePrice)}
                            </div>
                            <div style={{ fontSize: "0.55rem", opacity: 0.4 }}>
                              at ${usePrice.toFixed(tp >= 1 ? 2 : 4)} per TX
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Breakdown row */}
                      <div style={{
                        marginTop: 10, paddingTop: 8, borderTop: "1px solid rgba(177,252,3,0.1)",
                        display: "flex", gap: 16, fontSize: "0.6rem",
                      }}>
                        <div>
                          <span style={{ opacity: 0.4 }}>Initial stake: </span>
                          <span style={{ fontFamily: "var(--font-mono)", color: "var(--tx-neon-light)" }}>{formatNumber(stakedAmount)}</span>
                        </div>
                        <div>
                          <span style={{ opacity: 0.4 }}>+ Base: </span>
                          <span style={{ fontFamily: "var(--font-mono)", color: "var(--tx-neon-light)" }}>{formatNumber(Math.round(monthlyBaseReward))}</span>
                        </div>
                        <div>
                          <span style={{ opacity: 0.4 }}>+ PSE: </span>
                          <span style={{ fontFamily: "var(--font-mono)", color: "var(--tx-neon)" }}>~{formatNumber(Math.round(monthlyPSE))}</span>
                        </div>
                      </div>

                      {/* Price comparison: current vs target */}
                      {tp > 0 && price > 0 && tp !== price && (
                        <div style={{
                          marginTop: 8, display: "flex", gap: 12, fontSize: "0.58rem",
                        }}>
                          <div style={{
                            padding: "4px 10px", borderRadius: 6,
                            background: "rgba(255,255,255,0.06)",
                          }}>
                            <span style={{ opacity: 0.4 }}>At current (${price.toFixed(4)}): </span>
                            <span style={{ fontFamily: "var(--font-mono)" }}>{formatUSD(totalBagAfterMonth * price)}</span>
                          </div>
                          <div style={{
                            padding: "4px 10px", borderRadius: 6,
                            background: "rgba(177,252,3,0.1)", border: "1px solid rgba(177,252,3,0.15)",
                          }}>
                            <span style={{ opacity: 0.5, color: "var(--tx-neon-light)" }}>At target (${tp.toFixed(tp >= 1 ? 2 : 4)}): </span>
                            <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--tx-neon)" }}>{formatUSD(totalBagAfterMonth * tp)}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Breakdown Cards */}
                <div className="responsive-grid-3" style={{ gap: 10, marginTop: 12 }}>
                  <div style={{ padding: "12px 14px", borderRadius: 10, background: "var(--glass-bg)", border: "1px solid var(--glass-border)" }}>
                    <div style={{ fontSize: "0.52rem", color: "var(--text-light)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>Your Pool Share</div>
                    <div style={{ fontSize: "0.95rem", fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--accent-olive)" }}>
                      {userSharePct < 0.001 ? "<0.001" : userSharePct.toFixed(4)}%
                    </div>
                    <div style={{ fontSize: "0.5rem", color: "var(--text-light)", marginTop: 2 }}>
                      of PSE eligible bonded
                    </div>
                  </div>
                  <div style={{ padding: "12px 14px", borderRadius: 10, background: "var(--glass-bg)", border: "1px solid var(--glass-border)" }}>
                    <div style={{ fontSize: "0.52rem", color: "var(--text-light)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>Base Staking Reward</div>
                    <div style={{ fontSize: "0.95rem", fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--text-dark)" }}>
                      ~{formatNumber(Math.round(monthlyBaseReward))} TX
                    </div>
                    <div style={{ fontSize: "0.5rem", color: "var(--text-light)", marginTop: 2 }}>
                      {apr > 0 ? `${apr.toFixed(2)}% APR` : "..."} per month
                    </div>
                  </div>
                  <div style={{ padding: "12px 14px", borderRadius: 10, background: "var(--glass-bg)", border: "1px solid var(--glass-border)" }}>
                    <div style={{ fontSize: "0.52rem", color: "var(--text-light)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>Score Growth Rate</div>
                    <div style={{ fontSize: "0.95rem", fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--text-dark)" }}>
                      {formatNumber(scorePerSecond)}
                    </div>
                    <div style={{ fontSize: "0.5rem", color: "var(--text-light)", marginTop: 2 }}>
                      TX&middot;seconds added per second
                    </div>
                  </div>
                </div>

                {/* The Math Breakdown */}
                <div style={{
                  marginTop: 12, padding: "14px 16px", borderRadius: 10,
                  background: "rgba(0,0,0,0.02)", border: "1px solid rgba(0,0,0,0.06)",
                }}>
                  <div style={{ fontSize: "0.68rem", fontWeight: 600, marginBottom: 10 }}>The Math (Your Estimate)</div>
                  <div style={{ fontSize: "0.62rem", lineHeight: 1.8, fontFamily: "var(--font-mono)", color: "var(--text-medium)" }}>
                    <div>Your stake: <strong>{formatNumber(stakedAmount)} TX</strong></div>
                    <div>Full cycle duration: <strong>30 days = 2,592,000 seconds</strong></div>
                    <div>Your max score: <strong>{formatNumber(stakedAmount)} &times; 2,592,000 = {formatNumber(Math.round(stakedAmount * 2592000))}</strong></div>
                    <div style={{ marginTop: 4, paddingTop: 4, borderTop: "1px dashed rgba(0,0,0,0.08)" }}>
                      PSE eligible bonded: <strong>{formatNumber(Math.round(pseEligibleBonded))} TX</strong>
                    </div>
                    <div>Est. total network score: <strong>{formatNumber(Math.round(pseEligibleBonded))} &times; 2,592,000</strong> (if all stakers stake full cycle)</div>
                    <div>Your share: <strong>{formatNumber(stakedAmount)} / {formatNumber(Math.round(pseEligibleBonded))} = {userSharePct.toFixed(6)}%</strong></div>
                    <div style={{ marginTop: 4, paddingTop: 4, borderTop: "1px dashed rgba(0,0,0,0.08)" }}>
                      Monthly community pool: <strong>~476,190,476 TX</strong>
                    </div>
                    <div style={{ color: "var(--accent-olive)", fontWeight: 700 }}>
                      Your estimated reward: <strong>{userSharePct.toFixed(6)}% &times; 476,190,476 = ~{formatNumber(Math.round(monthlyPSE))} TX</strong>
                    </div>
                  </div>
                </div>

                {/* Why This Is An Upper Bound */}
                <div style={{
                  marginTop: 12, padding: "12px 14px", borderRadius: 10,
                  background: "rgba(100,100,255,0.04)", border: "1px solid rgba(100,100,255,0.1)",
                }}>
                  <div style={{ fontSize: "0.65rem", fontWeight: 600, marginBottom: 6, color: "#6666cc" }}>
                    Why is this an upper bound?
                  </div>
                  <div style={{ fontSize: "0.6rem", lineHeight: 1.6, color: "var(--text-medium)" }}>
                    This estimate assumes all stakers have <strong>equal staking duration</strong> (full 30 days),
                    which makes duration cancel out and simplifies to a pure stake ratio. In reality:
                  </div>
                  <ul style={{ fontSize: "0.6rem", lineHeight: 1.8, color: "var(--text-medium)", paddingLeft: 16, margin: "6px 0 0" }}>
                    <li>Different stakers have different durations (some joined mid cycle)</li>
                    <li>Large stakers who stake for the full cycle accumulate disproportionately higher scores</li>
                    <li>The actual total score (sum of all stakers&apos; scores) is only known on chain</li>
                    <li>Your real reward depends on your score relative to everyone else&apos;s</li>
                  </ul>
                </div>
              </>
            )}

            {!stakedAmount && (
              <div style={{
                marginTop: 16, padding: "20px", borderRadius: 12,
                background: "rgba(0,0,0,0.02)", border: "1px dashed rgba(0,0,0,0.1)",
                textAlign: "center",
              }}>
                <div style={{ fontSize: "1.5rem", marginBottom: 8, opacity: 0.3 }}>~</div>
                <div style={{ fontSize: "0.78rem", color: "var(--text-medium)", fontWeight: 500 }}>
                  Enter a stake amount above to see your estimated PSE distribution
                </div>
                <div style={{ fontSize: "0.62rem", color: "var(--text-light)", marginTop: 4 }}>
                  Or connect your wallet to use your current staked amount
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Key Facts + CTA */}
        <div className="col-5" style={{ display: "flex", flexDirection: "column" }}>
          {/* Distribution Info Card */}
          <div style={{
            padding: "14px 16px", borderRadius: 12, marginBottom: 12,
            background: "var(--tx-dark-green)", color: "#fff",
          }}>
            <div style={{ fontSize: "0.65rem", opacity: 0.5, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
              Current Distribution Cycle
            </div>
            <div className="responsive-grid-2" style={{ gap: 8 }}>
              <div>
                <div style={{ fontSize: "0.55rem", opacity: 0.4 }}>Cycle</div>
                <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--tx-neon)", fontFamily: "var(--font-mono)" }}>
                  #{pseInfo.distributionNumber} <span style={{ fontSize: "0.6rem", opacity: 0.5, fontWeight: 400 }}>of 84</span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: "0.55rem", opacity: 0.4 }}>Days Until Distribution</div>
                <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--tx-neon)", fontFamily: "var(--font-mono)" }}>
                  {daysUntil} <span style={{ fontSize: "0.6rem", opacity: 0.5, fontWeight: 400 }}>days</span>
                </div>
              </div>
            </div>
            {stakedAmount > 0 && (
              <div style={{
                marginTop: 10, padding: "8px 10px", borderRadius: 8,
                background: "rgba(177,252,3,0.08)", border: "1px solid rgba(177,252,3,0.12)",
                fontSize: "0.6rem", color: "var(--tx-neon-light)",
              }}>
                If you start staking now, you&apos;ll accumulate ~{daysUntil} days of score before the next distribution on the 6th.
              </div>
            )}
          </div>

          {/* APR + PSE Summary */}
          <div className="grid-2" style={{ marginBottom: 12 }}>
            <div className="accent-card card-orange" style={{ minHeight: 110 }}>
              <div className="blob-dark" style={{ width: 120, height: 120 }} />
              <div className="card-content">
                <span className="card-title">Base APR <Tooltip text={apr < 1 ? "Negligible, nearly 100% of returns come from PSE" : "PSE rewards are added on top of base APR"} /></span>
                <div className="card-value" style={{ fontSize: "1.8rem" }}>
                  {apr > 0 ? `${apr.toFixed(2)}%` : "..."}
                </div>
              </div>
            </div>
            <div className="accent-card card-olive" style={{ minHeight: 110 }}>
              <div className="card-content">
                <span className="card-title" style={{ opacity: 0.8, fontSize: "0.62rem" }}>Monthly Pool</span>
                <div className="card-value" style={{ fontSize: "1.5rem" }}>
                  ~476M <span style={{ fontSize: "0.7rem" }}>TX</span>
                </div>
                <div style={{ fontSize: "0.5rem", opacity: 0.5 }}>community stakers share</div>
              </div>
            </div>
          </div>

          {/* PSE Key Facts */}
          <div className="panel" style={{ marginBottom: 12 }}>
            <div style={{ fontSize: "0.72rem", fontWeight: 600, marginBottom: 10 }}>PSE Key Facts</div>
            <div style={{ fontSize: "0.62rem", lineHeight: 2, color: "var(--text-medium)" }}>
              {[
                "100 billion TX distributed over 84 months (7 years)",
                "40% goes to community stakers (~476M TX/month)",
                "All scores reset after each monthly distribution",
                "Score = Your Stake × Duration in seconds",
                "Rewards auto-compound as new delegations",
                "Must have active delegation at distribution time",
                "Distribution happens on the 6th of every month",
                "7 day unbonding period for undelegation",
              ].map((fact, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                  <span style={{
                    width: 4, height: 4, borderRadius: "50%", flexShrink: 0, marginTop: 6,
                    background: "var(--accent-olive)",
                  }} />
                  <span>{fact}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Allocation */}
          <div className="panel" style={{ marginBottom: 12 }}>
            <div style={{ fontSize: "0.72rem", fontWeight: 600, marginBottom: 10 }}>PSE Allocation Breakdown</div>
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

          {/* CTA: Check real score */}
          <button
            className="btn-olive"
            onClick={() => setActiveTab("pse")}
            style={{ width: "100%", padding: "12px 20px", fontSize: "0.78rem", borderRadius: 10, cursor: "pointer", marginBottom: 12 }}
          >
            Check Your Real On-Chain PSE Score
          </button>

          {/* Disclaimer */}
          <div style={{
            padding: "12px 14px", borderRadius: 10,
            background: "rgba(0,0,0,0.03)", border: "1px solid rgba(0,0,0,0.06)",
            fontSize: "0.58rem", lineHeight: 1.6, color: "var(--text-light)",
          }}>
            <strong style={{ color: "var(--text-medium)" }}>Disclaimer:</strong> This calculator provides
            theoretical upper bound estimates based on simplified assumptions. It is NOT a prediction of actual
            rewards. Only the on-chain PSE module determines real distributions. The total network score
            (sum of all stakers&apos; scores) is unknown to this calculator and significantly affects results.
            For your real PSE position, use the score lookup in the PSE tab. This is not financial advice.
            <div style={{ marginTop: 6 }}>
              Source:{" "}
              <a href="https://tx.org" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-olive)", textDecoration: "none" }}>
                TX Whitepaper v1.10 (MiCA)
              </a>
            </div>
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
          { label: "Pending Rewards", value: `${wallet.rewards > 1 ? formatNumber(Math.round(wallet.rewards)) : wallet.rewards < 0.01 ? wallet.rewards.toFixed(6) : wallet.rewards.toFixed(2)} TX`, sub: price > 0 ? formatUSD(wallet.rewards * price) : "", color: "var(--tx-dark-green)" },
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
            Max Est. Next PSE (Distribution #{pseInfo.distributionNumber})
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
            Theoretical max assuming full cycle staking. Real rewards depend on your staking duration.{" "}
            <a href="https://tx-pse.today" target="_blank" rel="noopener noreferrer" style={{ color: "var(--tx-neon)", textDecoration: "none" }}>
              tx-pse.today
            </a>{" "}for exact calculation, or check the PSE tab for your on-chain score.
          </div>
        </div>

        {/* Claim Rewards */}
        <div className="panel" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-light)", marginBottom: 6 }}>
            Claimable Rewards
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "1.3rem", fontWeight: 600, color: "var(--accent-olive)", marginBottom: 10 }}>
            {wallet.rewards > 1 ? formatNumber(Math.round(wallet.rewards)) : wallet.rewards < 0.01 ? wallet.rewards.toFixed(6) : wallet.rewards.toFixed(2)} TX
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

function SilkNodesTab({ networkStatus, stakingData, validators, setActiveTab, wallet, setShowWalletModal }: any) {
  const [devToolsOpen, setDevToolsOpen] = useState(false);
  const [showRestakeModal, setShowRestakeModal] = useState(false);
  const [contactForm, setContactForm] = useState({ name: "", email: "", size: "", message: "" });
  const [contactSent, setContactSent] = useState(false);
  // Get real Silk Nodes validator data
  const silkValidator = validators?.find((v: any) => v.moniker === "Silk Nodes");
  const silkBonded = silkValidator ? Math.round(silkValidator.tokens) : 0;
  const silkVotingPower = silkValidator && stakingData?.bondedTokens
    ? ((silkValidator.tokens / stakingData.bondedTokens) * 100).toFixed(2)
    : "...";
  const apr = stakingData?.apr || 12;
  const delegateCTA = () => { trackEvent("delegate_click", { source: "silk_nodes" }); wallet.connected ? setActiveTab("portfolio") : setShowWalletModal(true); };

  return (
    <>
      {/* ═══════════════════════════════════════════════════════
          HERO: Compact, commission-led
          ═══════════════════════════════════════════════════════ */}
      <div style={{
        background: "var(--tx-dark-green)",
        borderRadius: "var(--radius-lg)",
        padding: "24px 28px 20px",
        color: "#fff",
        position: "relative",
        overflow: "hidden",
        marginBottom: 18,
      }}>
        <div style={{
          position: "absolute", top: -40, right: -40,
          width: 180, height: 180,
          background: "radial-gradient(circle, rgba(177,252,3,0.1) 0%, transparent 70%)",
          borderRadius: "50%", pointerEvents: "none",
        }} />

        <div style={{ position: "relative", zIndex: 1 }}>
          {/* Top row: Logo + Name (left) | Delegate button (right) */}
          <div className="silk-hero-top" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`${BASE_PATH}/silk-nodes-logo.png`}
                alt="Silk Nodes validator logo"
                style={{ width: 40, height: 40, objectFit: "contain", filter: "invert(1)", flexShrink: 0 }}
              />
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                  <h1 style={{ fontSize: "1.25rem", fontWeight: 700, letterSpacing: "-0.02em", margin: 0, whiteSpace: "nowrap" }}>Silk Nodes</h1>
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    background: "rgba(177,252,3,0.15)", border: "1px solid rgba(177,252,3,0.3)",
                    borderRadius: "var(--radius-pill)", padding: "2px 8px",
                    fontSize: "0.55rem", fontWeight: 600, color: "var(--tx-neon)", whiteSpace: "nowrap",
                  }}>
                    <span className="live-dot" /> ACTIVE
                  </span>
                </div>
                <p style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.5)", margin: 0 }}>
                  Lower fees · Higher reliability · Early PSE advantage
                </p>
              </div>
            </div>

            {/* Delegate CTA button */}
            <button
              onClick={delegateCTA}
              className="silk-delegate-btn"
              style={{
                border: "none", padding: "10px 20px", fontSize: "0.78rem", fontWeight: 700,
                background: "var(--tx-neon)", color: "var(--tx-dark-green)",
                borderRadius: "var(--radius-pill)", cursor: "pointer",
                boxShadow: "0 3px 14px rgba(177,252,3,0.35)",
                transition: "transform 0.15s", flexShrink: 0, whiteSpace: "nowrap",
              }}
              onMouseOver={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; }}
              onMouseOut={(e) => { e.currentTarget.style.transform = "translateY(0)"; }}
            >
              Delegate to Silk Nodes
            </button>
          </div>

          {/* Stats row */}
          <div className="silk-stats-row" style={{
            display: "flex", flexWrap: "wrap", gap: 0, borderTop: "1px solid rgba(177,252,3,0.12)",
            paddingTop: 12,
          }}>
            {[
              { label: "Uptime", value: "99.98%" },
              { label: "Delegated", value: silkBonded > 0 ? `${formatNumber(silkBonded)} TX` : "..." },
              { label: "Slashing", value: "None" },
              { label: "Restake", value: "Enabled" },
              { label: "Commission", value: "5% (vs 8\u201310%)" },
            ].map((stat) => (
              <div key={stat.label} className="silk-stat-item" style={{
                textAlign: "center", flex: "1 1 auto", minWidth: 0,
                padding: "0 4px",
              }}>
                <div style={{ fontSize: "0.5rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.3)", marginBottom: 3 }}>{stat.label}</div>
                <div style={{
                  fontFamily: "var(--font-mono)", fontSize: "0.82rem", fontWeight: 600,
                  color: "rgba(255,255,255,0.85)",
                }}>{stat.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════
          COMPARISON: Side by side (the core argument)
          ═══════════════════════════════════════════════════════ */}
      <div className="panel" style={{ padding: 0, overflow: "hidden", marginBottom: 18 }}>
        <div style={{
          padding: "12px 20px",
          borderBottom: "1px solid rgba(0,0,0,0.06)",
        }}>
          <span style={{ fontWeight: 700, fontSize: "0.85rem", color: "var(--tx-dark-green)" }}>
            Why Silk Nodes?
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", minHeight: 0 }}>
          <div style={{
            padding: "16px 20px",
            borderRight: "1px solid rgba(0,0,0,0.06)",
            background: "rgba(0,0,0,0.02)",
          }}>
            <div style={{
              fontSize: "0.6rem", fontWeight: 600, letterSpacing: "0.08em",
              opacity: 0.4, marginBottom: 12,
            }}>AVERAGE VALIDATOR</div>
            {[
              ["Commission", "8\u201310%"],
              ["Uptime", "Variable"],
              ["Infrastructure", "Shared / Cloud"],
              ["Ecosystem tools", "None"],
              ["Missed blocks", "Possible"],
            ].map(([label, value], i) => (
              <div key={i} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                marginBottom: 8, fontSize: "0.75rem", opacity: 0.55, lineHeight: 1.4,
              }}>
                <span>{label}</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem" }}>{value}</span>
              </div>
            ))}
          </div>

          <div style={{
            padding: "16px 20px",
            background: "rgba(177,252,3,0.04)",
            borderLeft: "2px solid rgba(177,252,3,0.2)",
          }}>
            <div style={{
              fontSize: "0.6rem", fontWeight: 600, letterSpacing: "0.08em",
              color: "#3a5a0a", marginBottom: 12,
            }}>SILK NODES</div>
            {[
              ["Commission", "5% (minimum)"],
              ["Uptime", "99.98%"],
              ["Infrastructure", "Bare-metal"],
              ["Ecosystem tools", "Dashboard + APIs"],
              ["Missed blocks", "Zero"],
            ].map(([label, value], i) => (
              <div key={i} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                marginBottom: 8, fontSize: "0.75rem", color: "var(--tx-dark-green)", lineHeight: 1.4,
              }}>
                <span>{label}</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", fontWeight: 600, color: "#3a5a0a" }}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Mid-page CTA */}
      <div style={{ textAlign: "center", marginBottom: 18 }}>
        <button
          onClick={delegateCTA}
          style={{
            border: "none", padding: "12px 32px", fontSize: "0.82rem", fontWeight: 700,
            background: "var(--tx-neon)", color: "var(--tx-dark-green)",
            borderRadius: "var(--radius-pill)", cursor: "pointer",
            boxShadow: "0 3px 14px rgba(177,252,3,0.25)",
            transition: "transform 0.15s",
          }}
          onMouseOver={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; }}
          onMouseOut={(e) => { e.currentTarget.style.transform = "translateY(0)"; }}
        >
          Delegate to Silk Nodes &rarr;
        </button>
        <p style={{ fontSize: "0.68rem", color: "var(--text-light)", marginTop: 8 }}>
          Early delegators capture the highest PSE rewards.
        </p>
      </div>

      {/* ═══════════════════════════════════════════════════════
          TRUST + ECOSYSTEM (merged, compact)
          ═══════════════════════════════════════════════════════ */}
      <div className="responsive-grid-2" style={{ gap: 14, marginBottom: 18 }}>
        {/* What we build */}
        <div className="panel" style={{ padding: "18px 20px" }}>
          <div style={{ fontSize: "0.6rem", fontWeight: 600, letterSpacing: "0.1em", color: "var(--text-light)", textTransform: "uppercase", marginBottom: 10 }}>
            WHAT WE BUILD FOR TX
          </div>
          {[
            "This dashboard (free, open source)",
            "Public RPC, API, gRPC endpoints",
            "Daily snapshots for node operators",
            "Seed nodes and live peers",
          ].map((item, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 8,
              marginBottom: 6, fontSize: "0.76rem", lineHeight: 1.4,
            }}>
              <span style={{ color: "var(--accent-olive)", flexShrink: 0, fontSize: "0.65rem" }}>&#10003;</span>
              <span style={{ color: "var(--text-medium)" }}>{item}</span>
            </div>
          ))}
          <div style={{ fontSize: "0.65rem", color: "var(--accent-olive)", fontWeight: 600, marginTop: 10 }}>
            Early TX supporter. Aligned for long-term growth.
          </div>
        </div>

        {/* Community trust */}
        <div className="panel" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ fontSize: "0.6rem", fontWeight: 600, letterSpacing: "0.1em", color: "var(--text-light)", textTransform: "uppercase", marginBottom: 14 }}>
            COMMUNITY TRUST
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-dark)", lineHeight: 1.6, marginBottom: 12 }}>
            Trusted by delegators securing <span style={{ fontWeight: 700 }}>{silkBonded > 0 ? formatNumber(silkBonded) : "..."} TX</span>
          </div>
          <div style={{ display: "flex", gap: 20 }}>
            <div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "1.2rem", fontWeight: 700, color: "var(--tx-dark-green)" }}>{silkVotingPower}%</div>
              <div style={{ fontSize: "0.6rem", color: "var(--text-light)" }}>Voting Power</div>
            </div>
            <div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "1.2rem", fontWeight: 700, color: "var(--tx-dark-green)" }}>0</div>
              <div style={{ fontSize: "0.6rem", color: "var(--text-light)" }}>Slashing Events</div>
            </div>
            <div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "1.2rem", fontWeight: 700, color: "var(--tx-dark-green)" }}>0</div>
              <div style={{ fontSize: "0.6rem", color: "var(--text-light)" }}>Missed Blocks</div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════
          MAXIMIZE YOUR REWARDS (Auto-Compound)
          ═══════════════════════════════════════════════════════ */}
      <div style={{ marginBottom: 18 }}>
        <div className="panel" style={{ padding: "18px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--tx-dark-green)" }}>Maximize Your Rewards</span>
            <span style={{
              background: "var(--accent-olive)", color: "#fff",
              padding: "2px 8px", borderRadius: "var(--radius-pill)",
              fontSize: "0.55rem", fontWeight: 600,
            }}>AUTO-COMPOUND</span>
          </div>
          <p style={{ fontSize: "0.75rem", color: "var(--text-medium)", lineHeight: 1.5, margin: "0 0 14px" }}>
            With auto-compounding, your rewards are reinvested daily, increasing your total returns over time.
          </p>
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14,
          }}>
            <div style={{
              background: "rgba(0,0,0,0.03)", borderRadius: "var(--radius-md)",
              padding: "12px 14px", textAlign: "center",
            }}>
              <div style={{ fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-light)", marginBottom: 4 }}>Without Compounding</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "1.1rem", fontWeight: 700, color: "var(--text-medium)" }}>{(apr * 0.95).toFixed(1)}% APR</div>
            </div>
            <div style={{
              background: "rgba(177,252,3,0.08)", border: "1px solid rgba(177,252,3,0.2)",
              borderRadius: "var(--radius-md)", padding: "12px 14px", textAlign: "center",
            }}>
              <div style={{ fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "#3a5a0a", marginBottom: 4 }}>With Compounding</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "1.1rem", fontWeight: 700, color: "var(--tx-dark-green)" }}>13.39% APY</div>
            </div>
          </div>
          <p style={{ fontSize: "0.72rem", color: "var(--accent-olive)", fontWeight: 600, margin: "0 0 14px", textAlign: "center" }}>
            That&apos;s ~15% more rewards over time ... automatically.
          </p>
          <button
            onClick={() => { setShowRestakeModal(true); trackEvent("restake_click"); }}
            className="btn-olive"
            style={{ display: "block", textAlign: "center", width: "100%", padding: "10px 16px", fontSize: "0.78rem", fontWeight: 600, border: "none", cursor: "pointer" }}
          >
            Enable Auto-Compound on Restake
          </button>
        </div>

      </div>

      {/* ═══════════════════════════════════════════════════════
          LARGE DELEGATORS + CONTACT
          ═══════════════════════════════════════════════════════ */}
      <div className="panel" style={{ padding: "24px 24px 20px", marginBottom: 18, background: "linear-gradient(135deg, rgba(15,27,7,0.03) 0%, rgba(177,252,3,0.04) 100%)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--tx-dark-green)" }}>For Institutional &amp; Large Delegators</span>
        </div>
        <p style={{ fontSize: "0.76rem", color: "var(--text-medium)", lineHeight: 1.5, margin: "0 0 16px" }}>
          Delegating a significant amount? We offer custom commission rates, dedicated support, infrastructure transparency, and a direct communication channel.
        </p>

        <div className="responsive-grid-2" style={{ gap: 14 }}>
          {/* X DM option */}
          <a
            href="https://x.com/messages/compose?recipient_id=silk_nodes"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              padding: "12px 18px", borderRadius: "var(--radius-md)",
              background: "var(--tx-dark-green)", color: "#fff",
              textDecoration: "none", fontSize: "0.78rem", fontWeight: 600,
              transition: "transform 0.15s",
            }}
            onMouseOver={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; }}
            onMouseOut={(e) => { e.currentTarget.style.transform = "translateY(0)"; }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            DM us on X (@silk_nodes)
          </a>

          {/* Inline contact form */}
          <div>
            {contactSent ? (
              <div style={{
                padding: "16px", textAlign: "center", borderRadius: "var(--radius-md)",
                background: "rgba(177,252,3,0.08)", border: "1px solid rgba(177,252,3,0.2)",
              }}>
                <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--tx-dark-green)" }}>
                  Message sent! We&apos;ll get back to you soon.
                </span>
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const honeypot = (form.elements as any).botcheck?.value;
                  if (honeypot) return; // Bot detected
                  fetch("https://api.web3forms.com/submit", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      access_key: "620e62bc-35f9-464e-a37e-883a18d9dc61",
                      subject: "Silk Nodes - Delegation Inquiry",
                      name: contactForm.name,
                      email: contactForm.email,
                      message: contactForm.message,
                      botcheck: "",
                    }),
                  }).then(() => { setContactSent(true); trackEvent("contact_form_submit"); }).catch(() => setContactSent(true));
                }}
                style={{ display: "flex", flexDirection: "column", gap: 8 }}
              >
                {/* Honeypot spam protection */}
                <input type="checkbox" name="botcheck" style={{ display: "none" }} tabIndex={-1} autoComplete="off" />
                <input
                  type="text"
                  required
                  placeholder="Your name"
                  value={contactForm.name}
                  onChange={(e) => setContactForm(prev => ({ ...prev, name: e.target.value }))}
                  style={{
                    padding: "8px 12px", fontSize: "0.75rem", borderRadius: "var(--radius-md)",
                    border: "1px solid rgba(0,0,0,0.12)", background: "rgba(255,255,255,0.8)",
                    outline: "none",
                  }}
                />
                <input
                  type="email"
                  required
                  placeholder="Your email"
                  value={contactForm.email}
                  onChange={(e) => setContactForm(prev => ({ ...prev, email: e.target.value }))}
                  style={{
                    padding: "8px 12px", fontSize: "0.75rem", borderRadius: "var(--radius-md)",
                    border: "1px solid rgba(0,0,0,0.12)", background: "rgba(255,255,255,0.8)",
                    outline: "none",
                  }}
                />
                <textarea
                  required
                  placeholder="Message"
                  value={contactForm.message}
                  onChange={(e) => setContactForm(prev => ({ ...prev, message: e.target.value }))}
                  rows={3}
                  style={{
                    padding: "8px 12px", fontSize: "0.75rem", borderRadius: "var(--radius-md)",
                    border: "1px solid rgba(0,0,0,0.12)", background: "rgba(255,255,255,0.8)",
                    outline: "none", resize: "vertical", fontFamily: "inherit",
                  }}
                />
                <button
                  type="submit"
                  className="btn-olive"
                  style={{
                    padding: "10px 16px", fontSize: "0.78rem", fontWeight: 600,
                    border: "none", cursor: "pointer", width: "100%",
                  }}
                >
                  Get in Touch
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════
          DEVELOPER TOOLS (full-width, bottom)
          ═══════════════════════════════════════════════════════ */}
      <div className="panel" style={{ padding: "16px 20px", marginBottom: 18 }}>
        <button
          onClick={() => setDevToolsOpen(!devToolsOpen)}
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            width: "100%", background: "none", border: "none", cursor: "pointer",
            padding: 0, color: "var(--text-dark)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <svg width="16" height="16" viewBox="0 0 18 18" fill="none" style={{ flexShrink: 0 }}>
              <path d="M7.5 2.5l1.5 3-3 1.5 1 2.5 2.5-1L11 12l3-2-1-3 2.5-1L14 3z" stroke="var(--accent-olive)" strokeWidth="1.3" fill="rgba(74,122,26,0.1)" strokeLinejoin="round" />
              <circle cx="9" cy="9" r="2" stroke="var(--accent-olive)" strokeWidth="1.2" fill="none" />
            </svg>
            <span style={{ fontWeight: 600, fontSize: "0.85rem" }}>Developer Tools</span>
            <span className="text-xs text-light">RPC · API · Snapshots · Peers</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {!devToolsOpen && (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="mono text-xs" style={{ color: "var(--text-light)" }}>
                  Block {networkStatus?.blockHeight ? formatNumber(networkStatus.blockHeight) : "..."} · v4.1.1
                </span>
              </div>
            )}
            <span style={{
              fontSize: "0.75rem", color: "var(--text-light)",
              transform: devToolsOpen ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.2s",
              display: "inline-block",
            }}>&#9660;</span>
          </div>
        </button>

        {devToolsOpen && (
          <div style={{ marginTop: 14 }}>
            {/* Node info bar */}
            <div style={{
              display: "flex", gap: 16, padding: "10px 14px", marginBottom: 14,
              background: "rgba(0,0,0,0.03)", borderRadius: "var(--radius-md)",
              flexWrap: "wrap",
            }}>
              {[
                { label: "Block Height", value: networkStatus?.blockHeight ? formatNumber(networkStatus.blockHeight) : "..." },
                { label: "Node Version", value: "v4.1.1" },
                { label: "Network", value: "tx-mainnet" },
              ].map((item) => (
                <div key={item.label} style={{ minWidth: 100 }}>
                  <span className="text-xs text-light" style={{ textTransform: "uppercase", letterSpacing: "0.05em", fontSize: "0.55rem" }}>{item.label}</span>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.85rem", fontWeight: 600, marginTop: 2 }}>{item.value}</div>
                </div>
              ))}
            </div>

            {/* Endpoints + Snapshot side by side */}
            <div className="responsive-grid-2" style={{ gap: 14, marginBottom: 14 }}>
              {/* Endpoints */}
              <div>
                <span className="text-xs text-light" style={{ textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 6, fontSize: "0.55rem" }}>
                  Endpoints
                </span>
                {[
                  { label: "RPC", url: SILK_SERVICES.rpc },
                  { label: "API", url: SILK_SERVICES.api },
                  { label: "GRPC", url: SILK_SERVICES.grpc },
                ].map((svc) => (
                  <div key={svc.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--tx-neon)", flexShrink: 0, boxShadow: "0 0 4px rgba(177,252,3,0.4)" }} />
                      <span style={{ fontWeight: 600, minWidth: 34, fontSize: "0.75rem" }}>{svc.label}</span>
                      <span className="mono text-xs" style={{ color: "var(--text-medium)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{svc.url}</span>
                    </div>
                    <CopyButton text={svc.url} />
                  </div>
                ))}
              </div>

              {/* Snapshot */}
              <div style={{ background: "var(--accent-olive)", color: "#fff", borderRadius: "var(--radius-md)", padding: "14px 16px" }}>
                <div className="flex-between" style={{ marginBottom: 8 }}>
                  <span style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.06em", opacity: 0.8 }}>Latest Snapshot</span>
                  <a
                    href={SILK_SERVICES.snapshot.downloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ textDecoration: "none", fontSize: "0.68rem", fontWeight: 600, color: "#fff", background: "rgba(255,255,255,0.2)", padding: "3px 10px", borderRadius: "var(--radius-pill)" }}
                  >
                    Download
                  </a>
                </div>
                <div style={{ display: "flex", gap: 24 }}>
                  <div>
                    <span style={{ fontSize: "0.55rem", opacity: 0.7 }}>Block</span>
                    <div style={{ fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: "0.9rem", marginTop: 2 }}>{networkStatus?.blockHeight ? formatNumber(networkStatus.blockHeight) : "..."}</div>
                  </div>
                  <div>
                    <span style={{ fontSize: "0.55rem", opacity: 0.7 }}>Size</span>
                    <div style={{ fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: "0.9rem", marginTop: 2 }}>~12.5 GB</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Seed + Peers (compact) */}
            <div style={{ borderTop: "1px solid rgba(0,0,0,0.06)", paddingTop: 12 }}>
              <div style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <span className="text-xs text-light" style={{ textTransform: "uppercase", letterSpacing: "0.05em", fontSize: "0.55rem" }}>Seed Node</span>
                  <CopyButton text={SILK_SERVICES.seed} />
                </div>
                <span className="mono text-xs" style={{ wordBreak: "break-all", color: "var(--text-medium)", lineHeight: 1.4 }}>{SILK_SERVICES.seed}</span>
              </div>
              <div>
                <div className="flex-between" style={{ marginBottom: 4 }}>
                  <span className="text-xs text-light" style={{ textTransform: "uppercase", letterSpacing: "0.05em", fontSize: "0.55rem" }}>
                    {SILK_SERVICES.peers.length} Live Peers
                  </span>
                  <button className="filter-chip" style={{ fontSize: "0.65rem" }} onClick={() => navigator.clipboard.writeText(SILK_SERVICES.peers.join(","))}>
                    Copy All
                  </button>
                </div>
                {SILK_SERVICES.peers.map((peer, i) => (
                  <div key={i} className="mono text-xs" style={{ padding: "3px 0", borderBottom: i < SILK_SERVICES.peers.length - 1 ? "1px solid rgba(0,0,0,0.05)" : "none", wordBreak: "break-all", color: "var(--text-medium)", lineHeight: 1.3 }}>
                    {peer}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Explorer link */}
      <div style={{ textAlign: "center", padding: "4px 0" }}>
        <a
          href={SILK_SERVICES.explorer}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: "0.75rem", color: "var(--text-medium)", textDecoration: "none" }}
        >
          View Silk Nodes on Mintscan Explorer &rarr;
        </a>
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
                  REStake · Auto-Compound Setup
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <a
                  href="https://restake.app/coreum/corevaloper1kepnaw38rymdvq5sstnnytdqqkpd0xxwc5eqjk/stake"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    padding: "6px 14px", borderRadius: 8, fontSize: "0.78rem", fontWeight: 600,
                    background: "var(--tx-neon)", color: "var(--tx-dark-green)",
                    textDecoration: "none", display: "flex", alignItems: "center", gap: 6,
                  }}
                >
                  Open ↗
                </a>
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
            </div>
            <iframe
              src="https://restake.app/coreum/corevaloper1kepnaw38rymdvq5sstnnytdqqkpd0xxwc5eqjk/stake"
              style={{ flex: 1, width: "100%", border: "none" }}
              title="REStake Auto-Compound"
              allow="clipboard-write"
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
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
  rwa: { label: "Compliance-Enabled", color: "#2a5a0a", bg: "rgba(177,252,3,0.18)", border: "rgba(177,252,3,0.4)" },
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
        type: "COMPLIANT",
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

function RWATab({ bondedTokens, price, setActiveTab }: { bondedTokens: number; price: number; setActiveTab: (tab: TabId) => void }) {
  const { tokens, stats, loading, error, refresh } = useRWATokens();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");
  const [sortKey, setSortKey] = useState<SortKey>("class");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expandedFeature, setExpandedFeature] = useState<string | null>(null);
  const [showFullRegistry, setShowFullRegistry] = useState(false);

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
            position: "fixed", top: "50%", left: "50%",
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

      {/* ═══════════════════════════════════════════════════════
          SECTION 1: HERO
          ═══════════════════════════════════════════════════════ */}
      <div style={{ textAlign: "center", padding: "32px 0 24px" }}>
        <span style={{
          display: "inline-block", fontSize: "0.6rem", fontWeight: 600,
          padding: "4px 14px", borderRadius: 20,
          background: "rgba(177,252,3,0.15)", color: "#3a5a0a",
          letterSpacing: "0.1em", marginBottom: 16,
          border: "1px solid rgba(177,252,3,0.3)",
        }}>
          INFRASTRUCTURE LIVE
        </span>
        <h1 className="page-title" style={{ fontSize: "2rem", lineHeight: 1.15, marginBottom: 14 }}>
          The Operating System for<br />Real-World Assets
        </h1>
        <p style={{
          maxWidth: 640, margin: "0 auto", fontSize: "0.85rem",
          lineHeight: 1.6, opacity: 0.6, color: "var(--tx-dark-green)",
        }}>
          TX enables compliant, programmable financial assets at the protocol level — not through smart contracts. The infrastructure is live. Real-world adoption is building.
        </p>
      </div>

      {/* Hero stat cards */}
      <div className="responsive-grid-3" style={{ gap: 10, marginBottom: 12 }}>
        <div className="accent-card card-dark">
          <div className="card-content">
            <span className="card-title" style={{ color: "rgba(237,233,224,0.7)" }}>Smart Tokens Issued</span>
            <div className="card-value">{loading ? "..." : stats.totalTokens}</div>
            <div style={{ fontSize: "0.62rem", color: "rgba(237,233,224,0.4)", marginTop: 4, lineHeight: 1.4 }}>
              Active experimentation with TX's smart token standard
            </div>
          </div>
        </div>
        <div className="accent-card" style={{ background: "linear-gradient(135deg, #0F1B07, #1a2e0f)" }}>
          <div className="card-content">
            <span className="card-title" style={{ color: "rgba(177,252,3,0.7)" }}>Compliance-Enabled</span>
            <div className="card-value" style={{ color: "#B1FC03" }}>{loading ? "..." : rwaCount}</div>
            <div style={{ fontSize: "0.62rem", color: "rgba(177,252,3,0.35)", marginTop: 4, lineHeight: 1.4 }}>
              Tokens using whitelisting, freezing, or clawback features
            </div>
          </div>
        </div>
        <div className="accent-card card-yellow">
          <div className="blob-light" />
          <div className="card-content">
            <span className="card-title">Unique Issuers</span>
            <div className="card-value">{loading ? "..." : stats.totalIssuers}</div>
            <div style={{ fontSize: "0.62rem", opacity: 0.4, marginTop: 4, lineHeight: 1.4 }}>
              High issuer count indicates active experimentation
            </div>
          </div>
        </div>
      </div>

      {/* Honesty disclaimer */}
      <div style={{
        textAlign: "center", marginBottom: 32, padding: "0 20px",
      }}>
        <p style={{
          fontSize: "0.68rem", color: "var(--tx-dark-green)", opacity: 0.4,
          lineHeight: 1.5, fontStyle: "italic", maxWidth: 500, margin: "0 auto",
        }}>
          Note: Most current tokens are developer-issued or experimental. The infrastructure is production-ready — real-world asset tokenization is in its early adoption phase.
        </p>
      </div>

      {/* ═══════════════════════════════════════════════════════
          SECTION 2: WHAT MAKES TX DIFFERENT
          ═══════════════════════════════════════════════════════ */}
      <div className="section-head" style={{ marginBottom: 16 }}>
        <h2 className="page-title" style={{ fontSize: "1.4rem" }}>Protocol-Native Compliance</h2>
        <span className="section-sub">
          Unlike Ethereum where compliance requires custom smart contracts, TX bakes it directly into the token standard. Every token can be configured with institutional-grade features from day one.
        </span>
      </div>

      <div className="responsive-grid-3" style={{ gap: 16, marginBottom: 36 }}>
        {[
          {
            key: "whitelisting", icon: (
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#B1FC03" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                <path d="M9 12l2 2 4-4"/>
              </svg>
            ),
            title: "KYC / Whitelist",
            desc: "Restrict token holders to verified addresses. Required for regulated securities and compliant asset transfers.",
            plain: "Control exactly who can hold your token",
            tag: "IDENTITY",
          },
          {
            key: "freezing", icon: (
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#B1FC03" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            ),
            title: "Asset Freeze",
            desc: "Halt transfers globally or per-account. Essential for regulatory holds, disputes, and court orders.",
            plain: "Pause any token instantly if something goes wrong",
            tag: "CONTROL",
          },
          {
            key: "clawback", icon: (
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#B1FC03" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="1 4 1 10 7 10"/>
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
              </svg>
            ),
            title: "Clawback",
            desc: "Recover tokens for regulatory compliance. Enables issuers to meet legal obligations and correct errors.",
            plain: "Reverse transactions when legally required",
            tag: "RECOVERY",
          },
          {
            key: "burning", icon: (
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#B1FC03" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 12c2-2.96 0-7-1-8 0 3.038-1.773 4.741-3 6-1.226 1.26-2 3.24-2 5a6 6 0 1 0 12 0c0-1.532-1.056-3.94-2-5-1.786 3-2.791 3-4 2z"/>
              </svg>
            ),
            title: "Burn",
            desc: "Permanently remove tokens from supply. Supports redemption workflows and supply management.",
            plain: "Reduce supply when assets are redeemed",
            tag: "SUPPLY",
          },
          {
            key: "minting", icon: (
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#B1FC03" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                <path d="M2 17l10 5 10-5"/>
                <path d="M2 12l10 5 10-5"/>
              </svg>
            ),
            title: "Mint",
            desc: "Issue additional supply on demand. Enables flexible issuance models and corporate actions.",
            plain: "Create new tokens as your asset grows",
            tag: "SUPPLY",
          },
          {
            key: "ibc", icon: (
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#B1FC03" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="2" y1="12" x2="22" y2="12"/>
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
              </svg>
            ),
            title: "IBC Transfer",
            desc: "Cross-chain interoperability via IBC protocol. Assets can move across 60+ connected blockchains.",
            plain: "Send tokens to other blockchains seamlessly",
            tag: "BRIDGE",
          },
        ].map((item) => {
          const count = stats.featureCounts[item.key] || 0;
          return (
            <div key={item.key} style={{
              background: "var(--tx-dark-green)",
              borderRadius: 14, padding: "22px 20px",
              border: "1px solid rgba(177,252,3,0.12)",
              position: "relative", overflow: "hidden",
              transition: "border-color 0.2s",
            }}>
              {/* Tag pill top-right */}
              <span style={{
                position: "absolute", top: 14, right: 14,
                fontSize: "0.5rem", fontWeight: 600, fontFamily: "var(--font-mono)",
                padding: "2px 8px", borderRadius: 4,
                background: "rgba(177,252,3,0.12)", color: "rgba(177,252,3,0.6)",
                letterSpacing: "0.06em",
              }}>{item.tag}</span>

              {/* Icon */}
              <div style={{ marginBottom: 12 }}>{item.icon}</div>

              {/* Title */}
              <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "#EDE9E0", marginBottom: 6 }}>
                {item.title}
              </div>

              {/* Plain language summary */}
              <div style={{
                fontSize: "0.7rem", fontWeight: 600, color: "rgba(177,252,3,0.7)",
                marginBottom: 8, lineHeight: 1.4,
              }}>
                {item.plain}
              </div>

              {/* Description */}
              <div style={{ fontSize: "0.72rem", color: "rgba(237,233,224,0.45)", lineHeight: 1.5, marginBottom: 12 }}>
                {item.desc}
              </div>

              {/* Token count */}
              <div style={{
                paddingTop: 12, borderTop: "1px solid rgba(177,252,3,0.1)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{
                    fontSize: "1.1rem", fontWeight: 700, fontFamily: "var(--font-mono)",
                    color: "#B1FC03",
                  }}>
                    {loading ? "..." : count}
                  </span>
                  <span style={{ fontSize: "0.65rem", color: "rgba(177,252,3,0.45)" }}>
                    token{count !== 1 ? "s" : ""} enabled
                  </span>
                </div>
                {!loading && count > 0 && (
                  <div style={{ fontSize: "0.58rem", color: "rgba(177,252,3,0.3)", marginTop: 4 }}>
                    Early adoption of compliance features
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ═══════════════════════════════════════════════════════
          SECTION 3: HOW IT WORKS
          ═══════════════════════════════════════════════════════ */}
      <div className="section-head" style={{ marginBottom: 18 }}>
        <h2 className="page-title" style={{ fontSize: "1.4rem" }}>From Issuance to Compliance in Minutes</h2>
      </div>

      {/* 4-step horizontal flow */}
      <div className="responsive-grid-4" style={{ gap: 0, marginBottom: 24, position: "relative" }}>
        {[
          { step: "01", title: "Define Asset", desc: "Create a smart token with custom supply, precision, and metadata" },
          { step: "02", title: "Configure Rules", desc: "Enable compliance features: KYC, freeze, clawback, transfer restrictions" },
          { step: "03", title: "Issue & Distribute", desc: "Mint tokens and distribute to verified holders via whitelist" },
          { step: "04", title: "Trade Compliantly", desc: "Assets trade on DEX with built-in compliance rules enforced at protocol level" },
        ].map((s, i) => (
          <div key={i} style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            textAlign: "center", padding: "0 12px",
            position: "relative",
          }}>
            {/* Arrow connector (not on last item) */}
            {i < 3 && (
              <div style={{
                position: "absolute", top: 22, right: -6, width: 12, height: 2,
                background: "var(--tx-neon)", opacity: 0.4, zIndex: 1,
              }}>
                <div style={{
                  position: "absolute", right: -4, top: -3,
                  width: 0, height: 0,
                  borderTop: "4px solid transparent",
                  borderBottom: "4px solid transparent",
                  borderLeft: "6px solid var(--tx-neon)",
                  opacity: 0.6,
                }} />
              </div>
            )}

            {/* Step number circle */}
            <div style={{
              width: 44, height: 44, borderRadius: "50%",
              background: "var(--tx-dark-green)",
              border: "2px solid rgba(177,252,3,0.3)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "0.75rem", fontWeight: 700, fontFamily: "var(--font-mono)",
              color: "#B1FC03", marginBottom: 12,
            }}>
              {s.step}
            </div>

            <div style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: 6, color: "var(--tx-dark-green)" }}>
              {s.title}
            </div>
            <div style={{ fontSize: "0.72rem", opacity: 0.55, lineHeight: 1.45 }}>
              {s.desc}
            </div>
          </div>
        ))}
      </div>

      {/* Comparison panel: TX vs Traditional */}
      <div className="panel" style={{ padding: 0, overflow: "hidden", marginBottom: 32 }}>
        <div style={{
          padding: "14px 20px",
          borderBottom: "1px solid rgba(0,0,0,0.06)",
        }}>
          <span style={{ fontWeight: 700, fontSize: "0.9rem", color: "var(--tx-dark-green)" }}>
            TX vs Traditional Tokenization
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", minHeight: 0 }}>
          {/* Left: Other Chains */}
          <div style={{
            padding: "20px 24px",
            borderRight: "1px solid rgba(0,0,0,0.06)",
            background: "rgba(0,0,0,0.02)",
          }}>
            <div style={{
              fontSize: "0.65rem", fontWeight: 600, letterSpacing: "0.08em",
              opacity: 0.4, marginBottom: 14,
            }}>OTHER CHAINS</div>
            {[
              "Custom smart contracts for each token",
              "Expensive security audits required",
              "High deployment and maintenance cost",
              "Fragile \u2014 bugs can mean lost funds",
              "Every token behaves differently",
            ].map((item, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "flex-start", gap: 8,
                marginBottom: 10, fontSize: "0.78rem", opacity: 0.6, lineHeight: 1.4,
              }}>
                <span style={{ color: "#b44a3e", flexShrink: 0, marginTop: 1, fontSize: "0.7rem" }}>{"\u2717"}</span>
                {item}
              </div>
            ))}
          </div>

          {/* Right: TX Protocol */}
          <div style={{
            padding: "20px 24px",
            background: "rgba(177,252,3,0.04)",
            borderLeft: "2px solid rgba(177,252,3,0.2)",
          }}>
            <div style={{
              fontSize: "0.65rem", fontWeight: 600, letterSpacing: "0.08em",
              color: "#3a5a0a", marginBottom: 14,
            }}>TX PROTOCOL</div>
            {[
              "Native token standard \u2014 no contracts needed",
              "Built-in compliance at the protocol level",
              "Cost-effective issuance for any organization",
              "Battle-tested consensus with validator security",
              "Consistent, predictable token behavior",
            ].map((item, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "flex-start", gap: 8,
                marginBottom: 10, fontSize: "0.78rem", color: "var(--tx-dark-green)", lineHeight: 1.4,
              }}>
                <span style={{ color: "#3a5a0a", flexShrink: 0, marginTop: 1, fontSize: "0.7rem" }}>{"\u2713"}</span>
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════
          SECTION 4: WHAT THIS ENABLES (Future Vision)
          ═══════════════════════════════════════════════════════ */}
      <div className="section-head" style={{ marginBottom: 16 }}>
        <h2 className="page-title" style={{ fontSize: "1.4rem" }}>What This Enables</h2>
        <span className="section-sub">
          TX&rsquo;s protocol-native compliance isn&rsquo;t just for today&rsquo;s experimental tokens — it&rsquo;s the foundation for the next wave of real-world finance on-chain.
        </span>
      </div>

      <div className="responsive-grid-3" style={{ gap: 12, marginBottom: 32 }}>
        {[
          {
            icon: (
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#B1FC03" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
              </svg>
            ),
            title: "Tokenized Stocks & Equities",
            desc: "Fractional ownership of publicly-traded companies with built-in shareholder verification and transfer restrictions.",
          },
          {
            icon: (
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#B1FC03" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                <polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
            ),
            title: "Real Estate Fractions",
            desc: "Property ownership divided into tradeable tokens — with KYC verification and regulatory compliance built in from day one.",
          },
          {
            icon: (
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#B1FC03" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                <line x1="8" y1="21" x2="16" y2="21"/>
                <line x1="12" y1="17" x2="12" y2="21"/>
              </svg>
            ),
            title: "Government & Corporate Bonds",
            desc: "Fixed-income instruments on-chain with automated coupon payments, maturity enforcement, and accredited investor gating.",
          },
        ].map((item, i) => (
          <div key={i} style={{
            background: "linear-gradient(135deg, rgba(15,27,7,0.95), rgba(26,46,15,0.95))",
            borderRadius: 14, padding: "24px 20px",
            border: "1px solid rgba(177,252,3,0.15)",
            position: "relative", overflow: "hidden",
          }}>
            {/* Subtle glow */}
            <div style={{
              position: "absolute", top: -20, right: -20,
              width: 80, height: 80, borderRadius: "50%",
              background: "radial-gradient(circle, rgba(177,252,3,0.08) 0%, transparent 70%)",
            }} />

            <div style={{ marginBottom: 14, position: "relative" }}>{item.icon}</div>
            <div style={{
              fontSize: "0.9rem", fontWeight: 700, color: "#EDE9E0",
              marginBottom: 8, position: "relative",
            }}>
              {item.title}
            </div>
            <div style={{
              fontSize: "0.75rem", color: "rgba(237,233,224,0.5)",
              lineHeight: 1.55, position: "relative",
            }}>
              {item.desc}
            </div>

            {/* Coming soon tag */}
            <div style={{
              marginTop: 14, display: "inline-block",
              fontSize: "0.55rem", fontWeight: 600, fontFamily: "var(--font-mono)",
              padding: "3px 10px", borderRadius: 4,
              background: "rgba(177,252,3,0.1)", color: "rgba(177,252,3,0.5)",
              letterSpacing: "0.08em",
            }}>
              EMERGING USE CASE
            </div>
          </div>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════
          SECTION 5: SECURED BY STAKING
          ═══════════════════════════════════════════════════════ */}
      <div style={{
        background: "var(--tx-dark-green)",
        borderRadius: 14, padding: "28px 24px",
        border: "1px solid rgba(177,252,3,0.12)",
        marginBottom: 32, textAlign: "center",
        position: "relative", overflow: "hidden",
      }}>
        {/* Subtle background pattern */}
        <div style={{
          position: "absolute", inset: 0,
          background: "radial-gradient(circle at 20% 50%, rgba(177,252,3,0.05) 0%, transparent 50%), radial-gradient(circle at 80% 50%, rgba(177,252,3,0.03) 0%, transparent 50%)",
        }} />

        <div style={{ position: "relative" }}>
          <div style={{
            fontSize: "0.6rem", fontWeight: 600, letterSpacing: "0.1em",
            color: "rgba(177,252,3,0.5)", marginBottom: 12,
          }}>
            CONNECTED TO THE TX ECOSYSTEM
          </div>

          <h3 style={{
            fontSize: "1.15rem", fontWeight: 700, color: "#EDE9E0",
            marginBottom: 10, lineHeight: 1.3,
          }}>
            Every Smart Token is Secured by TX Validators
          </h3>

          <p style={{
            fontSize: "0.78rem", color: "rgba(237,233,224,0.5)",
            lineHeight: 1.6, maxWidth: 520, margin: "0 auto 20px",
          }}>
            The same validator set that powers your staking rewards and PSE distributions also secures every smart token on the network. When you stake TX, you&rsquo;re not just earning — you&rsquo;re helping secure the infrastructure for real-world assets.
          </p>

          <div style={{
            display: "flex", gap: 24, justifyContent: "center", flexWrap: "wrap",
          }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "1.3rem", fontWeight: 700, fontFamily: "var(--font-mono)", color: "#B1FC03" }}>
                {bondedTokens > 0 ? formatNumber(bondedTokens) : "..."}
              </div>
              <div style={{ fontSize: "0.6rem", color: "rgba(177,252,3,0.45)", marginTop: 2 }}>TX Staked</div>
            </div>
            <div style={{ width: 1, background: "rgba(177,252,3,0.15)", alignSelf: "stretch" }} />
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "1.3rem", fontWeight: 700, fontFamily: "var(--font-mono)", color: "#B1FC03" }}>
                {loading ? "..." : stats.totalTokens}
              </div>
              <div style={{ fontSize: "0.6rem", color: "rgba(177,252,3,0.45)", marginTop: 2 }}>Tokens Secured</div>
            </div>
            <div style={{ width: 1, background: "rgba(177,252,3,0.15)", alignSelf: "stretch" }} />
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "1.3rem", fontWeight: 700, fontFamily: "var(--font-mono)", color: "#B1FC03" }}>
                {loading ? "..." : rwaCount}
              </div>
              <div style={{ fontSize: "0.6rem", color: "rgba(177,252,3,0.45)", marginTop: 2 }}>Compliance-Ready</div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════
          SECTION 6: CTAs
          ═══════════════════════════════════════════════════════ */}
      <div style={{
        display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap",
        marginBottom: 32, padding: "0 20px",
      }}>
        <button
          onClick={() => setActiveTab("overview")}
          style={{
            padding: "12px 28px", borderRadius: 10,
            background: "var(--tx-neon)", color: "var(--tx-dark-green)",
            fontWeight: 700, fontSize: "0.82rem", border: "none",
            cursor: "pointer", transition: "transform 0.15s, box-shadow 0.15s",
            boxShadow: "0 2px 12px rgba(177,252,3,0.3)",
          }}
          onMouseOver={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; }}
          onMouseOut={(e) => { e.currentTarget.style.transform = "translateY(0)"; }}
        >
          Explore Staking →
        </button>
        <button
          onClick={() => setActiveTab("validators")}
          style={{
            padding: "12px 28px", borderRadius: 10,
            background: "transparent", color: "var(--tx-dark-green)",
            fontWeight: 700, fontSize: "0.82rem",
            border: "2px solid rgba(15,27,7,0.2)",
            cursor: "pointer", transition: "border-color 0.15s",
          }}
          onMouseOver={(e) => { e.currentTarget.style.borderColor = "var(--tx-neon)"; }}
          onMouseOut={(e) => { e.currentTarget.style.borderColor = "rgba(15,27,7,0.2)"; }}
        >
          View Validators
        </button>
        <button
          onClick={() => setActiveTab("pse")}
          style={{
            padding: "12px 28px", borderRadius: 10,
            background: "transparent", color: "var(--tx-dark-green)",
            fontWeight: 700, fontSize: "0.82rem",
            border: "2px solid rgba(15,27,7,0.2)",
            cursor: "pointer", transition: "border-color 0.15s",
          }}
          onMouseOver={(e) => { e.currentTarget.style.borderColor = "var(--tx-neon)"; }}
          onMouseOut={(e) => { e.currentTarget.style.borderColor = "rgba(15,27,7,0.2)"; }}
        >
          PSE Rewards
        </button>
      </div>

    </div>
  );
}
