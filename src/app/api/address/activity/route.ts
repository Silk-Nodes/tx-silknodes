// GET /api/address/activity?address=core1...
//
// Full on-chain activity timeline for a wallet, straight from the public
// Coreum indexer. Unlike the VM-backed staking/flows tables (which only
// cover what our collectors watch), the indexer's message table has every
// message a wallet was ever involved in, so this card always has data.
//
// Two-step fetch because joining message -> transaction -> block times out
// on the indexer: (1) pull recent messages by involved address, (2) batch
// the distinct heights through block(where height _in ...) which is a fast
// PK lookup (<1s), and stitch timestamps in.
//
// Cache 2 min per address.

import { NextResponse } from "next/server";
import { Op } from "sequelize";
import { KnownEntity } from "@/lib/db/models";
import { hasuraQuery } from "@/lib/hasura";

const REFERRAL_PAYER = "core15sh9smq7ay5r430yetzn57v2rg666ma0ulzp84";
// Hardcoded labels for tx.market referral infra (not in known_entities).
const STATIC_LABELS: Record<string, string> = {
  [REFERRAL_PAYER]: "tx.market",
  core107466s7llr8rq0794l4e6jyek6rwgyzedatmar92zga9ld6j4x4qwxnlxm: "tx.market payout",
};
const UCORE_PER_TX = 1_000_000;
const LIMIT = 60;

const MSG_QUERY = `query Q($addr: [String!]!) {
  message(
    where: {involved_accounts_addresses: {_contains: $addr}},
    order_by: {height: desc},
    limit: ${LIMIT}
  ) { type height transaction_hash value }
}`;
const BLOCK_QUERY = `query B($hs: [bigint!]!) {
  block(where: {height: {_in: $hs}}) { height timestamp }
}`;
// Is this wallet a validator's self-delegate? Own query: the endpoint errors
// if validator_info is selected in the same document as message, so keep it
// standalone.
const VALIDATOR_QUERY = `query V($addr: String!) {
  validator_info(where: {self_delegate_address: {_eq: $addr}}) { operator_address }
}`;
// Wallet creation: the oldest message it was ever involved in. Ascending
// order works on the healthy backends, so the shared client's retry carries
// it through the stale ones.
const FIRSTSEEN_QUERY = `query F($arr: [String!]!) {
  message(where: {involved_accounts_addresses: {_contains: $arr}}, order_by: {height: asc}, limit: 1) { height }
}`;

export type ActivityKind =
  | "send" | "receive"
  | "delegate" | "undelegate" | "redelegate" | "claim_rewards"
  | "vote" | "referral_reward" | "ibc_transfer" | "contract" | "other";

interface ActivityItem {
  kind: ActivityKind;
  height: number;
  txHash: string;
  timestamp: string | null;
  amountTX?: number;
  counterparty?: string;      // other wallet / validator / contract
  counterpartyLabel?: string; // known-entity name (Kraken, tx.market, ...)
  detail?: string;            // vote option, proposal id, etc.
}

function ucore(amounts: any[]): number {
  return (amounts ?? []).reduce(
    (s, c) => (c?.denom === "ucore" ? s + Number(c.amount) : s), 0,
  ) / UCORE_PER_TX;
}

function classify(address: string, type: string, v: any): Omit<ActivityItem, "height" | "txHash" | "timestamp"> | null {
  switch (type) {
    case "/cosmos.bank.v1beta1.MsgSend": {
      const amt = ucore(v.amount);
      if (v.from_address === address) return { kind: "send", amountTX: amt, counterparty: v.to_address };
      if (v.to_address === address) return { kind: "receive", amountTX: amt, counterparty: v.from_address };
      return null;
    }
    case "/cosmos.staking.v1beta1.MsgDelegate":
      return { kind: "delegate", amountTX: ucore([v.amount]), counterparty: v.validator_address };
    case "/cosmos.staking.v1beta1.MsgUndelegate":
      return { kind: "undelegate", amountTX: ucore([v.amount]), counterparty: v.validator_address };
    case "/cosmos.staking.v1beta1.MsgBeginRedelegate":
      return { kind: "redelegate", amountTX: ucore([v.amount]), counterparty: v.validator_dst_address, detail: v.validator_src_address };
    case "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward":
      return { kind: "claim_rewards", counterparty: v.validator_address };
    case "/cosmos.gov.v1.MsgVote":
    case "/cosmos.gov.v1beta1.MsgVote":
      return { kind: "vote", detail: `#${v.proposal_id} ${String(v.option ?? "").replace("VOTE_OPTION_", "")}` };
    case "/ibc.applications.transfer.v1.MsgTransfer":
      return { kind: "ibc_transfer", amountTX: v.token?.denom === "ucore" ? Number(v.token.amount) / UCORE_PER_TX : undefined, counterparty: v.receiver };
    case "/cosmwasm.wasm.v1.MsgExecuteContract": {
      const p = v?.msg?.payout;
      if (v.sender === REFERRAL_PAYER && p?.key?.startsWith?.("ref-")) {
        const mine = (p.payouts ?? []).find((x: any) => x?.recipient === address);
        if (!mine) return null;
        const [referrer] = p.key.slice(4).split("-");
        return {
          kind: "referral_reward",
          amountTX: Number(mine.amount?.amount ?? 0) / UCORE_PER_TX,
          detail: address === referrer ? "as referrer" : "as new signup",
        };
      }
      // Only show contract calls the wallet itself made; being an incidental
      // involved account on someone else's execute is noise.
      if (v.sender === address) return { kind: "contract", counterparty: v.contract, amountTX: ucore(v.funds) || undefined };
      return null;
    }
    default:
      return null;
  }
}

const hasura = hasuraQuery;

let cache: { ts: number; key: string; body: unknown } | null = null;
const TTL_MS = 2 * 60 * 1000;

export async function GET(req: Request) {
  const address = (new URL(req.url).searchParams.get("address") || "").trim();
  if (!address.startsWith("core1") || address.length < 39) {
    return NextResponse.json({ error: "Enter a valid core1... address" }, { status: 400 });
  }
  if (cache && cache.key === address && Date.now() - cache.ts < TTL_MS) {
    return NextResponse.json(cache.body);
  }

  try {
    const [data, valData, firstData] = await Promise.all([
      hasura<{ message: { type: string; height: number; transaction_hash: string; value: any }[] }>(MSG_QUERY, { addr: [address] }),
      hasura<{ validator_info: { operator_address: string }[] }>(VALIDATOR_QUERY, { addr: address }).catch(() => ({ validator_info: [] })),
      hasura<{ message: { height: number }[] }>(FIRSTSEEN_QUERY, { arr: [address] }).catch(() => ({ message: [] })),
    ]);
    const rows = data.message ?? [];
    const validatorOperator = valData.validator_info?.[0]?.operator_address ?? null;
    const firstSeenHeight = firstData.message?.[0]?.height ?? null;

    const items: ActivityItem[] = [];
    for (const r of rows) {
      const c = classify(address, r.type, r.value ?? {});
      if (!c) continue;
      // Collapse reward claims: Restake-style auto-claims fire one
      // MsgWithdrawDelegatorReward per validator in a single tx, which
      // would flood the timeline with dozens of identical rows. Merge
      // them into one "claimed from N validators" item per tx.
      if (c.kind === "claim_rewards") {
        const prev = items[items.length - 1];
        if (prev?.kind === "claim_rewards" && prev.txHash === r.transaction_hash) {
          const n = (Number(prev.detail?.match(/^\d+/)?.[0]) || 1) + 1;
          prev.detail = `${n} validators`;
          prev.counterparty = undefined;
          continue;
        }
      }
      items.push({ ...c, height: r.height, txHash: r.transaction_hash, timestamp: null });
    }

    // Stitch in block timestamps (fast PK batch) + resolve first-seen time.
    let firstSeenTs: string | null = null;
    const heights = [...new Set([...items.map((i) => i.height), ...(firstSeenHeight ? [firstSeenHeight] : [])])];
    if (heights.length > 0) {
      const blocks = await hasura<{ block: { height: number; timestamp: string }[] }>(
        BLOCK_QUERY, { hs: heights },
      );
      const tsByHeight = new Map(blocks.block.map((b) => [b.height, b.timestamp]));
      for (const i of items) i.timestamp = tsByHeight.get(i.height) ?? null;
      if (firstSeenHeight) firstSeenTs = tsByHeight.get(firstSeenHeight) ?? null;
    }

    // Label counterparties from known_entities (exchanges etc.) + the
    // static tx.market map. Best-effort: if the DB is unavailable we just
    // ship the timeline without labels rather than failing.
    const cps = [...new Set(items.map((i) => i.counterparty).filter((a): a is string => !!a && a.startsWith("core1")))];
    const labels: Record<string, string> = {};
    if (cps.length > 0) {
      try {
        const rows = await KnownEntity.findAll({ where: { address: { [Op.in]: cps } }, raw: true });
        for (const r of rows) labels[(r as any).address] = (r as any).label;
      } catch { /* no DB (local) -> skip labels */ }
    }
    for (const i of items) {
      if (!i.counterparty) continue;
      const lbl = STATIC_LABELS[i.counterparty] ?? labels[i.counterparty];
      if (lbl) i.counterpartyLabel = lbl;
    }

    const body = {
      address,
      items,
      validatorOperator,
      firstSeen: firstSeenHeight ? { height: firstSeenHeight, timestamp: firstSeenTs } : null,
      updatedAt: new Date().toISOString(),
    };
    cache = { ts: Date.now(), key: address, body };
    return NextResponse.json(body);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load activity" },
      { status: 502 },
    );
  }
}
