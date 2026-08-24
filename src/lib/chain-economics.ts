/**
 * Real token issuance, which is not what annual_provisions says.
 *
 * The mint module mints `annual_provisions / blocks_per_year` every block.
 * blocks_per_year is a PARAMETER, not a measurement, and on this chain it is
 * set to 33,000,000 while the chain actually produces about 42,478,000 blocks
 * a year at its ~0.742s block time. Minting is per block, so the chain issues
 * roughly 1.287x what annual_provisions reports.
 *
 * Measured against mainnet over 100,000 blocks:
 *
 *   mint event amount per block   10.3613 TX
 *   annual_provisions/33,000,000  10.3613 TX     exact match
 *   real blocks/year              42,478,448
 *   actual issued per year        440,132,201 TX
 *   annual_provisions reports     341,923,129 TX
 *
 * Every APR and validator-income figure on this site divided
 * annual_provisions by bonded stake, so all of them understated the real
 * return by that factor: 9.28% shown against 11.95% actually paid.
 *
 * This is not a rounding detail. It is the difference between telling a
 * delegator they earn 9.3% and 12%, and it flows into the validator income
 * estimates operators use to decide whether running a node pays.
 */
import { SILK_LCD, SILK_RPC, fetchWithTimeout } from "./chain-config";

/** Seconds in a year, the numerator the SDK assumes for blocks_per_year. */
const SECONDS_PER_YEAR = 31_536_000;
/** Window for the block-time measurement. Wide enough that a few slow blocks
 *  do not move it, short enough to stay on a pruning node. */
const SAMPLE_BLOCKS = 20_000;
const CACHE_MS = 10 * 60 * 1000;

let cached: { factor: number; blockSeconds: number; at: number } | null = null;

async function blockTimeAt(height: number | "latest"): Promise<{ height: number; time: number } | null> {
  try {
    const path = height === "latest" ? "/block" : `/block?height=${height}`;
    const res = await fetchWithTimeout(`${SILK_RPC}${path}`, undefined, 12_000);
    if (!res.ok) return null;
    const body = await res.json();
    const h = body?.result?.block?.header;
    if (!h) return null;
    return { height: Number(h.height), time: Date.parse(h.time) };
  } catch {
    return null;
  }
}

/**
 * How much more the chain issues than annual_provisions reports.
 *
 * Returns 1 when it cannot be established, so a failure understates rather
 * than invents a larger number. Never throws: an APR that is slightly low
 * beats a page that will not render.
 */
export async function issuanceFactor(): Promise<{ factor: number; blockSeconds: number }> {
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return { factor: cached.factor, blockSeconds: cached.blockSeconds };
  }
  const fallback = { factor: 1, blockSeconds: 0 };
  try {
    const tip = await blockTimeAt("latest");
    if (!tip) return fallback;
    const past = await blockTimeAt(tip.height - SAMPLE_BLOCKS);
    if (!past) return fallback;

    const blockSeconds = (tip.time - past.time) / 1000 / (tip.height - past.height);
    if (!(blockSeconds > 0.05 && blockSeconds < 30)) return fallback;

    const paramsRes = await fetchWithTimeout(`${SILK_LCD}/cosmos/mint/v1beta1/params`, undefined, 12_000);
    if (!paramsRes.ok) return fallback;
    const configured = Number((await paramsRes.json())?.params?.blocks_per_year);
    if (!(configured > 0)) return fallback;

    const realBlocksPerYear = SECONDS_PER_YEAR / blockSeconds;
    const factor = realBlocksPerYear / configured;
    // A factor far from 1 in either direction means something we do not
    // understand changed. Fall back rather than publish a wild number.
    if (!(factor > 0.5 && factor < 3)) return fallback;

    cached = { factor, blockSeconds, at: Date.now() };
    return { factor, blockSeconds };
  } catch {
    return fallback;
  }
}

/**
 * TX actually issued per year, correcting annual_provisions for the real
 * block rate. Pass the annual_provisions value already converted to TX.
 */
export async function realAnnualIssuance(annualProvisionsTX: number): Promise<number> {
  const { factor } = await issuanceFactor();
  return annualProvisionsTX * factor;
}
