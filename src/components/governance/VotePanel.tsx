"use client";

import { useMemo, useState } from "react";
import { useCosmosWallet, VOTE_OPTION_VALUES } from "@/hooks/useCosmosWallet";
import type { UserDelegation } from "@/hooks/useUserDelegations";
import type { ValidatorVote, VoteOption } from "@/hooks/useProposalDetail";
import { formatTxAmount } from "@/lib/governance";

interface Props {
  proposalId: number;
  isActive: boolean;
  // Optional: lets the panel show "Your N validators voted X. Override?"
  // when supplied. Both must be present for the override summary.
  wallet?: ReturnType<typeof useCosmosWallet>;
  userDelegations?: UserDelegation[];
  validators?: ValidatorVote[];
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

const VOTE_LABEL: Record<VoteOption, string> = {
  YES: "Yes",
  NO: "No",
  ABSTAIN: "Abstain",
  NO_WITH_VETO: "Veto",
  DID_NOT_VOTE: "Did not vote",
};

export default function VotePanel({
  proposalId,
  isActive,
  wallet: walletProp,
  userDelegations = [],
  validators = [],
}: Props) {
  // If a wallet wasn't supplied (back-compat), instantiate one locally so
  // the panel still works on its own.
  const localWallet = useCosmosWallet();
  const wallet = walletProp ?? localWallet;

  const [submitting, setSubmitting] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [voteError, setVoteError] = useState<string | null>(null);

  // Compute how the user's validators voted so we can render the override
  // summary. Only runs when wallet is connected AND we have delegation data.
  const overrideSummary = useMemo(() => {
    if (!wallet.connected || userDelegations.length === 0 || validators.length === 0) return null;
    const opSet = new Set(userDelegations.map((d) => d.operatorAddress.toLowerCase()));
    const matched = validators.filter((v) => opSet.has(v.operatorAddress.toLowerCase()));
    if (matched.length === 0) return null;

    // Aggregate by vote option weighted by user's delegated TX (not the
    // validator's full bonded stake - we want "how is YOUR stake voting").
    const stakeByOp = new Map(userDelegations.map((d) => [d.operatorAddress.toLowerCase(), d.delegatedTX]));
    const byVote: Record<VoteOption, { count: number; stake: number; validators: string[] }> = {
      YES: { count: 0, stake: 0, validators: [] },
      NO: { count: 0, stake: 0, validators: [] },
      ABSTAIN: { count: 0, stake: 0, validators: [] },
      NO_WITH_VETO: { count: 0, stake: 0, validators: [] },
      DID_NOT_VOTE: { count: 0, stake: 0, validators: [] },
    };
    let totalStake = 0;
    for (const v of matched) {
      const stake = stakeByOp.get(v.operatorAddress.toLowerCase()) ?? 0;
      byVote[v.voteOption].count++;
      byVote[v.voteOption].stake += stake;
      byVote[v.voteOption].validators.push(v.moniker || v.operatorAddress.slice(0, 12));
      totalStake += stake;
    }
    return { matched, byVote, totalStake };
  }, [wallet.connected, userDelegations, validators]);

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

      {wallet.connected && overrideSummary && (
        <OverrideSummary summary={overrideSummary} />
      )}

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

function OverrideSummary({
  summary,
}: {
  summary: {
    matched: ValidatorVote[];
    byVote: Record<VoteOption, { count: number; stake: number; validators: string[] }>;
    totalStake: number;
  };
}) {
  // Surface the dominant vote option so the user can immediately see the
  // status of their stake without reading a table.
  const sides: VoteOption[] = ["YES", "NO", "NO_WITH_VETO", "ABSTAIN", "DID_NOT_VOTE"];
  const dominant = sides.reduce((best, side) => {
    const s = summary.byVote[side];
    return s.stake > summary.byVote[best].stake ? side : best;
  }, "DID_NOT_VOTE" as VoteOption);
  const total = summary.totalStake;
  return (
    <div className="vote-override">
      <div className="vote-override-head">
        <span className="vote-override-headline">
          Your <strong>{summary.matched.length}</strong> validator{summary.matched.length === 1 ? "" : "s"}{" "}
          {dominant === "DID_NOT_VOTE"
            ? "have not voted on this proposal yet."
            : <>voted predominantly <span className={`vvt-vote-badge vvt-vote-${dominant.toLowerCase()}`}>{VOTE_LABEL[dominant]}</span> on your behalf.</>}
        </span>
        <span className="vote-override-stake">
          {formatTxAmount(total)} TX of your stake
        </span>
      </div>
      <div className="vote-override-breakdown">
        {sides.map((side) => {
          const s = summary.byVote[side];
          if (s.count === 0) return null;
          const pct = total > 0 ? (s.stake / total) * 100 : 0;
          return (
            <div key={side} className={`vote-override-row vote-override-${side.toLowerCase()}`}>
              <span className={`vvt-vote-badge vvt-vote-${side.toLowerCase()}`}>{VOTE_LABEL[side]}</span>
              <span className="vote-override-count">
                {s.count} validator{s.count === 1 ? "" : "s"}
              </span>
              <span className="vote-override-validators">{s.validators.slice(0, 2).join(", ")}{s.validators.length > 2 ? ` +${s.validators.length - 2}` : ""}</span>
              <span className="vote-override-stake-small">
                {formatTxAmount(s.stake)} TX ({pct.toFixed(0)}%)
              </span>
            </div>
          );
        })}
      </div>
      <div className="vote-override-cta">
        Pick an option below to override. Your direct vote replaces the validator&apos;s vote for your stake.
      </div>
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
