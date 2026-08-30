#!/usr/bin/env node
// Governance Collector
//
// Keeps our own copy of proposals, votes and tally history so the governance
// page does not depend on the Coreum indexer being up. That indexer returned
// HTTP 503 for everyone on 2026-08-27 and 2026-08-30, during a live vote both
// times, and the page went blank.
//
// The urgent part is votes. The SDK deletes them from state the moment a
// proposal is tallied: once prop 45 settled, /proposals/45/votes returned
// nothing and will never return anything again. So votes on a LIVE proposal
// are a capture-now-or-lose-forever problem, exactly like validator_snapshots.
// Every run that does not happen while a proposal is open is a permanent hole.
//
// Runs often (every 10 minutes) rather than daily for the same reason. A
// five day voting period sampled daily gives five points of vote history; the
// same period sampled every ten minutes gives 720, which is what makes a
// velocity chart mean anything.
//
// Sources, all chain, no indexer:
//   LCD /cosmos/gov/v1/proposals              list + status + final tally
//   LCD /cosmos/gov/v1/proposals/{id}/votes   votes, live proposals only
//   LCD /cosmos/gov/v1/proposals/{id}/tally   live tally
//   LCD /cosmos/staking/v1beta1/pool          bonded, for turnout
// --dry-run exercises every chain call and prints what would be written,
// without touching Postgres. Syntax checking a collector is not the same as
// running one: three of these have shipped broken because `node --check`
// passed. This makes a real run possible before the DB exists.
const DRY = process.argv.includes("--dry-run");
const { query, closePool } = DRY
  ? { query: async () => ({ rows: [{ inserted: true }] }), closePool: async () => {} }
  : await import("./db.mjs");

const LCD_POOL = (process.env.GOV_LCD_POOL || [
  "https://api.silknodes.io/coreum",
  "https://rest-coreum.ecostake.com",
  "https://coreum-api.polkachu.com",
  "https://full-node.mainnet-1.coreum.dev:1317",
].join(",")).split(",").map((s) => s.trim()).filter(Boolean);

const MAX_LAG_MS = 120_000;
const levels = { debug: 0, info: 1, warn: 2, error: 3 };
const LOG_LEVEL = process.env.LOG_LEVEL || "info";
function log(level, msg) {
  if (levels[level] >= levels[LOG_LEVEL]) {
    console[level === "error" ? "error" : "log"](`[governance] ${level}: ${msg}`);
  }
}

/** First host that is reachable AND within MAX_LAG_MS of tip. A stale node
 *  answers 200 with an out of date tally, which is worse than an outage
 *  because it looks like it worked. */
let cachedHost = null;
async function pickHost() {
  if (cachedHost) return cachedHost;
  for (const host of LCD_POOL) {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 10_000);
      const res = await fetch(`${host}/cosmos/base/tendermint/v1beta1/blocks/latest`, { signal: c.signal });
      clearTimeout(t);
      if (!res.ok) continue;
      const body = await res.json();
      const ts = Date.parse(body?.block?.header?.time ?? "");
      if (!Number.isFinite(ts) || Date.now() - ts > MAX_LAG_MS) {
        log("warn", `${host} is ${Math.round((Date.now() - ts) / 1000)}s behind tip, skipping`);
        continue;
      }
      cachedHost = host;
      log("info", `using ${host}`);
      return host;
    } catch { /* next */ }
  }
  throw new Error("no fresh LCD host available");
}

async function lcd(path, timeoutMs = 25_000) {
  const host = await pickHost();
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    const res = await fetch(`${host}${path}`, { signal: c.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${path}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

const toTX = (x) => Number(x ?? 0) / 1e6;

const ARCHIVE_RPC = process.env.ARCHIVE_RPC || "https://archive.rpc.mainnet-1.tx.org";
const BLOCK_SECONDS = 0.742;

/** Bonded stake at a past moment, from the archive node's mint event.
 *
 *  Settled proposals need this and the chain will not give it back: the gov
 *  module keeps no per-proposal bonded figure, so turnout on a closed vote is
 *  uncomputable without recording it. Filled once per proposal and then left
 *  alone, because it never changes after the fact. */
async function bondedAtTime(iso, votedTX) {
  try {
    const j = async (u, ms = 25_000) => {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), ms);
      try {
        const r = await fetch(`${ARCHIVE_RPC}${u}`, { signal: c.signal });
        return r.ok ? await r.json() : null;
      } finally { clearTimeout(t); }
    };
    const st = (await j("/status"))?.result?.sync_info;
    if (!st) return null;
    const tipH = Number(st.latest_block_height);
    const target = Date.parse(iso);
    if (!Number.isFinite(target)) return null;

    const timeAt = async (h) => {
      const b = await j(`/block?height=${h}`);
      const t = b?.result?.block?.header?.time;
      return t ? Date.parse(t) : null;
    };

    // True binary search on block timestamps. The previous version estimated
    // the height from a fixed 0.742s block time and refined twice, which was
    // wrong for anything old: block time averaged ~1.27s over the chain's
    // life, so a proposal from 2023 estimated to a NEGATIVE height, clamped
    // to 1, and read genesis-era bonded stake. That produced turnout figures
    // like "Q 140564%". A search makes no assumption about block time at all.
    let lo = 1, hi = tipH;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      const t = await timeAt(mid);
      if (t === null) return null;
      if (t < target) lo = mid + 1; else hi = mid;
    }
    const h = lo;

    const br = await j(`/block_results?height=${h}`, 40_000);
    const evs = [...(br?.result?.finalize_block_events ?? []), ...(br?.result?.begin_block_events ?? [])];
    for (const e of evs) {
      if (e.type !== "mint") continue;
      const kv = {};
      for (const a of e.attributes) kv[a.key] = a.value;
      const infl = Number(kv.inflation);
      if (!infl) return null;
      const bonded = Number(kv.bonded_ratio) * (Number(kv.annual_provisions) / 1e6 / infl);
      if (!(bonded > 0)) return null;
      // Turnout above 100% is impossible: more stake cannot vote than exists.
      // If we compute one, the height is wrong and writing it would publish a
      // number worse than publishing nothing.
      if (votedTX > 0 && votedTX / bonded > 1.05) {
        log("warn", `rejected bonded ${Math.round(bonded)} at h=${h} for ${iso}: implies ${(votedTX / bonded * 100).toFixed(0)}% turnout`);
        return null;
      }
      return bonded;
    }
    return null;
  } catch {
    return null;
  }
}

async function allProposals() {
  const out = [];
  let key = null;
  for (let page = 0; page < 20; page++) {
    const q = new URLSearchParams({ "pagination.limit": "100" });
    if (key) q.set("pagination.key", key);
    const body = await lcd(`/cosmos/gov/v1/proposals?${q}`);
    out.push(...(body?.proposals ?? []));
    key = body?.pagination?.next_key ?? null;
    if (!key) break;
  }
  return out;
}

async function votesFor(id) {
  const out = [];
  let key = null;
  for (let page = 0; page < 50; page++) {
    const q = new URLSearchParams({ "pagination.limit": "1000" });
    if (key) q.set("pagination.key", key);
    const body = await lcd(`/cosmos/gov/v1/proposals/${id}/votes?${q}`, 40_000);
    for (const v of body?.votes ?? []) {
      const opt = v?.options?.[0];
      if (!opt?.option) continue;
      out.push({
        voter: v.voter,
        option: String(opt.option).replace("VOTE_OPTION_", ""),
        weight: Number(opt.weight ?? 1),
      });
    }
    key = body?.pagination?.next_key ?? null;
    if (!key) break;
  }
  return out;
}

async function main() {
  const started = Date.now();
  const proposals = await allProposals();
  log("info", `chain has ${proposals.length} proposals`);

  let bonded = null;
  try {
    bonded = toTX((await lcd("/cosmos/staking/v1beta1/pool"))?.pool?.bonded_tokens);
  } catch {
    log("warn", "could not read bonded pool; turnout will be null this run");
  }

  const height = await lcd("/cosmos/base/tendermint/v1beta1/blocks/latest")
    .then((b) => Number(b?.block?.header?.height) || null)
    .catch(() => null);

  let liveSeen = 0, votesWritten = 0, tallySnapshots = 0, backfilled = 0;

  for (const p of proposals) {
    const id = Number(p.id);
    const live = p.status === "PROPOSAL_STATUS_VOTING_PERIOD";
    const ft = p.final_tally_result ?? {};
    const msgs = Array.isArray(p.messages) ? p.messages : [];

    await query(
      `INSERT INTO gov_proposals
         (id, title, summary, status, proposal_type, proposer,
          submit_time, voting_start_time, voting_end_time,
          final_yes, final_no, final_abstain, final_no_with_veto,
          bonded_snapshot, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
       ON CONFLICT (id) DO UPDATE SET
         title=EXCLUDED.title, summary=EXCLUDED.summary, status=EXCLUDED.status,
         proposal_type=EXCLUDED.proposal_type, proposer=EXCLUDED.proposer,
         submit_time=EXCLUDED.submit_time,
         voting_start_time=EXCLUDED.voting_start_time,
         voting_end_time=EXCLUDED.voting_end_time,
         final_yes=EXCLUDED.final_yes, final_no=EXCLUDED.final_no,
         final_abstain=EXCLUDED.final_abstain,
         final_no_with_veto=EXCLUDED.final_no_with_veto,
         -- Keep the bonded figure from when it was live; the chain cannot
         -- give it back once the proposal settles.
         bonded_snapshot=COALESCE(EXCLUDED.bonded_snapshot, gov_proposals.bonded_snapshot),
         updated_at=now()`,
      [id, p.title || msgs[0]?.["@type"] || `Proposal ${id}`, p.summary ?? null,
       p.status, msgs[0]?.["@type"] ?? null, p.proposer ?? null,
       p.submit_time ?? null, p.voting_start_time ?? null, p.voting_end_time ?? null,
       toTX(ft.yes_count) || null, toTX(ft.no_count) || null,
       toTX(ft.abstain_count) || null, toTX(ft.no_with_veto_count) || null,
       live ? bonded : null],
    );

    if (!live) {
      // Settled proposals: fill bonded once from the archive so turnout stays
      // computable. Without it the list renders "Q 0%" on votes that had real
      // turnout, which reads as "nobody voted".
      const have = await query(
        "SELECT bonded_snapshot FROM gov_proposals WHERE id=$1", [id]);
      if (!have.rows?.[0]?.bonded_snapshot && p.voting_end_time) {
        const votedTX = toTX(ft.yes_count) + toTX(ft.no_count) +
                        toTX(ft.abstain_count) + toTX(ft.no_with_veto_count);
        const b = await bondedAtTime(p.voting_end_time, votedTX);
        if (b) {
          await query("UPDATE gov_proposals SET bonded_snapshot=$2 WHERE id=$1", [id, b]);
          backfilled++;
        }
      }
      continue;
    }
    liveSeen++;

    // Votes: capture now or lose them when this proposal tallies.
    try {
      const votes = await votesFor(id);
      for (const v of votes) {
        const r = await query(
          `INSERT INTO gov_votes
             (proposal_id, voter_address, option, weight, observed_height)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (proposal_id, voter_address) DO UPDATE SET
             -- A voter may change their vote while the proposal is open.
             option=EXCLUDED.option,
             weight=EXCLUDED.weight,
             last_seen_at=now()
           RETURNING (xmax = 0) AS inserted`,
          [id, v.voter, v.option, v.weight, height],
        );
        if (r.rows[0]?.inserted) votesWritten++;
      }
      log("info", `#${id} live: ${votes.length} votes on chain, ${votesWritten} new`);
    } catch (err) {
      log("error", `#${id} vote capture failed: ${err.message}`);
    }

    // Tally point for the velocity chart.
    try {
      const t = (await lcd(`/cosmos/gov/v1/proposals/${id}/tally`))?.tally ?? {};
      await query(
        `INSERT INTO gov_tally_snapshots
           (proposal_id, yes, no, abstain, no_with_veto, bonded)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (proposal_id, observed_at) DO NOTHING`,
        [id, toTX(t.yes_count), toTX(t.no_count),
         toTX(t.abstain_count), toTX(t.no_with_veto_count), bonded],
      );
      tallySnapshots++;
    } catch (err) {
      log("error", `#${id} tally snapshot failed: ${err.message}`);
    }
  }

  log("info",
    `done in ${((Date.now() - started) / 1000).toFixed(1)}s: ` +
    `${proposals.length} proposals, ${liveSeen} live, ` +
    `${votesWritten} new votes, ${tallySnapshots} tally points, ` +
    `${backfilled} bonded backfilled`);
}

main()
  .catch((err) => { log("error", err.stack || err.message); process.exitCode = 1; })
  .finally(() => closePool());
