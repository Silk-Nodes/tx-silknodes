/**
 * Historical chain lookups, served by the archive RPC.
 *
 * A pruning node cannot answer "what was true at height H", so anything
 * retrospective belongs here. Kept separate from chain-config so the archive
 * is never silently used for live reads, where a normal node is cheaper.
 */
import { ARCHIVE_RPC } from "./chain-config";

const BLOCK_SECONDS = 0.7426; // measured, not the 1s the params imply

async function rpc<T>(path: string, timeoutMs = 15_000): Promise<T | null> {
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), timeoutMs);
  try {
    const res = await fetch(`${ARCHIVE_RPC}${path}`, { signal: c.signal, cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface BlockResp { result?: { block: { header: { height: string; time: string } } } }

/** Current tip height and time, from the archive node. */
async function tip(): Promise<{ height: number; time: number } | null> {
  const d = await rpc<{ result?: { sync_info: { latest_block_height: string; latest_block_time: string } } }>("/status");
  const s = d?.result?.sync_info;
  if (!s) return null;
  return { height: Number(s.latest_block_height), time: Date.parse(s.latest_block_time) };
}

/**
 * Height of the block closest to a timestamp.
 *
 * Estimates from average block time, then corrects against the block actually
 * found. Two refinements are enough to land within a few blocks across the
 * whole chain; block time is stable here. Returns null rather than a guess if
 * the archive cannot be reached, so callers can omit a figure instead of
 * publishing an invented one.
 */
export async function heightAt(when: Date | string | number): Promise<number | null> {
  const target = typeof when === "number" ? when : Date.parse(String(when instanceof Date ? when.toISOString() : when));
  if (!Number.isFinite(target)) return null;
  const t = await tip();
  if (!t) return null;
  if (target >= t.time) return t.height;

  let height = Math.max(1, Math.round(t.height - (t.time - target) / 1000 / BLOCK_SECONDS));
  for (let i = 0; i < 2; i++) {
    const b = await rpc<BlockResp>(`/block?height=${height}`);
    const h = b?.result?.block?.header;
    if (!h) return null;
    const drift = (Date.parse(h.time) - target) / 1000;
    if (Math.abs(drift) < 60) break;
    height = Math.max(1, Math.min(t.height, Math.round(height - drift / BLOCK_SECONDS)));
  }
  return height;
}

interface BlockResults {
  result?: {
    finalize_block_events?: { type: string; attributes: { key: string; value: string }[] }[];
    begin_block_events?: { type: string; attributes: { key: string; value: string }[] }[];
  };
}

/**
 * Bonded stake in TX at a height, read from the mint event.
 *
 * The mint event carries bonded_ratio, inflation and annual_provisions every
 * block, and total supply falls out of provisions / inflation. That makes
 * bonded recoverable at any historical height without a staking-module query
 * the node would have pruned.
 */
export async function bondedAtHeight(height: number): Promise<number | null> {
  const d = await rpc<BlockResults>(`/block_results?height=${height}`, 25_000);
  const events = [
    ...(d?.result?.finalize_block_events ?? []),
    ...(d?.result?.begin_block_events ?? []),
  ];
  for (const e of events) {
    if (e.type !== "mint") continue;
    const kv: Record<string, string> = {};
    for (const a of e.attributes) kv[a.key] = a.value;
    const inflation = Number(kv.inflation);
    const provisions = Number(kv.annual_provisions) / 1e6;
    const ratio = Number(kv.bonded_ratio);
    if (!inflation || !Number.isFinite(provisions) || !Number.isFinite(ratio)) return null;
    return ratio * (provisions / inflation);
  }
  return null;
}

/** Bonded stake in TX at a point in time, or null when it cannot be established. */
export async function bondedAt(when: Date | string | number): Promise<number | null> {
  const h = await heightAt(when);
  return h === null ? null : bondedAtHeight(h);
}
