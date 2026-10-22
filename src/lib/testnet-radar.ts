// Testnet radar: what is being deployed on TX testnet, by product line.
//
// Read straight from the chain, no collector. Testnet keeps every contract's
// creation height and its old blocks, so one scan answers "what appeared in
// the last 60 days" exactly. The scan is cached for an hour.
//
// Product line only, never the builder. Contract labels often carry a project
// name; the page shows a neutral component name derived from what the
// contract is (its Rust crate, which the contract reports when sent a query
// it does not know) and from keywords in the label. Labels are written by
// whoever deploys, so they are a hint, not a fact.
//
// "On mainnet" means the same compiled code (identical checksum) has been
// uploaded to mainnet. Testnet ustx-extension (code 3982) and mainnet code
// 691 share one, which is how USTX's extension moved across.

import { lcdGet } from "@/lib/chain-config";

// Server-side only. Public third-party node by default, same as stablecoins.
const TESTNET_LCD = process.env.STABLECOIN_TESTNET_LCD || "https://rest.testnet-1.tx.org";

export const WINDOW_DAYS = 56; // eight whole weeks, so the weekly columns line up
const MAX_CODES = 450;        // newest code ids scanned
const STALE_CODES_TO_STOP = 40; // consecutive codes with nothing in the window
const CONCURRENCY = 8;

export type LineId = "securities" | "repo" | "pools" | "oracle" | "staking" | "stablecoins" | "governance" | "launch" | "other";

export const LINES: { id: LineId; name: string; blurb: string }[] = [
  { id: "securities", name: "Tokenized securities", blurb: "Customer registry, compliance limits, broker order books, securities tokens" },
  { id: "repo", name: "Repo and credit", blurb: "Lending cash against tokenized collateral" },
  { id: "pools", name: "Pools and trading", blurb: "AMM pairs, routers, factories" },
  { id: "oracle", name: "Price oracles", blurb: "Prices posted on chain by feeders" },
  { id: "staking", name: "Liquid staking and rewards", blurb: "Staking hubs, reward vaults" },
  { id: "stablecoins", name: "Stablecoins", blurb: "Token extensions and minting programs" },
  { id: "governance", name: "DAOs and governance", blurb: "Voting, proposals, councils" },
  { id: "launch", name: "Launchpads and NFTs", blurb: "Token launches, crowdfunds, collections" },
  { id: "other", name: "Other", blurb: "Contracts that do not fit a line yet" },
];

// Ordered: first match wins. `text` is crate + label, lowercased.
const RULES: { line: LineId; re: RegExp; component: string }[] = [
  { line: "securities", re: /customer.?registry/, component: "customer registry" },
  { line: "securities", re: /compliance/, component: "compliance manager" },
  { line: "securities", re: /broker/, component: "broker" },
  { line: "securities", re: /order.?hub/, component: "order hub" },
  { line: "securities", re: /asset.?extension.?securit|securit/, component: "securities token extension" },
  { line: "repo", re: /repo/, component: "repo desk" },
  { line: "staking", re: /lst|liquid.?stak/, component: "liquid staking hub" },
  { line: "staking", re: /delegator.?reward/, component: "delegator rewards" },
  { line: "staking", re: /reward.?vault|rewards.?vault/, component: "rewards vault" },
  { line: "stablecoins", re: /minting.?bonus|dedup/, component: "minting bonus guard" },
  { line: "stablecoins", re: /ustx|stablecoin|asset.?extension/, component: "token extension" },
  { line: "oracle", re: /oracle|price.?board|price.?feed/, component: "price oracle" },
  { line: "pools", re: /timelock/, component: "timelock" },
  { line: "pools", re: /router/, component: "router" },
  { line: "pools", re: /factory/, component: "factory" },
  { line: "pools", re: /pair|pool/, component: "pool pair" },
  { line: "pools", re: /zap/, component: "zapper" },
  { line: "pools", re: /swap|dex|amm|astroport/, component: "trading" },
  { line: "governance", re: /pre.?propose/, component: "proposal gate" },
  { line: "governance", re: /propos/, component: "proposals" },
  { line: "governance", re: /voting|cw4/, component: "voting" },
  { line: "governance", re: /council/, component: "council" },
  { line: "governance", re: /dao|admin.?factory|multisig/, component: "DAO core" },
  { line: "launch", re: /launchpad|ilo/, component: "launchpad" },
  { line: "launch", re: /crowdfund/, component: "crowdfund" },
  { line: "launch", re: /airdrop/, component: "airdrop" },
  { line: "launch", re: /nft|cw721|collection|marketplace/, component: "NFT" },
];

export function classify(crate: string | null, label: string): { line: LineId; component: string } {
  const text = `${crate ?? ""} ${label}`.toLowerCase();
  for (const r of RULES) if (r.re.test(text)) return { line: r.line, component: r.component };
  return { line: "other", component: "contract" };
}

export interface RadarContract {
  line: LineId;
  component: string;
  codeId: number;
  createdHeight: number;
  createdAt: string | null;
  calls7d: number | null; // null when the count could not be read
  onMainnet: boolean;
}

export interface RadarLine {
  id: LineId;
  name: string;
  blurb: string;
  new7d: number;
  newWindow: number;
  calls7d: number;
  lastDeployed: string | null;
  onMainnet: number; // contracts whose code is also on mainnet
  weekly: number[];  // deployments per week, oldest first; the last entry is the past 7 days
  components: { name: string; deployments: number; lastDeployed: string | null; calls7d: number; onMainnet: boolean }[];
}

export interface Radar {
  asOf: string;
  windowDays: number;
  head: { height: number; time: string };
  totals: { new7d: number; newWindow: number; lines7d: number; calls7d: number; onMainnet: number };
  lines: RadarLine[];
  weeks: string[];    // start of each weekly column, oldest first
  weekly: number[];   // all lines together
  topUsed: { line: LineId; component: string; calls7d: number; contracts: number }[];
  latest: RadarContract[];
  scan: { codes: number; contracts: number; complete: boolean };
}

async function tn<T>(path: string): Promise<T> {
  const res = await fetch(`${TESTNET_LCD}${path}`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`testnet HTTP ${res.status} for ${path.split("?")[0]}`);
  return res.json() as Promise<T>;
}

async function pool<T, R>(items: T[], fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

type CodeInfo = { code_id: string; data_hash: string };

async function codesNewestFirst(get: <T>(p: string) => Promise<T>, limit: number): Promise<CodeInfo[]> {
  const codes: CodeInfo[] = [];
  let key = "";
  while (codes.length < limit) {
    const q = new URLSearchParams({ "pagination.limit": "200", "pagination.reverse": "true" });
    if (key) q.set("pagination.key", key);
    const d = await get<{ code_infos?: CodeInfo[]; pagination?: { next_key?: string | null } }>(`/cosmwasm/wasm/v1/code?${q}`);
    codes.push(...(d.code_infos ?? []));
    key = d.pagination?.next_key ?? "";
    if (!key) break;
  }
  return codes;
}

/** Every checksum uploaded to mainnet. Codes only, so a few pages. */
async function mainnetChecksums(): Promise<Set<string>> {
  const get = async <T,>(p: string): Promise<T> => {
    const res = await lcdGet(p);
    if (!res.ok) throw new Error(`mainnet HTTP ${res.status}`);
    return res.json() as Promise<T>;
  };
  const codes = await codesNewestFirst(get, 5000);
  return new Set(codes.map((c) => c.data_hash.toUpperCase()));
}

/** The contract's crate, from the error a query it does not know produces. */
async function crateOf(addr: string): Promise<string | null> {
  try {
    const q = encodeURIComponent(Buffer.from(JSON.stringify({ __radar__: {} })).toString("base64"));
    const res = await fetch(`${TESTNET_LCD}/cosmwasm/wasm/v1/contract/${addr}/smart/${q}`, { signal: AbortSignal.timeout(15_000) });
    const body = await res.json().catch(() => ({}));
    const m = /type ([\w]+)::/.exec(String(body?.message ?? ""));
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

async function calls7d(addr: string, fromHeight: number): Promise<number | null> {
  try {
    const q = new URLSearchParams({ query: `execute._contract_address='${addr}' AND tx.height>${fromHeight}`, limit: "1" });
    const d = await tn<{ total?: string; pagination?: { total?: string } }>(`/cosmos/tx/v1beta1/txs?${q}`);
    return Number(d.total ?? d.pagination?.total ?? 0);
  } catch {
    return null;
  }
}

async function blockTime(height: number): Promise<string | null> {
  try {
    const d = await tn<{ block: { header: { time: string } } }>(`/cosmos/base/tendermint/v1beta1/blocks/${height}`);
    return d.block.header.time;
  } catch {
    return null;
  }
}

async function scan(): Promise<Radar> {
  const latest = await tn<{ block: { header: { height: string; time: string } } }>("/cosmos/base/tendermint/v1beta1/blocks/latest");
  const head = { height: Number(latest.block.header.height), time: latest.block.header.time };
  // Block time from a 100,000 block sample, to turn days into heights.
  const past = await tn<{ block: { header: { time: string } } }>(`/cosmos/base/tendermint/v1beta1/blocks/${head.height - 100_000}`);
  const secPerBlock = (Date.parse(head.time) - Date.parse(past.block.header.time)) / 1000 / 100_000;
  const blocksPerDay = Math.round(86_400 / secPerBlock);
  const windowFloor = head.height - WINDOW_DAYS * blocksPerDay;
  const weekFloor = head.height - 7 * blocksPerDay;

  const [codes, mainnet] = await Promise.all([codesNewestFirst(tn, MAX_CODES), mainnetChecksums()]);

  // Walk codes newest first. New contracts mostly come from new code, so
  // stop once a long run of codes has nothing inside the window.
  type Found = { addr: string; codeId: number; hash: string; height: number; label: string };
  const found: Found[] = [];
  let stale = 0, scanned = 0, complete = true;
  for (const c of codes) {
    scanned++;
    const list = await tn<{ contracts?: string[] }>(`/cosmwasm/wasm/v1/code/${c.code_id}/contracts?pagination.limit=100`).catch(() => ({ contracts: [] as string[] }));
    const infos = await pool(list.contracts ?? [], (addr) =>
      tn<{ contract_info: { label?: string; created?: { block_height?: string } } }>(`/cosmwasm/wasm/v1/contract/${addr}`)
        .then((d) => ({ addr, label: d.contract_info.label ?? "", height: Number(d.contract_info.created?.block_height ?? 0) }))
        .catch(() => null),
    );
    let inWindow = 0;
    for (const i of infos) {
      if (i && i.height > windowFloor) {
        inWindow++;
        found.push({ addr: i.addr, codeId: Number(c.code_id), hash: c.data_hash.toUpperCase(), height: i.height, label: i.label });
      }
    }
    stale = inWindow ? 0 : stale + 1;
    if (stale >= STALE_CODES_TO_STOP) break;
    if (scanned === codes.length && codes.length >= MAX_CODES) complete = false;
  }

  const enriched = await pool(found, async (f) => {
    const [crate, calls, at] = await Promise.all([crateOf(f.addr), calls7d(f.addr, weekFloor), blockTime(f.height)]);
    const { line, component } = classify(crate, f.label);
    return { line, component, codeId: f.codeId, createdHeight: f.height, createdAt: at, calls7d: calls, onMainnet: mainnet.has(f.hash) } satisfies RadarContract;
  });

  const lines: RadarLine[] = LINES.map((l) => {
    const cs = enriched.filter((e) => e.line === l.id);
    const comps = new Map<string, RadarLine["components"][number]>();
    for (const e of cs) {
      const k = comps.get(e.component) ?? { name: e.component, deployments: 0, lastDeployed: null, calls7d: 0, onMainnet: false };
      k.deployments++;
      k.calls7d += e.calls7d ?? 0;
      k.onMainnet ||= e.onMainnet;
      if (e.createdAt && (!k.lastDeployed || e.createdAt > k.lastDeployed)) k.lastDeployed = e.createdAt;
      comps.set(e.component, k);
    }
    const last = cs.map((e) => e.createdAt).filter(Boolean).sort().pop() ?? null;
    return {
      ...l,
      new7d: cs.filter((e) => e.createdHeight > weekFloor).length,
      newWindow: cs.length,
      calls7d: cs.reduce((s, e) => s + (e.calls7d ?? 0), 0),
      lastDeployed: last,
      onMainnet: cs.filter((e) => e.onMainnet).length,
      weekly: [] as number[],
      components: [...comps.values()].sort((a, b) => (b.lastDeployed ?? "").localeCompare(a.lastDeployed ?? "")),
    };
  })
    .filter((l) => l.newWindow > 0)
    .sort((a, b) => b.new7d - a.new7d || (b.lastDeployed ?? "").localeCompare(a.lastDeployed ?? ""));

  const week = enriched.filter((e) => e.createdHeight > weekFloor);
  // Week 0 is the past 7 days. Columns run oldest first.
  const WEEKS = WINDOW_DAYS / 7;
  const weekOf = (h: number) => Math.min(WEEKS - 1, Math.floor((head.height - h) / (7 * blocksPerDay)));
  const weekly = (cs: RadarContract[]) => {
    const w = new Array(WEEKS).fill(0);
    for (const c of cs) w[WEEKS - 1 - weekOf(c.createdHeight)]++;
    return w;
  };
  const weeks = Array.from({ length: WEEKS }, (_, i) => new Date(Date.parse(head.time) - (WEEKS - i) * 7 * 86_400_000).toISOString());
  const used = new Map<string, { line: LineId; component: string; calls7d: number; contracts: number }>();
  for (const e of enriched) {
    if (!e.calls7d) continue;
    const k = `${e.line}|${e.component}`;
    const u = used.get(k) ?? { line: e.line, component: e.component, calls7d: 0, contracts: 0 };
    u.calls7d += e.calls7d;
    u.contracts++;
    used.set(k, u);
  }
  return {
    asOf: new Date().toISOString(),
    windowDays: WINDOW_DAYS,
    head,
    totals: {
      new7d: week.length,
      newWindow: enriched.length,
      lines7d: new Set(week.map((e) => e.line)).size,
      calls7d: enriched.reduce((s, e) => s + (e.calls7d ?? 0), 0),
      onMainnet: enriched.filter((e) => e.onMainnet).length,
    },
    lines: lines.map((l) => ({ ...l, weekly: weekly(enriched.filter((e) => e.line === l.id)) })),
    weeks,
    weekly: weekly(enriched),
    topUsed: [...used.values()].sort((a, b) => b.calls7d - a.calls7d).slice(0, 8),
    latest: [...enriched].sort((a, b) => b.createdHeight - a.createdHeight).slice(0, 25),
    scan: { codes: scanned, contracts: found.length, complete },
  };
}

// A full scan takes ~20s (hundreds of contract reads). Serve the last scan
// and refresh it in the background once it is an hour old, so only the very
// first request after a restart waits for one.
const REFRESH_MS = 60 * 60_000;
let last: Radar | null = null;
let running: Promise<Radar> | null = null;

function refresh(): Promise<Radar> {
  running ??= scan()
    .then((r) => { last = r; return r; })
    .finally(() => { running = null; });
  return running;
}

export async function testnetRadar(): Promise<Radar> {
  if (!last) return refresh();
  if (Date.now() - Date.parse(last.asOf) > REFRESH_MS) {
    refresh().catch((e) => console.warn(`[testnet-radar] background refresh failed: ${(e as Error).message}`));
  }
  return last;
}
