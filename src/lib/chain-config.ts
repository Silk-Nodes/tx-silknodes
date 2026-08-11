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
 * Ordered RPC pool. Transactions sign over RPC, not LCD, so a dead RPC host
 * breaks delegate/undelegate/redelegate/claim with "Failed to fetch" while
 * read-only pages look healthy. Our own node has been unreachable, and every
 * signing call pointed at it alone.
 */
export const RPC_POOL: string[] = Array.from(
  new Set([
    SILK_RPC,
    "https://rpc-coreum.ecostake.com",
    "https://full-node.mainnet-1.coreum.dev:26657",
    "https://coreum-rpc.polkachu.com",
  ]),
);

/**
 * First RPC host that reports a healthy status, cached for the session.
 *
 * Probed with /status rather than by attempting a signature: a failover in
 * the middle of signing would ask the user to approve twice, and a broadcast
 * retried against a second host risks submitting the same transaction twice.
 * Picking the host BEFORE the wallet prompt keeps signing single-shot.
 */
let cachedRpc: string | null = null;
export async function pickRpc(timeoutMs = 6000): Promise<string> {
  if (cachedRpc) return cachedRpc;
  for (const host of RPC_POOL) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${host}/status`, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) { cachedRpc = host; return host; }
    } catch {
      clearTimeout(timer);
    }
  }
  throw new Error(
    "No TX chain RPC node is reachable right now, so the transaction was not sent. Nothing was signed or broadcast.",
  );
}

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
/**
 * The LCD host that last answered, remembered for the session.
 *
 * Without this the pool retried a dead host on EVERY request. With our own
 * node unreachable that meant 20+ ERR_NAME_NOT_RESOLVED in the console per
 * page load, a wasted round trip before each real one, and enough noise to
 * bury a genuine error. pickRpc already caches its choice; the LCD side did
 * not.
 *
 * Cleared when the remembered host fails, so a node that dies mid-session
 * sends the next call back through the full pool instead of pinning to it.
 */
let healthyLcd: string | null = null;

/** Pool order with the last known-good host first. */
function lcdOrder(preferred?: string): string[] {
  const head = [healthyLcd, preferred].filter(Boolean) as string[];
  return [...new Set([...head, ...LCD_POOL])];
}

export async function lcdGet(path: string, timeoutMs = FETCH_TIMEOUT): Promise<Response> {
  let lastErr: unknown = new Error("No chain hosts configured");
  for (const host of lcdOrder()) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${host}${path}`, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok || res.status === 404) { healthyLcd = host; return res; }
      lastErr = new Error(`HTTP ${res.status} from ${host}`);
    } catch (err) {
      clearTimeout(timer);
      if (healthyLcd === host) healthyLcd = null;
      lastErr = err;
    }
  }
  throw lastErr;
}
// Endpoints published TO the wallet via experimentalSuggestChain. Keplr and
// Leap store these, so a node that is down would be written into the user's
// wallet config and keep failing there after our own pages recovered. These
// deliberately use public nodes rather than whatever SILK_RPC/SILK_LCD point
// at; our own host is still tried first for this app's own reads, via the
// pools below.
export const DIRECT_RPC = "https://rpc-coreum.ecostake.com";
export const DIRECT_LCD = "https://rest-coreum.ecostake.com";

// Fetch with timeout (10s default) + automatic fallback to backup LCD
const FETCH_TIMEOUT = 10_000;


/**
 * Fetch with a timeout, walking the LCD or RPC pool when the URL points at
 * a host in either.
 *
 * This used to try SILK_LCD once and then a single FALLBACK_LCD. With our own
 * node unreachable and that one fallback carrying an expired certificate in
 * the browser, every one of the ~29 callers surfaced "Failed to fetch" while
 * three other healthy public nodes sat unused. Swapping the host prefix means
 * one fix covers all of them rather than 29 edits.
 *
 * URLs outside both pools keep the plain single-shot behaviour.
 */
export async function fetchWithTimeout(url: string, options?: RequestInit, timeoutMs = FETCH_TIMEOUT): Promise<Response> {
  // Both pools: fetchNetworkStatus calls ${SILK_RPC}/status through here, so
  // an LCD-only lookup left it pinned to a dead RPC and degrading to
  // blockHeight 0.
  const lcdBase = LCD_POOL.find((h) => url.startsWith(h));
  const rpcBase = lcdBase ? undefined : RPC_POOL.find((h) => url.startsWith(h));
  const base = lcdBase ?? rpcBase;
  const pool = lcdBase ? LCD_POOL : RPC_POOL;

  // Neither pool: time it out, but there is nothing to fail over to.
  if (!base) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  const path = url.slice(base.length);
  // Start at the host the caller asked for, then continue through the rest.
  const ordered = lcdBase ? lcdOrder(base) : [base, ...pool.filter((h) => h !== base)];
  let lastErr: unknown = new Error("No LCD hosts configured");
  for (const host of ordered) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${host}${path}`, { ...options, signal: controller.signal });
      clearTimeout(timer);
      // A 404 is a real answer, not a reason to ask another node.
      if (res.ok || res.status === 404) {
        if (lcdBase) healthyLcd = host;
        return res;
      }
      lastErr = new Error(`HTTP ${res.status} from ${host}`);
    } catch (err) {
      clearTimeout(timer);
      if (lcdBase && healthyLcd === host) healthyLcd = null;
      lastErr = err;
    }
  }
  throw lastErr;
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
