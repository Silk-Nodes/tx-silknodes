"use client";

import { useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { delegateTokens } from "@/lib/wallet";
import { SILK_NODES_VALIDATOR } from "@/lib/chain-config";

export default function ValidatorCard() {
  const { wallet, connect } = useWallet();
  const [delegateAmount, setDelegateAmount] = useState("");
  const [showDelegate, setShowDelegate] = useState(false);
  const [delegating, setDelegating] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDelegate = async () => {
    if (!wallet.connected) { connect(); return; }
    const amount = parseFloat(delegateAmount);
    if (!amount || amount <= 0) { setShowDelegate(true); return; }

    setDelegating(true);
    setError(null);
    setResult(null);
    try {
      const txHash = await delegateTokens(SILK_NODES_VALIDATOR, amount);
      setResult(txHash);
      setDelegateAmount("");
      setShowDelegate(false);
    } catch (err: any) {
      setError(err.message || "Delegation failed");
    } finally {
      setDelegating(false);
    }
  };

  return (
    <div className="cell area-validator" style={{ padding: 14 }}>
      <div className="cell-content">
        <div className="cell-header" style={{ marginBottom: 4 }}>
          <span className="label">Delegate to</span>
        </div>

        <div className="value-medium" style={{ marginBottom: 6, fontSize: 13 }}>Silk Nodes</div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 8px" }}>
          {[
            ["COMMISSION", "10%"],
            ["UPTIME", "99.99%"],
            ["VOTING PWR", "3.2M TX"],
            ["UNBONDING", "7 days"],
          ].map(([label, value]) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid #f0f0f0" }}>
              <span className="label" style={{ fontSize: 7 }}>{label}</span>
              <span className="mono" style={{ fontSize: 10, fontWeight: 600 }}>{value}</span>
            </div>
          ))}
        </div>

        <div style={{ marginTop: "auto", paddingTop: 8 }}>
          {showDelegate && wallet.connected ? (
            <div>
              <span className="label" style={{ fontSize: 7, display: "block", marginBottom: 2 }}>
                AVAILABLE: {wallet.balance.toFixed(2)} TX
              </span>
              <div className="input-group" style={{ marginBottom: 0, height: 26 }}>
                <input type="text" value={delegateAmount} onChange={(e) => setDelegateAmount(e.target.value)} placeholder="Amount" style={{ fontSize: 10 }} />
                <div className="input-addon label" style={{ fontSize: 7 }}>TX</div>
                <button className="input-action" style={{ fontSize: 7 }} onClick={() => setDelegateAmount(Math.max(0, wallet.balance - 1).toString())}>MAX</button>
              </div>
              <button className="btn primary" onClick={handleDelegate} disabled={delegating} style={{ opacity: delegating ? 0.5 : 1, height: 28, fontSize: 8 }}>
                {delegating ? "SIGNING..." : "CONFIRM DELEGATION"}
              </button>
            </div>
          ) : (
            <button className="btn primary" onClick={handleDelegate} style={{ height: 28, fontSize: 8 }}>
              {wallet.connected ? "DELEGATE" : "CONNECT & DELEGATE"}
            </button>
          )}

          {result && (
            <div style={{ marginTop: 4, padding: 3, background: "var(--accent-bg)", borderRadius: 2 }}>
              <span className="label" style={{ fontSize: 7, color: "var(--accent-dark)" }}>Done {result.slice(0, 12)}...</span>
            </div>
          )}
          {error && (
            <div style={{ marginTop: 4, padding: 3, background: "rgba(229,62,62,0.05)", borderRadius: 2 }}>
              <span className="label" style={{ fontSize: 7, color: "var(--danger)" }}>{error}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
