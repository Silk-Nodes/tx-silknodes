"use client";

import { useWallet } from "@/hooks/useWallet";

interface HeaderProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export default function Header({ activeTab, onTabChange }: HeaderProps) {
  const { wallet, loading, connect, disconnect } = useWallet();

  const tabs = [
    { id: "analytics", label: "ANALYTICS" },
    { id: "staking", label: "STAKING" },
    { id: "validator", label: "VALIDATORS" },
  ];

  const truncateAddress = (addr: string) =>
    addr ? `${addr.slice(0, 10)}...${addr.slice(-4)}` : "";

  return (
    <>
      {/* Header Row — black bar */}
      <div className="row header-row">
        <div className="cell brand-cell">
          <span className="brand-text">
            <span className="brand-all">ALL</span>
            <span className="brand-in">in</span>
            <span className="brand-one">ONE</span>
          </span>
          <div className="brand-icon">TX</div>
        </div>

        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`cell nav-cell ${activeTab === tab.id ? "active" : ""}`}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.label}
          </div>
        ))}

        <div
          className="cell nav-cell wallet-cell"
          onClick={() => wallet.connected ? disconnect() : connect()}
        >
          {loading ? (
            <span className="mono" style={{ color: "rgba(255,255,255,0.4)", fontSize: 10 }}>CONNECTING...</span>
          ) : wallet.connected ? (
            <>
              <span className="dot orange" />
              <span className="mono" style={{ color: "#fff", fontSize: 10 }}>
                {truncateAddress(wallet.address)}
              </span>
            </>
          ) : (
            <span>CONNECT</span>
          )}
        </div>
      </div>

      {/* Sub Header — thin accent line */}
      <div className="row sub-header-row">
        <div className="cell label" style={{ flex: 1, borderRight: "none", flexDirection: "row", gap: 8 }}>
          <span>TX NETWORK</span>
          <span style={{ color: "var(--accent-dark)" }}>·</span>
          <span style={{ color: "var(--accent-dark)" }}>MAINNET</span>
          <span style={{ color: "#d0d0d0" }}>·</span>
          <span>BUILT BY</span>
          <a
            href="https://silknodes.io"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--fg)", textDecoration: "none", fontWeight: 700, transition: "color 0.2s" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent-dark)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--fg)")}
          >
            SILK NODES
          </a>
        </div>
        <div
          className="cell label"
          style={{
            flex: "0 0 auto",
            borderLeft: "var(--line)",
            borderRight: "none",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            flexDirection: "row",
            gap: 6,
            paddingLeft: 20,
            paddingRight: 20,
          }}
        >
          <span className="dot orange animate-blink" />
          <span>LIVE</span>
        </div>
      </div>
    </>
  );
}
