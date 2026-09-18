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
import { realAnnualIssuance } from "@/lib/chain-economics";
import { QueryTypes } from "sequelize";
import { sequelize } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Ordered LCD pool, not a single host. The page used to hardcode the first
// one, so whenever that node went down EVERY validator page returned
// "validator not found" as though the validator had ceased to exist. Public
// nodes do go down: at the time of writing both coreum.dev and our own
// coreum-lcd.silknodes.io were refusing connections while ecostake served
// fine. LCD_HOSTS[0] stays primary; the rest are only tried on failure.
const LCD_HOSTS = [
  "https://full-node.mainnet-1.coreum.dev:1317",
  "https://rest-coreum.ecostake.com",
  "https://coreum-lcd.silknodes.io",
];
// Kept so existing `${LCD}/path` template literals still resolve; every call
// goes through getJSON, which retries the same path across the pool.
const LCD = LCD_HOSTS[0];
const HASURA = "https://hasura.mainnet-1.coreum.dev/v1/graphql";
const UCORE = 1_000_000;
const FLOW_DAYS = 30;
const TOP_DELEGATORS = 25;
const TOP_COUNTERPARTIES = 5;
// First page of stake events shipped inline with the page. Further pages
// come from /api/validator/[address]/events via "Load more" (cursor on
// height), so the tab is no longer capped. Collector stores only moves
// >= 5000 TX, so this is "significant events", not every tx.
const EVENT_LIMIT = 50;
const EVENT_MIN_TX = 5000;
const TIMEOUT_MS = 15_000;

const toTX = (v: string | number | null | undefined): number => {
  if (v === null || v === undefined) return 0;
  try { return Number(BigInt(String(v).split(".")[0])) / UCORE; } catch { return 0; }
};

async function fetchOnce<T>(url: string): Promise<T | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    // A 404 is a real answer ("this validator does not exist") and must not
    // trigger failover, otherwise a genuinely bad address costs three slow
    // round trips. Only transport errors and 5xx fall through to the pool.
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

async function getJSON<T>(url: string): Promise<T | null> {
  // Only LCD calls get the failover treatment; other hosts pass through.
  if (!url.startsWith(LCD)) {
    try { return await fetchOnce<T>(url); } catch { return null; }
  }
  const path = url.slice(LCD.length);
  for (const host of LCD_HOSTS) {
    try {
      return await fetchOnce<T>(`${host}${path}`);
    } catch {
      // try the next host
    }
  }
  return null;
}

// Walk every page of a paginated LCD list endpoint.
//
// This exists because the delegations endpoint returns rows in STORE order,
// not sorted by amount. Fetching a single capped page and sorting it looks
// like "the top delegators" but is not: for BRW Capital the largest delegator
// sat at index 546 of 607, so a 500-row fetch omitted the biggest holder
// entirely and computed concentration against a partial total. 7 of 52
// validators have more than 500 delegators, including 007TX at 2130.
async function getAllPages<T>(
  path: string,
  pick: (page: any) => T[],
  maxPages = 8,
): Promise<{ rows: T[]; total: number; complete: boolean }> {
  const rows: T[] = [];
  let key: string | null = null;
  let total = 0;
  for (let page = 0; page < maxPages; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const q = key
      ? `${sep}pagination.limit=1000&pagination.key=${encodeURIComponent(key)}`
      : `${sep}pagination.limit=1000&pagination.count_total=true`;
    const d: any = await getJSON<any>(`${LCD}${path}${q}`);
    if (!d) break;
    const batch = pick(d) || [];
    rows.push(...batch);
    if (page === 0) total = Number(d?.pagination?.total ?? 0) || 0;
    key = d?.pagination?.next_key ?? null;
    if (!key || batch.length === 0) {
      return { rows, total: total || rows.length, complete: true };
    }
  }
  // Hit the page ceiling. Report it rather than silently presenting a
  // partial set as if it were the whole thing.
  return { rows, total: total || rows.length, complete: false };
}

/**
 * Identity facts for one validator, from our own Postgres.
 *
 * Returns null when the row is missing so the caller can fall back rather
 * than render a validator with no consensus address (no uptime) and no
 * self-delegate address (no governance record).
 */
type LocalIdentity = {
  consensus_address: string | null;
  self_delegate_address: string | null;
  avatar_url: string | null;
};
async function localIdentity(address: string): Promise<LocalIdentity | null> {
  try {
    const [row] = await sequelize.query<LocalIdentity>(
      `SELECT consensus_address, self_delegate_address, avatar_url
         FROM validator_identity WHERE operator_address = :v`,
      { replacements: { v: address }, type: QueryTypes.SELECT },
    );
    // A row with neither address is no better than no row: the collector has
    // seen this validator but the indexer had not published it yet.
    if (!row || (!row.consensus_address && !row.self_delegate_address)) return null;
    return row;
  } catch {
    return null;
  }
}

/**
 * Every vote this address has cast, from our own gov_votes.
 *
 * Shaped like the Hasura response it replaces so the merge below is
 * untouched. Ordered by proposal so a changed vote resolves the same way.
 * Returns null on failure rather than an empty list: an empty list reads as
 * "this validator has never voted", which is a claim, and a database we could
 * not reach is not entitled to make it.
 */
async function localVotes(voter: string) {
  try {
    const rows = await sequelize.query<{ proposal_id: number; option: string; height: number | null }>(
      `SELECT proposal_id, option, observed_height AS height
         FROM gov_votes WHERE voter_address = :v ORDER BY proposal_id DESC`,
      { replacements: { v: voter }, type: QueryTypes.SELECT },
    );
    return { proposal_vote: rows.map((r) => ({ ...r, option: `VOTE_OPTION_${r.option}` })) };
  } catch {
    return null;
  }
}

/** Proposals this consensus address was in the validator set for. */
async function localTenure(consensus: string) {
  try {
    const rows = await sequelize.query<{ proposal_id: number }>(
      `SELECT proposal_id FROM gov_validator_status WHERE validator_address = :c`,
      { replacements: { c: consensus }, type: QueryTypes.SELECT },
    );
    // No rows is a real answer for a validator that joined after the last
    // settled proposal, but it is indistinguishable from a table that was
    // never backfilled. Fall back so a fresh deploy is not silently wrong.
    if (rows.length === 0) return null;
    return { proposal_validator_status_snapshot: rows };
  } catch {
    return null;
  }
}

/** Live indexer lookup, used only when localIdentity comes back empty. */
async function liveIdentity(address: string): Promise<LocalIdentity | null> {
  const r = await hasura<{ validator_info: { consensus_address: string; self_delegate_address: string }[] }>(
    `query($v:String!){ validator_info(where:{operator_address:{_eq:$v}}){ consensus_address self_delegate_address } }`,
    { v: address },
  );
  const row = r?.validator_info?.[0];
  return row
    ? { consensus_address: row.consensus_address, self_delegate_address: row.self_delegate_address, avatar_url: null }
    : null;
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


// The full historical vote record, read from the chain and committed as
// static data. Merged with (never overridden by) whatever Hasura returns.
//
// This exists because Hasura loses votes two different ways. It holds no
// votes at all for proposals 1, 2, 4, 5, 6, 7, 8, 40 and 42, and it also
// drops INDIVIDUAL votes inside proposals it does index: it has votes for
// proposals 9 and 10 but not TX Forge's. Those votes cannot be re-read live,
// because the SDK deletes votes once a proposal settles, leaving the vote
// TRANSACTION as the only surviving evidence.
//
// Reading the tx index per request does not work either. Both of the node's
// relevant indexes are individually incomplete for 2023 heights: querying
// `message.sender` misses TX Forge on proposals 6 and 8, querying
// `proposal_vote.proposal_id` misses it on proposal 5. Only the union of both
// is correct, and that is thousands of transactions, far too much per request.
//
// So it is done once, offline, and checked in. Every proposal here has
// settled, and settled votes are immutable, so this is a snapshot rather than
// a cache that can go stale. Regenerate with scripts/backfill-votes.mjs.
import HISTORICAL_VOTES from "@/data/historical-votes.json";

function archivedVotes(voter: string): Map<number, string> {
  const found = new Map<number, string>();
  for (const [pid, voters] of Object.entries(
    HISTORICAL_VOTES as Record<string, Record<string, string>>,
  )) {
    const opt = voters[voter];
    if (opt) found.set(Number(pid), opt);
  }
  return found;
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
    // Our own copy, not the indexer. These two addresses gate everything in
    // the second stage below, so the request could not proceed until Coreum's
    // Hasura answered: 767ms cold, 489ms warm, and it happened twice per
    // request because the second call needed the first one's result. That
    // was most of a 1.2 to 1.6s endpoint. Both values are static per
    // validator and the identity collector now caches them.
    localIdentity(address),
    getJSON<{ validators: { operator_address: string; tokens: string; commission: { commission_rates: { rate: string } } }[] }>(
      `${LCD}/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=300`,
    ),
    getJSON<{ annual_provisions: string }>(`${LCD}/cosmos/mint/v1beta1/annual_provisions`),
    getJSON<{ params: { community_tax: string } }>(`${LCD}/cosmos/distribution/v1beta1/params`),
  ]);

  if (!vRes?.validator) {
    // Distinguish "no such validator" from "we could not reach the chain".
    // Reporting an LCD outage as 404 made every validator page claim the
    // validator did not exist, which is both wrong and alarming to read.
    // Stateless signal, safe under concurrency: /pool is address-independent,
    // so if it also came back empty the whole LCD pool is down, whereas a
    // genuinely unknown address fails on its own while /pool still answers.
    if (!poolRes?.pool) {
      return NextResponse.json(
        { error: "chain node unreachable, please retry in a moment" },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "validator not found" }, { status: 404 });
  }
  const v = vRes.validator;
  const tokens = toTX(v.tokens);
  // A validator created since the collector last ran has no row yet. Fall
  // back to the indexer for that one reader rather than rendering a page
  // with no uptime and no governance record.
  const addrs = info ?? (await liveIdentity(address));
  const consensusAddress = addrs?.consensus_address || "";
  const selfDelegateAddress = addrs?.self_delegate_address || "";
  const commissionRate = Number(v.commission?.commission_rates?.rate ?? 0);
  const identity = v.description?.identity || "";
  const cachedAvatar = info?.avatar_url || null;

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
  // Real issuance, not the annual_provisions projection. blocks_per_year is
  // misconfigured on this chain; see lib/chain-economics.
  const annualProvisions = await realAnnualIssuance(toTX(provRes?.annual_provisions));
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
  const [signing, delegations, selfDel, votes, tenure, onChainVotes, slashParams, commRes, outRes, unbRes, kbRes] = await Promise.all([
    consensusAddress
      ? getJSON<{ val_signing_info: Record<string, any> }>(
          `${LCD}/cosmos/slashing/v1beta1/signing_infos/${consensusAddress}`,
        )
      : Promise.resolve(null),
    // Every page, not the first 500. See getAllPages.
    getAllPages<any>(
      `/cosmos/staking/v1beta1/validators/${address}/delegations`,
      (d) => d?.delegation_responses ?? [],
    ),
    selfDelegateAddress
      ? getJSON<{ delegation_response: { balance: { amount: string } } }>(
          `${LCD}/cosmos/staking/v1beta1/validators/${address}/delegations/${selfDelegateAddress}`,
        )
      : Promise.resolve(null),
    // Both of these used to ask Coreum's Hasura indexer, and they are the
    // reason PR #287 only bought 255ms of the ~1s it was aiming at: they sit
    // after the chain calls, run in parallel with each other, and cost one
    // 390 to 460ms round trip that no amount of batching elsewhere removes.
    // They are now local reads. See migration 020 and
    // backfill-governance-history.mjs for how the history got here.
    selfDelegateAddress ? localVotes(selfDelegateAddress) : Promise.resolve(null),
    // Which proposals this validator was actually IN THE SET for. Without
    // this, participation is measured against every proposal that ever
    // existed, so a validator that joined at proposal 12 is scored against 11
    // votes it could never have cast. TX Forge read 31 of 43 (72%) when its
    // real record is a perfect one for its whole tenure.
    consensusAddress ? localTenure(consensusAddress) : Promise.resolve(null),
    Promise.resolve(
      selfDelegateAddress ? archivedVotes(selfDelegateAddress) : new Map<number, string>(),
    ),
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
    // Keybase, only when our own table has no avatar for this validator.
    // collect-validator-identity.mjs resolves these on a timer and writes
    // them to validator_identity, so the common path costs nothing. Calling
    // keybase.io live measured ~500ms on every single page load, for a logo.
    !cachedAvatar && identity
      ? getJSON<{ them: { pictures?: { primary?: { url?: string } } }[] }>(
          `https://keybase.io/_/api/1.0/user/lookup.json?key_suffix=${encodeURIComponent(identity)}&fields=pictures`,
        )
      : Promise.resolve(null),
  ]);

  // Delegator concentration, computed over the COMPLETE delegator set.
  //
  // The previous version fetched one 500-row page and asserted in a comment
  // that "the shares are still ranked, so the top-N and concentration ratios
  // remain correct even if the tail is truncated". That assumption was wrong:
  // the LCD returns rows in store order, not by amount. It cost BRW Capital
  // its single largest delegator (index 546 of 607) and computed every
  // percentage against a partial denominator.
  const delRows = (delegations?.rows || [])
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
  const avatarUrl = cachedAvatar || kbRes?.them?.[0]?.pictures?.primary?.url || "";
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
  let eventsHasMore = false;
  let delegatorFlow = { joined: 0, reduced: 0 };
  try {
    // All six queries below are independent: same address filter, no shared
    // state, combined only after they return. They used to run one after the
    // other, so the endpoint paid six round trips to a Postgres that is not
    // in the same datacentre. /api/health runs nine COUNTs in parallel and
    // finishes in 211ms, which is what set the expectation here.
    const [[totals], sources, dests, historyRows, eventRows, [flow]] = await Promise.all([
      sequelize.query<{
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
    ),

    // Who this validator won stake FROM, and lost it TO. This is the part
    // no other TX explorer can answer, because it needs source_validator.
    sequelize.query<{ counterparty: string; moniker: string | null; amount: string }>(
      `SELECT e.source_validator AS counterparty, val.moniker, SUM(e.amount) AS amount
       FROM staking_events e
       LEFT JOIN validators val ON val.operator_address = e.source_validator
       WHERE e.type='redelegate' AND e.validator = :v AND e.source_validator IS NOT NULL
         AND e.timestamp >= NOW() - (:days || ' days')::interval
       GROUP BY e.source_validator, val.moniker
       ORDER BY SUM(e.amount) DESC LIMIT :lim`,
      { replacements: { v: address, days: FLOW_DAYS, lim: TOP_COUNTERPARTIES }, type: QueryTypes.SELECT },
    ),
    sequelize.query<{ counterparty: string; moniker: string | null; amount: string }>(
      `SELECT e.validator AS counterparty, val.moniker, SUM(e.amount) AS amount
       FROM staking_events e
       LEFT JOIN validators val ON val.operator_address = e.validator
       WHERE e.type='redelegate' AND e.source_validator = :v
         AND e.timestamp >= NOW() - (:days || ' days')::interval
       GROUP BY e.validator, val.moniker
       ORDER BY SUM(e.amount) DESC LIMIT :lim`,
      { replacements: { v: address, days: FLOW_DAYS, lim: TOP_COUNTERPARTIES }, type: QueryTypes.SELECT },
    ),

    sequelize.query(
      `SELECT date, tokens, delegator_count AS "delegatorCount",
              commission_rate AS "commissionRate", missed_blocks AS "missedBlocks"
       FROM validator_snapshots
       WHERE operator_address = :v
       ORDER BY date ASC`,
      { replacements: { v: address }, type: QueryTypes.SELECT },
    ),

    // Individual stake events, newest first. Note these are only moves of
    // >= 5000 TX: the VM collector applies that floor at write time, so
    // smaller delegations are not in the table at all. The UI says so
    // rather than implying this is every event.
    // Fetch one extra to learn whether a second page exists, without a
    // separate COUNT. Trim it off before returning.
    sequelize.query(
      `SELECT tx_hash AS "txHash", height, timestamp, type, delegator, amount,
              source_validator AS "sourceValidator",
              CASE WHEN source_validator = :v THEN true ELSE false END AS outgoing
       FROM staking_events
       WHERE validator = :v OR source_validator = :v
       ORDER BY height DESC
       LIMIT :lim`,
      { replacements: { v: address, lim: EVENT_LIMIT + 1 }, type: QueryTypes.SELECT },
    ),

    // Delegator churn by wallet count (distinct wallets), not TX. "joined" =
    // wallets that added stake here (delegate or redelegate in); "reduced" =
    // wallets that pulled stake out (undelegate, or redelegate to elsewhere).
    sequelize.query<{ joined: string; reduced: string }>(
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
    ),
  ]);

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

    history = historyRows;
    eventsHasMore = eventRows.length > EVENT_LIMIT;
    events = eventsHasMore ? eventRows.slice(0, EVENT_LIMIT) : eventRows;
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
      count: delegations?.total || delRows.length,
      // Only true if we genuinely could not read every page (the ceiling in
      // getAllPages). It used to be `delRows.length >= 500`, which was both
      // the wrong signal and silently normal for large validators.
      truncated: delegations ? !delegations.complete : false,
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
    eventsHasMore,
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
      // Merge votes the indexer never saw. Only ADDS proposals; the indexer
      // stays authoritative for anything it did record. The archive file
      // already stores normalized labels ("YES"), not raw VOTE_OPTION_* enums.
      let recovered = 0;
      for (const [pid, opt] of onChainVotes as Map<number, string>) {
        if (seen.has(pid)) continue;
        seen.add(pid);
        deduped.push({ proposalId: pid, vote: opt || "UNKNOWN" });
        recovered++;
      }
      deduped.sort((a, b) => b.proposalId - a.proposalId);

      // Tenure. The lowest proposal this validator appears in the set for is
      // when it joined; anything earlier was never its to vote on. Reported so
      // the client can score participation over the tenure instead of over all
      // history, which is what other explorers do and why ours looked worse.
      const snapIds = (tenure?.proposal_validator_status_snapshot || [])
        .map((r) => Number(r.proposal_id))
        .filter((n) => Number.isFinite(n));
      const votedIds = deduped.map((d) => d.proposalId);
      const firstSeen = [...snapIds, ...votedIds].length
        ? Math.min(...[...snapIds, ...votedIds])
        : null;

      return { votedCount: deduped.length, votes: deduped, firstProposalId: firstSeen, recoveredFromChain: recovered };
    })(),
    history,
  });
}
