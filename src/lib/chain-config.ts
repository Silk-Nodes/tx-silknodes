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
export const SILK_RPC = process.env.NEXT_PUBLIC_SILK_RPC || "https://rpc-coreum.ecostake.com";
export const SILK_LCD = process.env.NEXT_PUBLIC_SILK_LCD || "https://rest-coreum.ecostake.com";
export const FALLBACK_LCD = "https://full-node.mainnet-1.coreum.dev:1317";

/**
 * Ordered LCD pool. The configured host is tried first, then known-good
 * public nodes.
 *
 * Our own node (coreum-lcd.silknodes.io) has gone unreachable more than
 * once, and every call site that pointed at a single host reported the
 * outage as zeros: no delegations, no balance, no rewards. A reader cannot
 * tell "you have nothing staked" from "we could not ask". The API routes
 * were given a pool after the "validator not found" incident; the browser
 * side kept a single host until it produced the same bug on the wallet tab.
 */
export const LCD_POOL: string[] = Array.from(
  new Set([
    SILK_LCD,
    "https://rest-coreum.ecostake.com",
    "https://full-node.mainnet-1.coreum.dev:1317",
    "https://coreum-api.polkachu.com",
  ]),
);

/**
 * GET a path from the first LCD host that answers.
 *
 * A 404 is a real answer and is returned as-is: an address with no
 * delegations legitimately 404s on some hosts, and failing over on it would
 * hammer every node in the pool for a question already answered. Anything
 * else moves to the next host.
 *
 * Throws when every host fails, so callers surface an outage instead of
 * degrading to zero.
 */
export async function lcdGet(path: string, timeoutMs = FETCH_TIMEOUT): Promise<Response> {
  let lastErr: unknown = new Error("No LCD hosts configured");
  for (const host of LCD_POOL) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${host}${path}`, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok || res.status === 404) return res;
      lastErr = new Error(`HTTP ${res.status} from ${host}`);
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
    }
  }
  throw lastErr;
}
export const DIRECT_RPC = SILK_RPC;
export const DIRECT_LCD = SILK_LCD;

// Fetch with timeout (10s default) + automatic fallback to backup LCD
const FETCH_TIMEOUT = 10_000;


export async function fetchWithTimeout(url: string, options?: RequestInit, timeoutMs = FETCH_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } catch (err) {
    // Try fallback LCD if the URL uses primary LCD
    if (url.startsWith(SILK_LCD)) {
      const fallbackUrl = url.replace(SILK_LCD, FALLBACK_LCD);
      const controller2 = new AbortController();
      const timer2 = setTimeout(() => controller2.abort(), timeoutMs);
      try {
        const res2 = await fetch(fallbackUrl, { ...options, signal: controller2.signal });
        clearTimeout(timer2);
        if (!res2.ok) throw new Error(`Fallback HTTP ${res2.status}`);
        return res2;
      } catch {
        clearTimeout(timer2);
      }
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

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
