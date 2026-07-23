// GET /api/validator/[address]
//
// Everything the per-validator detail page needs, in one request:
//
//   validator   identity, tokens, full commission terms, status
//   uptime      missed blocks, tombstoned, jailed-until
//   selfBond    self-delegated amount and share
//   delegators  count, top holders, concentration
//   flow30d     the four flow components, plus WHERE redelegated stake
//               came from and went to (per counterparty validator)
//   governance  this validator's vote on every proposal it voted on
//   history     daily snapshots (empty until validator_snapshots fills up)
//
// Sources: chain LCD for live state, Postgres for flows and history,
// Hasura for the consensus/self-delegate mapping and the vote record.
//
// Each section is fetched independently and degrades to null/empty on
// failure, so one slow LCD call can't blank the whole page.

import { NextResponse } from "next/server";
import { QueryTypes } from "sequelize";
import { sequelize } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const LCD = "https://full-node.mainnet-1.coreum.dev:1317";
const HASURA = "https://hasura.mainnet-1.coreum.dev/v1/graphql";
const UCORE = 1_000_000;
const FLOW_DAYS = 30;
const TOP_DELEGATORS = 15;
const TOP_COUNTERPARTIES = 5;
const TIMEOUT_MS = 15_000;

const toTX = (v: string | number | null | undefined): number => {
  if (v === null || v === undefined) return 0;
  try { return Number(BigInt(String(v).split(".")[0])) / UCORE; } catch { return 0; }
};

async function getJSON<T>(url: string): Promise<T | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function hasura<T>(query: string, variables?: Record<string, unknown>): Promise<T | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(HASURA, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json.errors) return null;
    return json.data as T;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const VOTE_LABEL: Record<string, string> = {
  VOTE_OPTION_YES: "YES",
  VOTE_OPTION_NO: "NO",
  VOTE_OPTION_ABSTAIN: "ABSTAIN",
  VOTE_OPTION_NO_WITH_VETO: "NO_WITH_VETO",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;
  if (!address?.startsWith("corevaloper")) {
    return NextResponse.json({ error: "invalid validator address" }, { status: 400 });
  }

  // ── live chain state ──────────────────────────────────────────────
  const [vRes, poolRes, info] = await Promise.all([
    getJSON<{ validator: Record<string, any> }>(`${LCD}/cosmos/staking/v1beta1/validators/${address}`),
    getJSON<{ pool: { bonded_tokens: string } }>(`${LCD}/cosmos/staking/v1beta1/pool`),
    hasura<{ validator_info: { consensus_address: string; self_delegate_address: string }[] }>(
      `query($v:String!){ validator_info(where:{operator_address:{_eq:$v}}){ consensus_address self_delegate_address } }`,
      { v: address },
    ),
  ]);

  if (!vRes?.validator) {
    return NextResponse.json({ error: "validator not found" }, { status: 404 });
  }
  const v = vRes.validator;
  const tokens = toTX(v.tokens);
  const totalBonded = toTX(poolRes?.pool?.bonded_tokens);
  const consensusAddress = info?.validator_info?.[0]?.consensus_address || "";
  const selfDelegateAddress = info?.validator_info?.[0]?.self_delegate_address || "";

  // ── uptime, delegators, self-bond, votes ──────────────────────────
  const [signing, delegations, selfDel, votes, slashParams] = await Promise.all([
    consensusAddress
      ? getJSON<{ val_signing_info: Record<string, any> }>(
          `${LCD}/cosmos/slashing/v1beta1/signing_infos/${consensusAddress}`,
        )
      : Promise.resolve(null),
    getJSON<{ delegation_responses: any[]; pagination: { total: string } }>(
      `${LCD}/cosmos/staking/v1beta1/validators/${address}/delegations?pagination.limit=500&pagination.count_total=true`,
    ),
    selfDelegateAddress
      ? getJSON<{ delegation_response: { balance: { amount: string } } }>(
          `${LCD}/cosmos/staking/v1beta1/validators/${address}/delegations/${selfDelegateAddress}`,
        )
      : Promise.resolve(null),
    selfDelegateAddress
      ? hasura<{ proposal_vote: { proposal_id: number; option: string }[] }>(
          `query($v:String!){ proposal_vote(where:{voter_address:{_eq:$v}}, order_by:{proposal_id:desc}){ proposal_id option } }`,
          { v: selfDelegateAddress },
        )
      : Promise.resolve(null),
    getJSON<{ params: { signed_blocks_window: string } }>(`${LCD}/cosmos/slashing/v1beta1/params`),
  ]);

  // Delegator concentration. The LCD caps us at 500 rows; for validators
  // with more delegators the shares are still ranked, so the top-N and
  // concentration ratios remain correct even if the tail is truncated.
  const delRows = (delegations?.delegation_responses || [])
    .map((d) => ({
      address: d.delegation?.delegator_address as string,
      amount: toTX(d.balance?.amount),
    }))
    .filter((d) => d.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const delTotal = delRows.reduce((s, d) => s + d.amount, 0);
  const shareOf = (n: number) =>
    delTotal > 0 ? (delRows.slice(0, n).reduce((s, d) => s + d.amount, 0) / delTotal) * 100 : 0;

  const selfBonded = toTX(selfDel?.delegation_response?.balance?.amount);
  const window = Number(slashParams?.params?.signed_blocks_window ?? 0);
  const missed = signing?.val_signing_info ? Number(signing.val_signing_info.missed_blocks_counter) : null;

  // ── flows from Postgres ───────────────────────────────────────────
  let flow30d: Record<string, unknown> = {
    delegatedIn: 0, redelegatedIn: 0, undelegatedOut: 0, redelegatedOut: 0, net: 0,
    topSources: [], topDestinations: [],
  };
  let history: unknown[] = [];
  try {
    const [totals] = await sequelize.query<{
      delegated_in: string; redelegated_in: string; undelegated_out: string; redelegated_out: string;
    }>(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE type='delegate'   AND validator=:v), 0) AS delegated_in,
         COALESCE(SUM(amount) FILTER (WHERE type='redelegate' AND validator=:v), 0) AS redelegated_in,
         COALESCE(SUM(amount) FILTER (WHERE type='undelegate' AND validator=:v), 0) AS undelegated_out,
         COALESCE(SUM(amount) FILTER (WHERE type='redelegate' AND source_validator=:v), 0) AS redelegated_out
       FROM staking_events
       WHERE timestamp >= NOW() - (:days || ' days')::interval
         AND (validator = :v OR source_validator = :v)`,
      { replacements: { v: address, days: FLOW_DAYS }, type: QueryTypes.SELECT },
    );

    // Who this validator won stake FROM, and lost it TO. This is the part
    // no other TX explorer can answer, because it needs source_validator.
    const sources = await sequelize.query<{ counterparty: string; moniker: string | null; amount: string }>(
      `SELECT e.source_validator AS counterparty, val.moniker, SUM(e.amount) AS amount
       FROM staking_events e
       LEFT JOIN validators val ON val.operator_address = e.source_validator
       WHERE e.type='redelegate' AND e.validator = :v AND e.source_validator IS NOT NULL
         AND e.timestamp >= NOW() - (:days || ' days')::interval
       GROUP BY e.source_validator, val.moniker
       ORDER BY SUM(e.amount) DESC LIMIT :lim`,
      { replacements: { v: address, days: FLOW_DAYS, lim: TOP_COUNTERPARTIES }, type: QueryTypes.SELECT },
    );
    const dests = await sequelize.query<{ counterparty: string; moniker: string | null; amount: string }>(
      `SELECT e.validator AS counterparty, val.moniker, SUM(e.amount) AS amount
       FROM staking_events e
       LEFT JOIN validators val ON val.operator_address = e.validator
       WHERE e.type='redelegate' AND e.source_validator = :v
         AND e.timestamp >= NOW() - (:days || ' days')::interval
       GROUP BY e.validator, val.moniker
       ORDER BY SUM(e.amount) DESC LIMIT :lim`,
      { replacements: { v: address, days: FLOW_DAYS, lim: TOP_COUNTERPARTIES }, type: QueryTypes.SELECT },
    );

    const di = Number(totals?.delegated_in ?? 0);
    const ri = Number(totals?.redelegated_in ?? 0);
    const uo = Number(totals?.undelegated_out ?? 0);
    const ro = Number(totals?.redelegated_out ?? 0);
    flow30d = {
      delegatedIn: di, redelegatedIn: ri, undelegatedOut: uo, redelegatedOut: ro,
      net: di + ri - (uo + ro),
      topSources: sources.map((s) => ({ address: s.counterparty, moniker: s.moniker || "", amount: Number(s.amount) })),
      topDestinations: dests.map((s) => ({ address: s.counterparty, moniker: s.moniker || "", amount: Number(s.amount) })),
    };

    history = await sequelize.query(
      `SELECT date, tokens, delegator_count AS "delegatorCount",
              commission_rate AS "commissionRate", missed_blocks AS "missedBlocks"
       FROM validator_snapshots
       WHERE operator_address = :v
       ORDER BY date ASC`,
      { replacements: { v: address }, type: QueryTypes.SELECT },
    );
  } catch (err) {
    console.error("[validator] db section failed", err);
  }

  return NextResponse.json({
    validator: {
      operatorAddress: address,
      consensusAddress,
      selfDelegateAddress,
      moniker: v.description?.moniker || address.slice(0, 16),
      identity: v.description?.identity || "",
      website: v.description?.website || "",
      securityContact: v.description?.security_contact || "",
      details: v.description?.details || "",
      tokens,
      votingPowerPct: totalBonded > 0 ? (tokens / totalBonded) * 100 : 0,
      commissionRate: Number(v.commission?.commission_rates?.rate ?? 0),
      commissionMaxRate: Number(v.commission?.commission_rates?.max_rate ?? 0),
      commissionMaxChangeRate: Number(v.commission?.commission_rates?.max_change_rate ?? 0),
      commissionUpdatedAt: v.commission?.update_time || "",
      minSelfDelegation: toTX(v.min_self_delegation),
      jailed: Boolean(v.jailed),
      status: v.status || "",
    },
    uptime: {
      missedBlocks: missed,
      signedBlocksWindow: window || null,
      // Percentage over the chain's signed-blocks window, the same basis
      // the slashing module uses to decide jailing.
      uptimePct: missed !== null && window > 0 ? ((window - missed) / window) * 100 : null,
      tombstoned: signing?.val_signing_info ? Boolean(signing.val_signing_info.tombstoned) : null,
      jailedUntil: signing?.val_signing_info?.jailed_until || null,
    },
    selfBond: {
      amount: selfBonded,
      pct: tokens > 0 ? (selfBonded / tokens) * 100 : 0,
    },
    delegators: {
      count: delegations?.pagination?.total ? Number(delegations.pagination.total) : delRows.length,
      truncated: delRows.length >= 500,
      top: delRows.slice(0, TOP_DELEGATORS).map((d) => ({
        address: d.address,
        amount: d.amount,
        pct: delTotal > 0 ? (d.amount / delTotal) * 100 : 0,
      })),
      concentration: { top1Pct: shareOf(1), top5Pct: shareOf(5), top10Pct: shareOf(10) },
    },
    flow30d,
    flowWindowDays: FLOW_DAYS,
    governance: {
      votedCount: votes?.proposal_vote?.length ?? 0,
      votes: (votes?.proposal_vote || []).map((x) => ({
        proposalId: x.proposal_id,
        vote: VOTE_LABEL[x.option] || "UNKNOWN",
      })),
    },
    history,
  });
}
