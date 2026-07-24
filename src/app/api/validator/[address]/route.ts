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
// Recent stake events shown on the page. The collector stores only moves
// >= 5000 TX (MIN_AMOUNT_TX), so this is "significant events", not every tx.
const EVENT_LIMIT = 40;
const EVENT_MIN_TX = 5000;
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
  // The bonded set is fetched to rank this validator and to derive total
  // bonded, and the mint/distribution params give the delegator APR. All
  // parallel; each degrades independently.
  const [vRes, poolRes, info, setRes, provRes, distRes] = await Promise.all([
    getJSON<{ validator: Record<string, any> }>(`${LCD}/cosmos/staking/v1beta1/validators/${address}`),
    getJSON<{ pool: { bonded_tokens: string } }>(`${LCD}/cosmos/staking/v1beta1/pool`),
    hasura<{ validator_info: { consensus_address: string; self_delegate_address: string }[] }>(
      `query($v:String!){ validator_info(where:{operator_address:{_eq:$v}}){ consensus_address self_delegate_address } }`,
      { v: address },
    ),
    getJSON<{ validators: { operator_address: string; tokens: string; commission: { commission_rates: { rate: string } } }[] }>(
      `${LCD}/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=300`,
    ),
    getJSON<{ annual_provisions: string }>(`${LCD}/cosmos/mint/v1beta1/annual_provisions`),
    getJSON<{ params: { community_tax: string } }>(`${LCD}/cosmos/distribution/v1beta1/params`),
  ]);

  if (!vRes?.validator) {
    return NextResponse.json({ error: "validator not found" }, { status: 404 });
  }
  const v = vRes.validator;
  const tokens = toTX(v.tokens);
  const consensusAddress = info?.validator_info?.[0]?.consensus_address || "";
  const selfDelegateAddress = info?.validator_info?.[0]?.self_delegate_address || "";
  const commissionRate = Number(v.commission?.commission_rates?.rate ?? 0);
  const identity = v.description?.identity || "";

  // Rank by voting power across the bonded set, and total bonded from the
  // same list (falls back to the pool endpoint if the set didn't load).
  const setSorted = (setRes?.validators || [])
    .map((x) => ({ op: x.operator_address, t: toTX(x.tokens) }))
    .sort((a, b) => b.t - a.t);
  const rank = setSorted.findIndex((x) => x.op === address) + 1; // 0 -> unknown
  const validatorCount = setSorted.length;
  const totalBonded = setSorted.length
    ? setSorted.reduce((s, x) => s + x.t, 0)
    : toTX(poolRes?.pool?.bonded_tokens);

  // Delegator APR: the per-token reward rate (annual provisions net of
  // community tax, over total bonded) times this validator's take-home
  // share (1 - commission). This is base staking APR, PSE is on top.
  const annualProvisions = toTX(provRes?.annual_provisions);
  const communityTax = Number(distRes?.params?.community_tax ?? 0);
  const perTokenApr =
    totalBonded > 0 && annualProvisions > 0
      ? (annualProvisions * (1 - communityTax) / totalBonded) * 100
      : null;
  const delegatorApr = perTokenApr !== null ? perTokenApr * (1 - commissionRate) : null;

  // Network benchmarks so each stat reads with context. Commission average is
  // a straight mean across the bonded set; the average delegator APR applies
  // that average commission to the same per-token rate.
  const setCommissions = (setRes?.validators || []).map((x) =>
    Number(x.commission?.commission_rates?.rate ?? 0),
  );
  const avgCommission = setCommissions.length
    ? setCommissions.reduce((s, c) => s + c, 0) / setCommissions.length
    : null;
  const avgDelegatorApr =
    perTokenApr !== null && avgCommission !== null ? perTokenApr * (1 - avgCommission) : null;

  // ── uptime, delegators, self-bond, votes ──────────────────────────
  const [signing, delegations, selfDel, votes, slashParams, commRes, outRes, unbRes, kbRes] = await Promise.all([
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
      ? hasura<{ proposal_vote: { proposal_id: number; option: string; height: number }[] }>(
          // Ordered by height desc so that when a validator changed its vote
          // (the chain keeps both rows), the first row seen per proposal is
          // the latest, current vote. Deduped below.
          `query($v:String!){ proposal_vote(where:{voter_address:{_eq:$v}}, order_by:{height:desc}){ proposal_id option height } }`,
          { v: selfDelegateAddress },
        )
      : Promise.resolve(null),
    getJSON<{ params: { signed_blocks_window: string } }>(`${LCD}/cosmos/slashing/v1beta1/params`),
    getJSON<{ commission: { commission: { denom: string; amount: string }[] } }>(
      `${LCD}/cosmos/distribution/v1beta1/validators/${address}/commission`,
    ),
    getJSON<{ rewards: { rewards: { denom: string; amount: string }[] } }>(
      `${LCD}/cosmos/distribution/v1beta1/validators/${address}/outstanding_rewards`,
    ),
    getJSON<{ unbonding_responses: { entries: { balance: string }[] }[]; pagination: { total: string } }>(
      `${LCD}/cosmos/staking/v1beta1/validators/${address}/unbonding_delegations?pagination.limit=500&pagination.count_total=true`,
    ),
    // Keybase avatar from the identity key. Best-effort, degrades to no avatar.
    identity
      ? getJSON<{ them: { pictures?: { primary?: { url?: string } } }[] }>(
          `https://keybase.io/_/api/1.0/user/lookup.json?key_suffix=${encodeURIComponent(identity)}&fields=pictures`,
        )
      : Promise.resolve(null),
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

  // Reward economics. The distribution endpoints return decimal-coin amounts
  // (extra fractional precision), so take the integer part before converting.
  const ucoreOf = (arr?: { denom: string; amount: string }[]) => {
    const c = (arr || []).find((x) => x.denom === "ucore");
    return c ? toTX(c.amount) : 0;
  };
  const commissionAccrued = ucoreOf(commRes?.commission?.commission);
  const outstandingPool = ucoreOf(outRes?.rewards?.rewards);
  // Estimated monthly commission = this validator's slice of annual rewards
  // (net of community tax) times its commission rate, over 12.
  const estMonthlyCommission =
    totalBonded > 0 && annualProvisions > 0
      ? (annualProvisions * (1 - communityTax) * (tokens / totalBonded) * commissionRate) / 12
      : null;

  // Keybase avatar (may be absent) and the stake currently unbonding away.
  const avatarUrl = kbRes?.them?.[0]?.pictures?.primary?.url || "";
  const unbondingResponses = unbRes?.unbonding_responses || [];
  const unbondingTx = unbondingResponses.reduce(
    (s, r) => s + (r.entries || []).reduce((e, x) => e + toTX(x.balance), 0),
    0,
  );
  const unbondingWallets = unbRes?.pagination?.total ? Number(unbRes.pagination.total) : unbondingResponses.length;

  // ── flows from Postgres ───────────────────────────────────────────
  let flow30d: Record<string, unknown> = {
    delegatedIn: 0, redelegatedIn: 0, undelegatedOut: 0, redelegatedOut: 0, net: 0,
    topSources: [], topDestinations: [],
  };
  let history: unknown[] = [];
  let events: unknown[] = [];
  let delegatorFlow = { joined: 0, reduced: 0 };
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

    // Individual stake events, newest first. Note these are only moves of
    // >= 5000 TX: the VM collector applies that floor at write time, so
    // smaller delegations are not in the table at all. The UI says so
    // rather than implying this is every event.
    events = await sequelize.query(
      `SELECT tx_hash AS "txHash", height, timestamp, type, delegator, amount,
              source_validator AS "sourceValidator",
              CASE WHEN source_validator = :v THEN true ELSE false END AS outgoing
       FROM staking_events
       WHERE validator = :v OR source_validator = :v
       ORDER BY height DESC
       LIMIT :lim`,
      { replacements: { v: address, lim: EVENT_LIMIT }, type: QueryTypes.SELECT },
    );

    // Delegator churn by wallet count (distinct wallets), not TX. "joined" =
    // wallets that added stake here (delegate or redelegate in); "reduced" =
    // wallets that pulled stake out (undelegate, or redelegate to elsewhere).
    const [flow] = await sequelize.query<{ joined: string; reduced: string }>(
      `SELECT
         COUNT(DISTINCT delegator) FILTER (WHERE type IN ('delegate','redelegate') AND validator = :v) AS joined,
         COUNT(DISTINCT delegator) FILTER (
           WHERE (type = 'undelegate' AND validator = :v)
              OR (type = 'redelegate' AND source_validator = :v)
         ) AS reduced
       FROM staking_events
       WHERE (validator = :v OR source_validator = :v)
         AND timestamp >= NOW() - (:days || ' days')::interval`,
      { replacements: { v: address, days: FLOW_DAYS }, type: QueryTypes.SELECT },
    );
    delegatorFlow = { joined: Number(flow?.joined ?? 0), reduced: Number(flow?.reduced ?? 0) };
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
      avatarUrl,
      website: v.description?.website || "",
      securityContact: v.description?.security_contact || "",
      details: v.description?.details || "",
      tokens,
      votingPowerPct: totalBonded > 0 ? (tokens / totalBonded) * 100 : 0,
      rank: rank > 0 ? rank : null,
      validatorCount: validatorCount || null,
      delegatorApr,
      commissionRate,
      commissionMaxRate: Number(v.commission?.commission_rates?.max_rate ?? 0),
      commissionMaxChangeRate: Number(v.commission?.commission_rates?.max_change_rate ?? 0),
      commissionUpdatedAt: v.commission?.update_time || "",
      minSelfDelegation: toTX(v.min_self_delegation),
      jailed: Boolean(v.jailed),
      status: v.status || "",
    },
    // Network benchmarks so the UI can render "vs avg" context.
    benchmarks: {
      avgCommission: avgCommission !== null ? avgCommission * 100 : null,
      avgDelegatorApr,
      commissionVsAvg: avgCommission !== null ? (commissionRate - avgCommission) * 100 : null,
      aprVsAvg: delegatorApr !== null && avgDelegatorApr !== null ? delegatorApr - avgDelegatorApr : null,
    },
    rewards: {
      outstandingPoolTx: outstandingPool,
      commissionAccruedTx: commissionAccrued,
      estMonthlyCommissionTx: estMonthlyCommission,
    },
    unbonding: { amountTx: unbondingTx, walletCount: unbondingWallets },
    delegatorFlow30d: delegatorFlow,
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
    events,
    eventMinTx: EVENT_MIN_TX,
    governance: (() => {
      // Dedupe to one (latest) vote per proposal, then order newest-first.
      const seen = new Set<number>();
      const deduped: { proposalId: number; vote: string }[] = [];
      for (const x of votes?.proposal_vote || []) {
        if (seen.has(x.proposal_id)) continue; // height-desc, so first = latest
        seen.add(x.proposal_id);
        deduped.push({ proposalId: x.proposal_id, vote: VOTE_LABEL[x.option] || "UNKNOWN" });
      }
      deduped.sort((a, b) => b.proposalId - a.proposalId);
      return { votedCount: deduped.length, votes: deduped };
    })(),
    history,
  });
}
