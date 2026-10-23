// Hints for the loading card on /stablecoins, /analytics and /passport.
//
// Each hint teaches one thing about how TX works, with a number read live
// from the chain or from our own collectors. Live hints (a vote in progress,
// validators just jailed, this week's flows) come before standing facts.
//
// Every source is a cached read bounded by a short timeout. A source that is
// slow or down drops its hint rather than holding up the card, which only
// exists to fill a wait. Hints never show a number we did not read.

import { QueryTypes } from "sequelize";
import { lcdGet } from "@/lib/chain-config";
import { cached } from "@/lib/response-cache";
import { sequelize } from "@/lib/db";
import { chainSnapshot } from "@/lib/chain-snapshot";
import { issuanceFactor } from "@/lib/chain-economics";
import { fetchPSESchedule, PSE_CONFIG } from "@/lib/pse-calculator";
import { liveCoins, liveFragments, issuerLog, issuerControls, activity } from "@/lib/stablecoins";
import { GET as governanceRoute } from "@/app/api/governance/route";

export type HintPage = "stablecoins" | "analytics" | "passport" | "governance" | "validators";
export const HINT_PAGES: HintPage[] = ["stablecoins", "analytics", "passport", "governance", "validators"];

export interface Hint {
  id: string;            // stable, so a visitor is not shown the same hint twice
  kind: "live" | "learn";
  title: string;
  body: string;
  cta?: { label: string; href: string };
}

const SOURCE_TIMEOUT_MS = 2_500;
const PSE_PER_PAYOUT = PSE_CONFIG.totalEmission / PSE_CONFIG.durationMonths; // all allocations

function within<T>(p: Promise<T>): Promise<T | null> {
  return Promise.race([
    p.catch(() => null),
    new Promise<null>((r) => setTimeout(() => r(null), SOURCE_TIMEOUT_MS)),
  ]);
}

const day = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const dayYear = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const n0 = (v: number) => Math.round(v).toLocaleString("en-US");
const tx = (v: number) => (Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : `${(v / 1e6).toFixed(1)}M`);
const pct = (f: number, d = 1) => `${(f * 100).toFixed(d)}%`;
const usd = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toFixed(0)}`);
const secs = (s: string) => parseInt(s, 10);

async function json<T>(path: string): Promise<T> {
  const res = await lcdGet(path);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}
async function rows<T extends object>(sql: string): Promise<T[]> {
  return sequelize.query<T>(sql, { type: QueryTypes.SELECT });
}

// ── chain reads ─────────────────────────────────────────────────────────

const votingProposals = () =>
  json<{ proposals?: { id: string; title?: string; voting_end_time: string }[] }>(
    "/cosmos/gov/v1/proposals?proposal_status=PROPOSAL_STATUS_VOTING_PERIOD",
  ).then((d) => (d.proposals ?? []).map((p) => ({ id: p.id, title: (p.title ?? "").trim(), end: p.voting_end_time })));

const stakingParams = () =>
  json<{ params: { unbonding_time: string; max_validators: number; max_entries: number; min_commission_rate: string } }>("/cosmos/staking/v1beta1/params").then((d) => d.params);

const slashingParams = () =>
  json<{ params: { signed_blocks_window: string; min_signed_per_window: string; downtime_jail_duration: string; slash_fraction_double_sign: string; slash_fraction_downtime: string } }>(
    "/cosmos/slashing/v1beta1/params",
  ).then((d) => d.params);

const govParams = () =>
  json<{ params: { min_deposit: { denom: string; amount: string }[]; voting_period: string; quorum: string; threshold: string; veto_threshold: string; max_deposit_period: string; min_initial_deposit_ratio: string; burn_vote_quorum: boolean; burn_vote_veto: boolean } }>(
    "/cosmos/gov/v1/params/tallying",
  ).then((d) => d.params);

const mintParams = () =>
  json<{ params: { inflation_rate_change: string; inflation_max: string; inflation_min: string; goal_bonded: string; blocks_per_year: string } }>(
    "/cosmos/mint/v1beta1/params",
  ).then((d) => d.params);

const totalSupply = () =>
  json<{ amount: { amount: string } }>("/cosmos/bank/v1beta1/supply/by_denom?denom=ucore").then((d) => Number(d.amount.amount) / 1e6);

const communityPool = () =>
  json<{ pool: { denom: string; amount: string }[] }>("/cosmos/distribution/v1beta1/community_pool")
    .then((d) => Number(d.pool.find((p) => p.denom === "ucore")?.amount ?? 0) / 1e6);

const jailedUnbonding = () =>
  json<{ validators: { description: { moniker: string }; tokens: string; jailed: boolean; unbonding_time: string }[] }>(
    "/cosmos/staking/v1beta1/validators?status=BOND_STATUS_UNBONDING&pagination.limit=100",
  ).then((d) => d.validators.filter((v) => v.jailed).map((v) => ({ moniker: v.description.moniker, tokens: Number(v.tokens) / 1e6, until: Date.parse(v.unbonding_time) })));

// The governance page's own data, through its cached route, so a hint can
// never disagree with the page it sits on.
type GovProposal = { id: number; title: string; rawStatus: string; votingEndTime: string | null; tally: { yes: number; no: number; abstain: number; noWithVeto: number; totalVoted: number; bondedSnapshot: number } };
async function governanceData(): Promise<GovProposal[]> {
  const res = await governanceRoute(new Request("http://hints.local/api/governance"));
  if (!res.ok) throw new Error(`governance HTTP ${res.status}`);
  return ((await res.json()).proposals ?? []) as GovProposal[];
}

// ── our collectors ──────────────────────────────────────────────────────

async function exchangeWeek() {
  const r = await rows<{ venue: string; dir: string; total: string }>(
    `SELECT a.exchange_name AS venue, f.direction AS dir, SUM(f.amount)::text AS total
       FROM exchange_flows_listed f JOIN exchange_addresses a ON a.address = f.exchange_address
      WHERE f.timestamp >= NOW() - INTERVAL '7 days'
      GROUP BY 1, 2`,
  );
  if (!r.length) return null;
  const by = new Map<string, number>();
  let dep = 0, wd = 0;
  for (const x of r) {
    const v = Number(x.total);
    if (x.dir === "inflow") dep += v; else wd += v;
    by.set(x.venue, (by.get(x.venue) ?? 0) + (x.dir === "inflow" ? v : -v));
  }
  const top = [...by.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  return { dep, wd, net: dep - wd, venues: by.size, top };
}

async function stakingWeek() {
  const sums = await rows<{ type: string; total: string }>(
    `SELECT type, SUM(amount)::text AS total FROM staking_events
      WHERE timestamp >= NOW() - INTERVAL '7 days' GROUP BY type`,
  );
  const [big] = await rows<{ type: string; amount: string; moniker: string | null }>(
    `SELECT s.type, s.amount::text AS amount, v.moniker
       FROM staking_events s LEFT JOIN validators v ON v.operator_address = s.validator
      WHERE s.timestamp >= NOW() - INTERVAL '7 days' AND s.type IN ('delegate', 'undelegate')
      ORDER BY s.amount DESC LIMIT 1`,
  );
  const get = (t: string) => Number(sums.find((x) => x.type === t)?.total ?? 0);
  return { del: get("delegate"), und: get("undelegate"), big: big ? { type: big.type, amount: Number(big.amount), moniker: big.moniker } : null };
}

async function unbondingWave() {
  const r = await rows<{ date: string; value: string }>(
    `SELECT date::text, value::text FROM pending_undelegations
      WHERE date >= CURRENT_DATE AND date < CURRENT_DATE + INTERVAL '7 days' ORDER BY date`,
  );
  if (!r.length) return null;
  const total = r.reduce((a, x) => a + Number(x.value), 0);
  const peak = r.reduce((a, b) => (Number(b.value) > Number(a.value) ? b : a));
  return { total, peakDate: Date.parse(peak.date), peak: Number(peak.value) };
}

async function whaleShare() {
  const [r] = await rows<{ top10: string; top500: string }>(
    `SELECT (SUM(total_stake) FILTER (WHERE rank <= 10))::text AS top10, SUM(total_stake)::text AS top500 FROM top_delegators`,
  );
  return r?.top500 ? { top10: Number(r.top10), top500: Number(r.top500) } : null;
}

async function priceWeek() {
  const [r] = await rows<{ now: string | null; then: string | null }>(
    `SELECT (SELECT price_usd FROM price_ticks ORDER BY taken_at DESC LIMIT 1)::text AS now,
            (SELECT price_usd FROM price_ticks WHERE taken_at <= NOW() - INTERVAL '7 days' ORDER BY taken_at DESC LIMIT 1)::text AS then`,
  );
  return r?.now && r?.then ? { now: Number(r.now), then: Number(r.then) } : null;
}

// ── build ───────────────────────────────────────────────────────────────

async function build(page: HintPage): Promise<Hint[]> {
  const stc = page === "stablecoins", ana = page === "analytics", psp = page === "passport";
  const govPage = page === "governance", valPage = page === "validators";
  const none = Promise.resolve(null);
  const [
    gov, schedule, snap, sParams, slash, gParams, mint, supply, pool, jailed, factor,
    xw, sw, wave, whales, price, coins, routes, act, govData,
  ] = await Promise.all([
    within(votingProposals()), within(fetchPSESchedule()), within(chainSnapshot()), within(stakingParams()),
    within(slashingParams()), within(govParams()), within(mintParams()), within(totalSupply()),
    within(communityPool()), within(jailedUnbonding()), within(issuanceFactor()),
    ana ? within(exchangeWeek()) : none, ana ? within(stakingWeek()) : none, ana ? within(unbondingWave()) : none,
    ana ? within(whaleShare()) : none, ana ? within(priceWeek()) : none,
    stc ? within(liveCoins()) : none, stc ? within(liveFragments()) : none, stc ? within(activity()) : none,
    govPage ? within(governanceData()) : none,
  ]);
  const ustx = coins?.find((c) => c.symbol === "USTX") ?? null;
  const [log, controls] = stc && ustx
    ? await Promise.all([within(issuerLog(ustx.denom)), within(issuerControls(ustx.denom))])
    : [null, null];
  const s = snap?.stakingData ?? null;
  const unbondingDays = sParams ? Math.round(secs(sParams.unbonding_time) / 86_400) : null;

  // This page's own hints lead, then the network-wide ones: someone opening
  // /stablecoins sees a stablecoin fact before a validator one.
  const live: Hint[] = [];
  const learn: Hint[] = [];
  const pageLive: Hint[] = [];
  const pageLearn: Hint[] = [];

  // ── live, every page ──
  for (const p of gov ?? []) {
    live.push({
      id: `gov-${p.id}`, kind: "live",
      title: `Proposal ${p.id} is open for voting until ${day(Date.parse(p.end))}`,
      body: `${p.title ? `${p.title}. ` : ""}Have you voted? A vote you cast yourself replaces your validator's vote for your stake, and you can change it any time before voting closes.`,
      cta: { label: "See the proposal", href: `/governance/${p.id}` },
    });
  }

  if (jailed && jailed.length && unbondingDays) {
    const total = jailed.reduce((a, v) => a + v.tokens, 0);
    const until = Math.max(...jailed.map((v) => v.until));
    const since = until - unbondingDays * 86_400_000;
    if (Date.now() - since < 30 * 86_400_000) {
      const names = [...jailed].sort((a, b) => b.tokens - a.tokens).map((v) => `${v.moniker} (${tx(v.tokens)})`).join(", ");
      live.push({
        id: `jailed-${until}`, kind: "live",
        title: `${jailed.length} validator${jailed.length === 1 ? " was" : "s were"} jailed on ${day(since)}`,
        body: `${names}. Their ${tx(total)} TX earns nothing now and finishes unbonding on ${day(until)}. Delegators can redelegate to an active validator straight away, with no ${unbondingDays} day wait.`,
        cta: { label: "Compare validators", href: "/validators" },
      });
    }
  }

  if (schedule && schedule.length) {
    const now = Date.now() / 1000;
    const future = schedule.filter((t) => t > now);
    const done = schedule.length - future.length;
    if (future.length) {
      const next = future[0] * 1000;
      const after = future[1] ? future[1] * 1000 : null;
      const paused = after !== null && (after - next) / 86_400_000 > 40;
      live.push({
        id: `pse-next-${future[0]}`, kind: "live",
        title: paused ? `Next PSE payout ${day(next)}, then none until ${dayYear(after!)}` : `Next PSE payout ${day(next)}`,
        body: paused
          ? "The schedule on chain pauses payouts after this one. Your PSE score keeps building while you stay staked, and is paid when payouts resume."
          : "PSE pays stakers every month on the on-chain schedule, by score: stake held over time.",
        cta: { label: "Open PSE", href: "/pse" },
      });
      learn.push({
        id: `pse-progress-${done}`, kind: "learn",
        title: `PSE has paid ${done} of its ${schedule.length} payouts`,
        body: `${tx((schedule.length - done) * PSE_PER_PAYOUT)} TX of the 100B is still to come, and the last payout is scheduled for ${dayYear(schedule[schedule.length - 1] * 1000)}.`,
        cta: { label: "Open PSE", href: "/pse" },
      });
    }
  }

  // v8 (proposals 46 and 47): in the block the last pre-pause PSE payout
  // lands, inflation is set to 24% x bonded / supply with min = max, so it
  // stops moving, and blocks_per_year becomes 42.3M. It reverts when PSE
  // resumes. Before that block the old rule still raises it every block.
  const pauseAhead = (() => {
    if (!schedule) return null;
    const now = Date.now() / 1000;
    const future = schedule.filter((t) => t > now);
    return future.length > 1 && (future[1] - future[0]) / 86_400 > 40 ? future[0] * 1000 : null;
  })();
  if (s && mint && supply && factor) {
    const br = s.bondedTokens / supply;
    const fixed = Number(mint.inflation_min) > 0 && mint.inflation_min === mint.inflation_max;
    if (fixed) {
      live.push({
        id: `inflation-fixed-${mint.inflation_max}`, kind: "live",
        title: `Inflation is fixed at ${s.inflation.toFixed(2)}% during the PSE pause`,
        body: "It was set to target a 24% staking APY when the last payout before the pause landed, and stays there until PSE resumes. With issuance fixed, APR rises when stake leaves and falls when stake arrives.",
      });
    } else if (pauseAhead) {
      const pauseInflation = 0.24 * br;
      const pauseApr = (pauseInflation * supply * ((365.25 * 86_400) / factor.blockSeconds / 42_300_000) * (1 - s.communityTax)) / s.bondedTokens;
      live.push({
        id: `inflation-pause-${pauseAhead}`, kind: "live",
        title: `Inflation goes from ${s.inflation.toFixed(2)}% to about ${(pauseInflation * 100).toFixed(2)}% on ${day(pauseAhead)}`,
        body: `When the last PSE payout before the pause lands, the v8 upgrade fixes inflation to target a 24% staking APY and holds it there until PSE resumes. At today's stake that is about ${(pauseApr * 100).toFixed(1)}% APR before commission, up from ${s.apr.toFixed(1)}%.`,
        cta: { label: "Compare validators", href: "/validators" },
      });
    } else {
      const perYear = (1 - br / Number(mint.goal_bonded)) * Number(mint.inflation_rate_change) * factor.factor;
      live.push({
        id: "inflation", kind: "live",
        title: `Inflation is ${s.inflation.toFixed(2)}% and rising`,
        body: `The 100B TX set aside for PSE counts as supply, so only ${pct(br)} of it looks staked. The chain raises inflation every block toward its ${pct(Number(mint.goal_bonded), 0)} target, by about ${(perYear * 100).toFixed(2)} points a year right now, until the ${pct(Number(mint.inflation_max), 0)} cap.`,
      });
    }
  }

  if (s) {
    live.push({
      id: "apr", kind: "live",
      title: `Staking APR is ${s.apr.toFixed(2)}% before commission`,
      body: `${tx(s.bondedTokens)} TX is staked and shares ${tx(s.annualProvisions)} TX of new issuance a year. Delegators get it minus their validator's commission, which is why a 5% validator and a 10% one pay differently.`,
      cta: { label: "Compare validators", href: "/validators" },
    });
  }

  // ── live, analytics ──
  if (xw && Math.abs(xw.net) >= 1e5) {
    pageLive.push({
      id: `xflow-${Math.round(xw.net / 1e5)}`, kind: "live",
      title: `${tx(Math.abs(xw.net))} TX moved ${xw.net > 0 ? "onto" : "off"} exchanges this week`,
      body: `${tx(xw.dep)} deposited and ${tx(xw.wd)} withdrawn across ${xw.venues} tracked venues. ${xw.top[0]} moved the most, net ${xw.top[1] > 0 ? "+" : ""}${tx(xw.top[1])}.`,
      cta: { label: "Open Flows", href: "/flows" },
    });
  }
  if (sw && (sw.del || sw.und)) {
    const net = sw.del - sw.und;
    pageLive.push({
      id: `sflow-${Math.round(net / 1e5)}`, kind: "live",
      title: `${tx(sw.del)} TX delegated and ${tx(sw.und)} undelegated this week`,
      body: `Net ${net >= 0 ? "+" : ""}${tx(net)}.${sw.big ? ` The largest single move was ${tx(sw.big.amount)} TX ${sw.big.type === "delegate" ? "delegated to" : "undelegated from"} ${sw.big.moniker ?? "a validator"}.` : ""}`,
    });
  }
  if (wave && wave.total >= 1e5) {
    pageLive.push({
      id: `wave-${Math.round(wave.total / 1e5)}`, kind: "live",
      title: `${tx(wave.total)} TX finishes unbonding in the next 7 days`,
      body: `Unbonded TX becomes spendable the day it lands. The biggest day is ${day(wave.peakDate)} with ${tx(wave.peak)}.`,
    });
  }
  if (price && price.then > 0) {
    const ch = price.now / price.then - 1;
    pageLive.push({
      id: `price-${Math.round(ch * 1000)}`, kind: "live",
      title: `TX is ${ch >= 0 ? "up" : "down"} ${pct(Math.abs(ch))} over 7 days, at $${price.now.toFixed(5)}`,
      body: "Our price is volume weighted across five exchanges and updated every minute. A venue more than 3% away from the rest is left out, so one thin order book cannot move it.",
    });
  }

  // ── live, stablecoins ──
  if (stc && coins) {
    const total = (routes?.reduce((a, r) => a + r.amount, 0) ?? 0) + (coins.find((c) => c.symbol === "SBC")?.supply ?? 0) + (ustx?.supply ?? 0);
    const usdc = coins.find((c) => c.symbol === "USDC");
    const a = act?.find((x) => x.denom === usdc?.denom);
    if (total > 0) {
      pageLive.push({
        id: "stc-total", kind: "live",
        title: `${usd(total)} in stablecoins on TX`,
        body: `USDC across ${routes?.length ?? "its"} IBC routes, plus SBC and USTX.${a ? ` USDC moved ${usd(a.volume)} in 30 days, between ${n0(a.wallets)} wallets.` : ""}`,
      });
    }
    if (usdc?.top1Share != null && usdc.holders) {
      pageLearn.push({
        id: "usdc-concentration", kind: "learn",
        title: `One wallet holds ${pct(usdc.top1Share)} of the USDC on TX`,
        body: `${n0(usdc.holders)} wallets hold some, and the ten largest hold ${pct(usdc.top10Share ?? 0)}. If that one wallet sends its USDC home, ${pct(usdc.top1Share)} of the supply on TX leaves with it.`,
      });
    }
  }
  if (stc && ustx) {
    pageLive.push({
      id: "ustx-supply", kind: "live",
      title: `${n0(ustx.supply)} USTX in circulation`,
      body: log
        ? `From ${log.counts.mint ?? 0} mints and ${log.counts.burn ?? 0} burns by Brale, the issuer, sent out to ${log.sentTo} wallets so far. One USDC converts to one USTX.`
        : "Brale issues USTX. One USDC converts to one USTX.",
    });
    if (controls) {
      pageLearn.push({
        id: "ustx-controls", kind: "learn",
        title: "USTX's issuer can pause it",
        body: `A contract lets Brale pause the coin, blacklist addresses and seize balances. Right now: ${controls.paused ? "paused" : "not paused"}, ${controls.blacklisted.length} blacklisted, ${controls.seizures.length} seizures. This page reads it every 5 minutes.`,
      });
    }
  }
  if (stc && routes && routes.length > 1) {
    pageLearn.push({
      id: "usdc-routes", kind: "learn",
      title: `USDC reaches TX by ${routes.length} routes`,
      body: "Each IBC path makes its own USDC token on TX, so two wallets can both hold USDC that is not interchangeable. Most of it came from Noble; the others are older paths that still hold a little.",
    });
  }

  // ── governance page ──
  if (govPage && govData && govData.length) {
    const done = govData.filter((p) => p.rawStatus === "PROPOSAL_STATUS_PASSED" || p.rawStatus === "PROPOSAL_STATUS_REJECTED" || p.rawStatus === "PROPOSAL_STATUS_FAILED");
    const passed = done.filter((p) => p.rawStatus === "PROPOSAL_STATUS_PASSED").length;
    const withSnap = done.filter((p) => p.tally.bondedSnapshot > 0);
    const turnout = (p: GovProposal) => p.tally.totalVoted / p.tally.bondedSnapshot;
    if (withSnap.length && gParams) {
      const avg = withSnap.reduce((a, p) => a + turnout(p), 0) / withSnap.length;
      const best = withSnap.reduce((a, b) => (turnout(b) > turnout(a) ? b : a));
      const low = withSnap.filter((p) => turnout(p) < Number(gParams.quorum)).length;
      pageLearn.push({
        id: `gov-record-${done.length}`, kind: "learn",
        title: `${passed} of ${done.length} TX proposals have passed`,
        body: `Average turnout is ${pct(avg, 0)} against a ${pct(Number(gParams.quorum), 0)} quorum${low ? `, and ${low} fell short of it` : ""}. The highest was proposal ${best.id} at ${pct(turnout(best), 0)}.`,
      });
    }
    const last = [...done].sort((a, b) => b.id - a.id)[0];
    if (last) {
      const t = last.tally;
      const nonAbstain = t.yes + t.no + t.noWithVeto;
      pageLive.push({
        id: `gov-last-${last.id}`, kind: "live",
        title: `Proposal ${last.id} ${last.rawStatus === "PROPOSAL_STATUS_PASSED" ? "passed" : "did not pass"} with ${nonAbstain > 0 ? pct(t.yes / nonAbstain) : "no"} yes`,
        body: `${last.title}.${t.bondedSnapshot > 0 ? ` ${pct(t.totalVoted / t.bondedSnapshot)} of staked TX voted.` : ""} Yes is counted against yes, no and veto; abstain only counts toward turnout.`,
        cta: { label: "See the proposal", href: `/governance/${last.id}` },
      });
    }
  }
  if (govPage && gParams && (gParams.burn_vote_veto || gParams.burn_vote_quorum)) {
    const dep = Number(gParams.min_deposit.find((d) => d.denom === "ucore")?.amount ?? 0) / 1e6;
    const initial = Number(gParams.min_initial_deposit_ratio);
    pageLearn.push({
      id: "gov-burn", kind: "learn",
      title: `A vetoed proposal loses its ${n0(dep)} TX deposit`,
      body: `So does one that misses quorum. Whoever submits must put up ${pct(initial, 0)} of the deposit at once, and the rest has ${Math.round(secs(gParams.max_deposit_period) / 86_400)} days to arrive before voting can start.`,
    });
  }

  // ── validators page ──
  if (valPage && snap && sParams && s) {
    const active = snap.validatorSet.filter((v) => v.status === "BOND_STATUS_BONDED");
    const min = Number(sParams.min_commission_rate);
    const atMin = active.filter((v) => Math.abs(v.commission - min) < 1e-9).length;
    const maxC = Math.max(...active.map((v) => v.commission));
    pageLearn.push({
      id: `commission-${atMin}-${maxC}`, kind: "learn",
      title: `${atMin} of ${active.length} active validators charge the ${pct(min, 0)} minimum`,
      body: `The highest charges ${pct(maxC, 0)}. At today's ${s.apr.toFixed(2)}% APR, delegators get ${(s.apr * (1 - min)).toFixed(2)}% at the minimum and ${(s.apr * (1 - maxC)).toFixed(2)}% at ${pct(maxC, 0)}.`,
    });
    pageLearn.push({
      id: "redelegation", kind: "learn",
      title: "You can move stake to another validator instantly",
      body: `A redelegation skips the ${unbondingDays ?? 7} day unbonding and keeps earning. Stake you just redelegated cannot be redelegated again until those days pass, and you can have at most ${sParams.max_entries} unbondings in flight with one validator.`,
    });
  }

  // ── learn, every page ──
  if (snap) {
    const bonded = snap.validatorSet.filter((v) => v.status === "BOND_STATUS_BONDED").sort((a, b) => b.tokens - a.tokens);
    const total = bonded.reduce((a, v) => a + v.tokens, 0);
    let acc = 0, k = 0;
    while (k < bonded.length && acc <= total / 3) acc += bonded[k++].tokens;
    if (k > 0) {
      learn.push({
        id: `nakamoto-${k}`, kind: "learn",
        title: `${k} validator${k === 1 ? " holds" : "s hold"} a third of all staked TX`,
        body: `${bonded.slice(0, k).map((v) => `${v.moniker} ${pct(v.tokens / total)}`).join(", ")}. A third going offline together stops the chain, so stake spread across smaller validators keeps TX harder to halt.`,
        cta: { label: "Compare validators", href: "/validators" },
      });
    }
    if (sParams && bonded.length) {
      learn.push({
        id: "validator-slots", kind: "learn",
        title: `${bonded.length} of TX's ${sParams.max_validators} validator slots are filled`,
        body: `The smallest active validator has ${tx(bonded[bonded.length - 1].tokens)} TX staked. Only active validators earn rewards, so stake on one outside the set earns nothing.`,
      });
    }
  }

  if (slash && factor?.blockSeconds) {
    const window = secs(slash.signed_blocks_window);
    const hours = (window * (1 - Number(slash.min_signed_per_window)) * factor.blockSeconds) / 3600;
    learn.push({
      id: "slashing", kind: "learn",
      title: `Miss more than ${pct(1 - Number(slash.min_signed_per_window), 0)} of ${n0(window)} blocks and a validator is jailed`,
      body: `That is about ${Math.round(hours)} hours offline at today's block time. Downtime costs ${pct(Number(slash.slash_fraction_downtime), 2)} of stake; double signing costs ${pct(Number(slash.slash_fraction_double_sign), 0)} and removes the validator for good. Delegators take the same cut, which is why uptime matters when you choose.`,
    });
  }

  if (mint && factor?.blockSeconds) {
    const planned = Number(mint.blocks_per_year);
    const real = (365.25 * 86_400) / factor.blockSeconds;
    learn.push({
      id: "block-speed", kind: "learn",
      title: `TX makes a block every ${factor.blockSeconds.toFixed(2)}s, faster than its settings assume`,
      body: `The mint module plans for ${tx(planned)} blocks a year; at this pace TX makes about ${tx(real)}. So ${pct(factor.factor - 1, 0)} more TX is issued than the configured inflation rate implies, which is why APR here is higher than the textbook formula.`,
    });
  }

  if (gParams) {
    const dep = gParams.min_deposit.find((d) => d.denom === "ucore");
    learn.push({
      id: "gov-rules", kind: "learn",
      title: `A proposal needs ${pct(Number(gParams.quorum), 0)} of staked TX to vote`,
      body: `Then over ${pct(Number(gParams.threshold), 0)} of the votes that are not abstain must be yes, and NoWithVeto must stay under ${pct(Number(gParams.veto_threshold), 1)}. Voting runs ${Math.round(secs(gParams.voting_period) / 86_400)} days${dep ? `, and opening one takes ${n0(Number(dep.amount) / 1e6)} TX in deposits` : ""}.`,
      cta: { label: "Open Governance", href: "/governance" },
    });
  }

  if (!(gov && gov.length)) {
    learn.push({
      id: "vote-override", kind: "learn",
      title: "Your vote overrides your validator's",
      body: "If you do not vote, your validator votes your stake for you. Vote yourself and your choice counts instead, and you can change it any time until voting closes.",
      cta: { label: "Open Governance", href: "/governance" },
    });
  }

  if (pool && s) {
    learn.push({
      id: "community-pool", kind: "learn",
      title: `The community pool holds ${tx(pool)} TX`,
      body: `${pct(s.communityTax, 0)} of every staking reward flows into it. Spending any of it takes a governance proposal and a vote.`,
    });
  }

  if (s && s.pseEligibleBonded > 0) {
    learn.push({
      id: "pse-size", kind: "learn",
      title: `Each PSE payout gives stakers ${tx(PSE_CONFIG.monthlyEmission)} TX`,
      body: `That is ${pct(PSE_CONFIG.monthlyEmission / s.pseEligibleBonded)} of the ${tx(s.pseEligibleBonded)} TX that qualifies, shared by score. ${tx(s.excludedPSEStake)} TX staked by excluded addresses, such as foundation and module accounts, gets none.`,
      cta: { label: "Open PSE", href: "/pse" },
    });
  }

  if (unbondingDays) {
    learn.push({
      id: "unbonding", kind: "learn",
      title: `Unstaking takes ${unbondingDays} days`,
      body: "Undelegated TX sits in unbonding for that long, earns nothing, and cannot be moved until it ends. Moving stake to another validator with a redelegation skips the wait.",
    });
  }

  if (ana && whales && s) {
    pageLearn.push({
      id: "whales", kind: "learn",
      title: `The 10 largest delegators hold ${pct(whales.top10 / s.bondedTokens)} of staked TX`,
      body: `The top 500 hold ${pct(whales.top500 / s.bondedTokens)}. Any of them moving 500K TX or more, or jumping five places, shows up in Whale moves.`,
    });
  }

  if (psp) {
    pageLearn.push(
      {
        id: "passport-public", kind: "learn",
        title: "Passport reads any address",
        body: "Paste any core1 address. It reads public chain data only, so nothing is signed and no wallet needs to be connected.",
      },
      {
        id: "portfolio-save", kind: "learn",
        title: "Track wallets without connecting them",
        body: "Save an address under Portfolio to follow it here, including cold and hardware wallets.",
        cta: { label: "Open Portfolio", href: "/portfolio" },
      },
    );
  }

  return [...pageLive, ...live, ...pageLearn, ...learn];
}

export function hintsFor(page: HintPage): Promise<Hint[]> {
  // A minute, not longer: a source that timed out keeps running and warms its
  // own cache, so the next build includes the hint it dropped.
  return cached(`hints:${page}`, 60_000, () => build(page));
}
