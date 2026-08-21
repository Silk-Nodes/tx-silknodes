"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pickRpc, resetRpcChoice, SILK_RPC, SILK_LCD } from "@/lib/chain-config";

// TX Network (rebranded Coreum) chain config. Keplr and Cosmostation use
// the same registry format. We feed both providers the same suggest payload
// and they handle it identically.
export const TX_CHAIN_ID = "coreum-mainnet-1";
// Wallet registration endpoints. These were pinned to
// full-node.mainnet-1.coreum.dev, which on 2026-08-21 ran ~19 minutes behind
// tip while reporting catching_up=false. Every vote signed through this page
// took its account sequence from that node, so the chain rejected the
// transaction with "account sequence mismatch, expected 1147, got 1146" and
// the voter was told their vote failed with no way to act on it.
//
// Signing now resolves a host through pickRpc(), which orders by measured lag.
// These constants remain only as the payload handed to the wallet extension
// for chain registration, and point at our own nodes, which are current.
// The previously configured coreum-rpc/coreum-lcd.silknodes.io hostnames do
// not resolve; the working endpoints are rpc/api.silknodes.io/coreum.
const TX_RPC = SILK_RPC;
const TX_REST = SILK_LCD;
const TX_DENOM = "ucore";
const TX_DECIMALS = 6;
const TX_PREFIX = "core";

const CHAIN_SUGGEST = {
  chainId: TX_CHAIN_ID,
  chainName: "TX Network",
  rpc: TX_RPC,
  rest: TX_REST,
  bip44: { coinType: 990 },
  bech32Config: {
    bech32PrefixAccAddr: TX_PREFIX,
    bech32PrefixAccPub: `${TX_PREFIX}pub`,
    bech32PrefixValAddr: `${TX_PREFIX}valoper`,
    bech32PrefixValPub: `${TX_PREFIX}valoperpub`,
    bech32PrefixConsAddr: `${TX_PREFIX}valcons`,
    bech32PrefixConsPub: `${TX_PREFIX}valconspub`,
  },
  currencies: [
    { coinDenom: "TX", coinMinimalDenom: TX_DENOM, coinDecimals: TX_DECIMALS },
  ],
  feeCurrencies: [
    {
      coinDenom: "TX",
      coinMinimalDenom: TX_DENOM,
      coinDecimals: TX_DECIMALS,
      gasPriceStep: { low: 0.0625, average: 0.0625, high: 0.0625 },
    },
  ],
  stakeCurrency: { coinDenom: "TX", coinMinimalDenom: TX_DENOM, coinDecimals: TX_DECIMALS },
  features: [],
};

export type WalletId = "keplr" | "cosmostation";

export interface WalletState {
  walletId: WalletId | null;
  address: string | null;
  connecting: boolean;
  error: string | null;
}

// Lightweight wallet API surface. We use the global KeplrLikeWallet type
// from src/types/keplr.d.ts (shared with the Leap wallet code path) rather
// than redeclaring. Both providers inject the same Keplr-compatible API.
interface OfflineSignerLike {
  getAccounts: () => Promise<{ address: string; pubkey: Uint8Array; algo: string }[]>;
}

declare global {
  interface Window {
    cosmostation?: {
      providers?: { keplr?: KeplrLikeWallet };
    };
  }
}

function getProvider(id: WalletId): KeplrLikeWallet | null {
  if (typeof window === "undefined") return null;
  if (id === "keplr") return window.keplr ?? null;
  if (id === "cosmostation") return window.cosmostation?.providers?.keplr ?? null;
  return null;
}

const STORAGE_KEY = "tx-gov-wallet";

interface PersistedWallet {
  walletId: WalletId;
  address: string;
}

function readPersisted(): PersistedWallet | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PersistedWallet) : null;
  } catch {
    return null;
  }
}

function writePersisted(value: PersistedWallet | null) {
  if (typeof window === "undefined") return;
  try {
    if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore quota / private-mode errors
  }
}

export function useCosmosWallet() {
  const [state, setState] = useState<WalletState>({
    walletId: null,
    address: null,
    connecting: false,
    error: null,
  });
  const signerRef = useRef<OfflineSignerLike | null>(null);

  // Auto-reconnect on mount if user previously connected. We do NOT
  // auto-prompt the wallet (silent reconnect) since both providers will
  // remember the user's grant for our origin.
  useEffect(() => {
    const persisted = readPersisted();
    if (!persisted) return;
    void connect(persisted.walletId, { silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = useCallback(async (walletId: WalletId, opts: { silent?: boolean } = {}) => {
    setState((s) => ({ ...s, connecting: true, error: null }));
    try {
      const provider = getProvider(walletId);
      if (!provider) {
        throw new Error(
          walletId === "keplr"
            ? "Keplr extension not detected. Install at keplr.app/get."
            : "Cosmostation extension not detected.",
        );
      }
      // Both providers will silently no-op if the chain is already added.
      // We swallow errors here because some Keplr versions throw on chains
      // they already know about.
      try { await provider.experimentalSuggestChain(CHAIN_SUGGEST); } catch { /* ignore */ }
      await provider.enable(TX_CHAIN_ID);
      const signer = provider.getOfflineSigner(TX_CHAIN_ID);
      const accounts = await signer.getAccounts();
      const address = accounts[0]?.address;
      if (!address) throw new Error("Wallet returned no accounts.");
      signerRef.current = signer;
      writePersisted({ walletId, address });
      setState({ walletId, address, connecting: false, error: null });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      // Silent reconnects shouldn't surface errors to the UI; the user
      // didn't ask for anything, the saved session just expired.
      if (opts.silent) {
        writePersisted(null);
        setState({ walletId: null, address: null, connecting: false, error: null });
      } else {
        setState({ walletId: null, address: null, connecting: false, error: message });
      }
    }
  }, []);

  const disconnect = useCallback(() => {
    signerRef.current = null;
    writePersisted(null);
    setState({ walletId: null, address: null, connecting: false, error: null });
  }, []);

  // Cast a governance vote via MsgVote. Returns the tx hash. We lazy-import
  // @cosmjs to keep it out of the initial bundle: most users browsing the
  // page never sign anything.
  const castVote = useCallback(
    async (proposalId: number, option: 1 | 2 | 3 | 4): Promise<string> => {
      if (!signerRef.current || !state.address) {
        throw new Error("Wallet not connected.");
      }
      const { SigningStargateClient, GasPrice } = await import("@cosmjs/stargate");
      // SigningStargateClient understands MsgVote via gov.v1beta1; we cast
      // the signer type because OfflineSignerLike is a structural subset.
      const msg = {
        typeUrl: "/cosmos.gov.v1beta1.MsgVote",
        value: {
          proposalId: BigInt(proposalId),
          voter: state.address,
          option, // 1=YES 2=ABSTAIN 3=NO 4=NO_WITH_VETO (SDK enum order)
        },
      };

      // Sequence mismatch is recoverable and worth one silent retry. It happens
      // when the node the transaction was built against is behind the chain, and
      // it costs the voter a second wallet prompt rather than a lost vote. We
      // retry once, re-resolving the RPC host so the second attempt does not
      // reuse a node that just proved itself stale.
      const attempt = async (): Promise<string> => {
        const client = await SigningStargateClient.connectWithSigner(
          await pickRpc(),
          signerRef.current as unknown as Parameters<typeof SigningStargateClient.connectWithSigner>[1],
          { gasPrice: GasPrice.fromString(`0.0625${TX_DENOM}`) },
        );
        try {
          const result = await client.signAndBroadcast(state.address!, [msg], "auto");
          if (result.code !== 0) {
            throw new Error(result.rawLog || `Tx failed with code ${result.code}`);
          }
          return result.transactionHash;
        } finally {
          client.disconnect();
        }
      };

      try {
        return await attempt();
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        if (!/account sequence mismatch/i.test(text)) throw err;
        resetRpcChoice();
        try {
          return await attempt();
        } catch (retryErr) {
          const retryText = retryErr instanceof Error ? retryErr.message : String(retryErr);
          if (/account sequence mismatch/i.test(retryText)) {
            throw new Error(
              "Your wallet and the network disagreed on your account sequence, so the vote was not cast. Nothing was submitted. Wait a few seconds and try again.",
            );
          }
          throw retryErr;
        }
      }
    },
    [state.address],
  );

  return {
    ...state,
    connect,
    disconnect,
    castVote,
    connected: !!state.address,
  };
}

// Maps the human-facing option name to the SDK enum integer used by
// MsgVote. Keep in sync with cosmos.gov.v1beta1.VoteOption.
export const VOTE_OPTION_VALUES: Record<"YES" | "ABSTAIN" | "NO" | "NO_WITH_VETO", 1 | 2 | 3 | 4> = {
  YES: 1,
  ABSTAIN: 2,
  NO: 3,
  NO_WITH_VETO: 4,
};
