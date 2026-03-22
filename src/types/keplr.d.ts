interface KeplrLikeWallet {
  enable: (chainId: string) => Promise<void>;
  getOfflineSigner: (chainId: string) => any;
  getOfflineSignerOnlyAmino: (chainId: string) => any;
  experimentalSuggestChain: (chainInfo: any) => Promise<void>;
  getKey: (chainId: string) => Promise<{
    name: string;
    algo: string;
    pubKey: Uint8Array;
    address: Uint8Array;
    bech32Address: string;
    isNanoLedger: boolean;
  }>;
}

interface Window {
  keplr?: KeplrLikeWallet;
  leap?: KeplrLikeWallet;
}
