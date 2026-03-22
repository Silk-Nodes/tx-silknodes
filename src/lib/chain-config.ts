/**
 * TX chain configuration for Keplr + CosmJS
 *
 * Key facts:
 * - Chain ID: coreum-mainnet-1
 * - Denom: ucore (1 TX = 1,000,000 ucore)
 * - Display: TX (post-merger branding)
 * - BIP44 coin type: 990
 * - Min commission: 5%
 * - Unbonding: 7 days (604800s)
 * - Max validators: 64
 */

export const CHAIN_ID = "coreum-mainnet-1";
export const DENOM = "ucore";
export const DISPLAY_DENOM = "TX";
export const COIN_DECIMALS = 6;

// Silk Nodes validator
export const SILK_NODES_VALIDATOR = "corevaloper1kepnaw38rymdvq5sstnnytdqqkpd0xxwc5eqjk";
export const SILK_NODES_MONIKER = "Silk Nodes";
export const SILK_NODES_COMMISSION = 10; // 10%

// Endpoints (Coreum LCD supports CORS directly, no proxy needed)
export const SILK_RPC = process.env.NEXT_PUBLIC_SILK_RPC || "https://full-node.mainnet-1.coreum.dev:26657";
export const SILK_LCD = process.env.NEXT_PUBLIC_SILK_LCD || "https://full-node.mainnet-1.coreum.dev:1317";
export const DIRECT_RPC = SILK_RPC;
export const DIRECT_LCD = SILK_LCD;

export const COREUM_CHAIN_INFO = {
  chainId: CHAIN_ID,
  chainName: "TX",
  rpc: DIRECT_RPC,
  rest: DIRECT_LCD,
  bip44: {
    coinType: 990,
  },
  bech32Config: {
    bech32PrefixAccAddr: "core",
    bech32PrefixAccPub: "corepub",
    bech32PrefixValAddr: "corevaloper",
    bech32PrefixValPub: "corevaloperpub",
    bech32PrefixConsAddr: "corevalcons",
    bech32PrefixConsPub: "corevalconspub",
  },
  currencies: [
    {
      coinDenom: "TX",
      coinMinimalDenom: DENOM,
      coinDecimals: COIN_DECIMALS,
      coinGeckoId: "tx",
    },
  ],
  feeCurrencies: [
    {
      coinDenom: "TX",
      coinMinimalDenom: DENOM,
      coinDecimals: COIN_DECIMALS,
      coinGeckoId: "tx",
      gasPriceStep: {
        low: 0.0625,
        average: 0.1,
        high: 0.15,
      },
    },
  ],
  stakeCurrency: {
    coinDenom: "TX",
    coinMinimalDenom: DENOM,
    coinDecimals: COIN_DECIMALS,
    coinGeckoId: "tx",
  },
  features: ["cosmwasm"],
};

/**
 * Suggest TX chain to Keplr if not already added
 */
export async function suggestChainToKeplr(): Promise<void> {
  if (typeof window === "undefined" || !window.keplr) {
    throw new Error("Keplr wallet not found. Please install Keplr extension.");
  }

  try {
    await window.keplr.experimentalSuggestChain(COREUM_CHAIN_INFO as any);
  } catch (err) {
    console.error("Failed to suggest chain to Keplr:", err);
    throw err;
  }
}
