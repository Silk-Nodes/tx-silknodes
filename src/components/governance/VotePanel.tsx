"use client";

import { useState } from "react";
import { useCosmosWallet, VOTE_OPTION_VALUES } from "@/hooks/useCosmosWallet";

interface Props {
  proposalId: number;
  isActive: boolean;
}

const OPTIONS: { key: keyof typeof VOTE_OPTION_VALUES; label: string; tone: string; warning?: string }[] = [
  { key: "YES", label: "Yes", tone: "yes" },
  { key: "NO", label: "No", tone: "no" },
  { key: "ABSTAIN", label: "Abstain", tone: "abstain" },
  {
    key: "NO_WITH_VETO",
    label: "No With Veto",
    tone: "veto",
    warning: "Veto means the proposal fails AND the proposer's deposit is burned. Use only when the proposal is spam or harmful.",
  },
];

export default function VotePanel({ proposalId, isActive }: Props) {
  const wallet = useCosmosWallet();
  const [submitting, setSubmitting] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [voteError, setVoteError] = useState<string | null>(null);

  const submit = async (option: keyof typeof VOTE_OPTION_VALUES) => {
    setSubmitting(true);
    setVoteError(null);
    setTxHash(null);
    try {
      const hash = await wallet.castVote(proposalId, VOTE_OPTION_VALUES[option]);
      setTxHash(hash);
    } catch (e) {
      setVoteError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (!isActive) {
    return null;
  }

  return (
    <div className="vote-panel">
      <div className="vote-panel-head">
        <div>
          <div className="vote-panel-title">Cast your vote</div>
          <div className="vote-panel-sub">
            Your vote is submitted directly to TX Network and overrides whatever
            your validators voted on your behalf for this proposal.
          </div>
        </div>
        <WalletButton wallet={wallet} />
      </div>

      {!wallet.connected ? (
        <div className="vote-panel-locked">
          Connect a wallet to vote on this proposal.
        </div>
      ) : (
        <>
          <div className="vote-panel-grid">
            {OPTIONS.map((o) => (
              <button
                key={o.key}
                type="button"
                className={`vote-panel-btn vote-panel-btn-${o.tone}`}
                disabled={submitting}
                onClick={() => {
                  if (o.warning && !confirm(`${o.warning}\n\nSubmit ${o.label} anyway?`)) return;
                  void submit(o.key);
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className="vote-panel-fineprint">
            Connected as <span className="mono">{shorten(wallet.address!)}</span>{" "}
            via {wallet.walletId === "keplr" ? "Keplr" : "Cosmostation"}
          </div>
        </>
      )}

      {submitting && <div className="vote-panel-status note">Submitting vote, confirm in your wallet...</div>}
      {txHash && (
        <div className="vote-panel-status ok">
          Vote submitted. Tx hash: <span className="mono">{shorten(txHash, 10)}</span>
        </div>
      )}
      {voteError && (
        <div className="vote-panel-status err">Vote failed: {voteError}</div>
      )}
    </div>
  );
}

function WalletButton({ wallet }: { wallet: ReturnType<typeof useCosmosWallet> }) {
  const [picking, setPicking] = useState(false);
  if (wallet.connected) {
    return (
      <button type="button" className="vote-wallet-btn connected" onClick={wallet.disconnect}>
        Disconnect
      </button>
    );
  }
  if (picking) {
    return (
      <div className="vote-wallet-picker">
        <button
          type="button"
          className="vote-wallet-pick keplr"
          disabled={wallet.connecting}
          onClick={() => { void wallet.connect("keplr"); setPicking(false); }}
        >
          Keplr
        </button>
        <button
          type="button"
          className="vote-wallet-pick cosmostation"
          disabled={wallet.connecting}
          onClick={() => { void wallet.connect("cosmostation"); setPicking(false); }}
        >
          Cosmostation
        </button>
        <button type="button" className="vote-wallet-pick cancel" onClick={() => setPicking(false)}>
          Cancel
        </button>
      </div>
    );
  }
  return (
    <button type="button" className="vote-wallet-btn" onClick={() => setPicking(true)}>
      {wallet.connecting ? "Connecting..." : "Connect wallet"}
    </button>
  );
}

function shorten(s: string, head = 8): string {
  if (!s) return "";
  if (s.length <= head * 2 + 3) return s;
  return `${s.slice(0, head)}...${s.slice(-6)}`;
}
