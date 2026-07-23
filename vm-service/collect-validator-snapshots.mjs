#!/usr/bin/env node
// Validator Daily Snapshot Collector
//
// Writes one row per validator per day to validator_snapshots. Powers the
// per-validator detail pages: voting-power history, commission changes,
// uptime trend, delegator growth.
//
// This data cannot be backfilled. The chain exposes current state only, and
// reconstructing bonded stake from staking_events would be wrong because
// PSE emission and reward compounding move bonded stake without producing a
// delegate transaction. So every day this does not run is a permanent hole.
//
// Sources:
//   LCD  /cosmos/staking/v1beta1/validators      tokens, commission, status
//   LCD  /cosmos/slashing/v1beta1/signing_infos  missed blocks, tombstoned
//   LCD  /validators/{v}/delegations             delegator count, self-bond
//   Hasura validator_info                        consensus <-> operator map
//
// The Hasura mapping is what lets us attach signing_infos (keyed by
// consensus address) to a validator (keyed by operator address) without
// doing pubkey -> bech32 consensus-address derivation ourselves.
//
// Usage:
//   node vm-service/collect-validator-snapshots.mjs            # daily run
//   node vm-service/collect-validator-snapshots.mjs --dry-run  # no writes
//   node vm-service/collect-validator-snapshots.mjs --date=YYYY-MM-DD
//
// READ-ONLY against LCD and Hasura. Writes only to validator_snapshots.

import { query, closePool } from "./db.mjs";

const LCD = process.env.COREUM_LCD || "https://full-node.mainnet-1.coreum.dev:1317";
const HASURA = "https://hasura.mainnet-1.coreum.dev/v1/graphql";
const DECIMALS = 6;
const ucoreToTX = (s) => Number(BigInt(s)) / 10 ** DECIMALS;
// Per-validator extras are 2 calls each. 6 at a time keeps a 56-validator
// set well under a minute without hammering the public LCD.
const CONCURRENCY = 6;
const TIMEOUT_MS = 20_000;

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v === undefined ? true : v];
  }),
);
const DRY_RUN = Boolean(args["dry-run"]);
const DATE = typeof args.date === "string" ? args.date : new Date().toISOString().slice(0, 10);

async function getJSON(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// Walk a paginated LCD collection to completion.
async function fetchAllPaged(path, key) {
  const out = [];
  let nextKey = "";
  do {
    const sep = path.includes("?") ? "&" : "?";
    const url = `${LCD}${path}${sep}pagination.limit=200${nextKey ? `&pagination.key=${encodeURIComponent(nextKey)}` : ""}`;
    const page = await getJSON(url);
    out.push(...(page[key] || []));
    nextKey = page.pagination?.next_key || "";
  } while (nextKey);
  return out;
}

// consensus_address -> { operator_address, self_delegate_address }
async function fetchValidatorInfo() {
  const body = {
    query: `query { validator_info { consensus_address operator_address self_delegate_address } }`,
  };
  const res = await fetch(HASURA, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`hasura HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(`hasura: ${JSON.stringify(json.errors)}`);
  const byOperator = new Map();
  const consensusByOperator = new Map();
  for (const r of json.data.validator_info || []) {
    if (!r.operator_address) continue;
    byOperator.set(r.operator_address, r.self_delegate_address || "");
    if (r.consensus_address) consensusByOperator.set(r.operator_address, r.consensus_address);
  }
  return { selfDelegateByOperator: byOperator, consensusByOperator };
}

// Delegator count and self-bond. Both are best-effort: a failure here
// leaves the columns NULL rather than dropping the validator's whole row.
async function fetchExtras(operator, selfDelegate) {
  const out = { delegatorCount: null, selfBondedTx: null };
  try {
    const d = await getJSON(
      `${LCD}/cosmos/staking/v1beta1/validators/${operator}/delegations?pagination.limit=1&pagination.count_total=true`,
    );
    const total = d.pagination?.total;
    if (total !== undefined && total !== null) out.delegatorCount = Number(total);
  } catch {
    /* leave null */
  }
  if (selfDelegate) {
    try {
      const s = await getJSON(
        `${LCD}/cosmos/staking/v1beta1/validators/${operator}/delegations/${selfDelegate}`,
      );
      const bal = s.delegation_response?.balance?.amount;
      if (bal) out.selfBondedTx = ucoreToTX(bal);
    } catch {
      /* validator may have no self-delegation record; leave null */
    }
  }
  return out;
}

async function mapLimited(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  console.log(`[validator-snapshots] date=${DATE} dryRun=${DRY_RUN}`);

  const [validators, signingInfos, info] = await Promise.all([
    fetchAllPaged("/cosmos/staking/v1beta1/validators", "validators"),
    fetchAllPaged("/cosmos/slashing/v1beta1/signing_infos", "info"),
    fetchValidatorInfo(),
  ]);
  console.log(
    `[validator-snapshots] validators=${validators.length} signingInfos=${signingInfos.length} infoMap=${info.selfDelegateByOperator.size}`,
  );

  const signingByConsensus = new Map(signingInfos.map((s) => [s.address, s]));

  const rows = await mapLimited(validators, CONCURRENCY, async (v) => {
    const operator = v.operator_address;
    const selfDelegate = info.selfDelegateByOperator.get(operator) || "";
    const extras = await fetchExtras(operator, selfDelegate);
    const consensus = info.consensusByOperator.get(operator);
    const signing = consensus ? signingByConsensus.get(consensus) : undefined;

    return {
      date: DATE,
      operator_address: operator,
      moniker: v.description?.moniker || operator.slice(0, 16),
      tokens: ucoreToTX(v.tokens),
      commission_rate: Number(v.commission?.commission_rates?.rate ?? 0),
      jailed: Boolean(v.jailed),
      status: v.status || "",
      delegator_count: extras.delegatorCount,
      self_bonded_tx: extras.selfBondedTx,
      missed_blocks: signing ? Number(signing.missed_blocks_counter) : null,
      tombstoned: signing ? Boolean(signing.tombstoned) : null,
    };
  });

  const withExtras = rows.filter((r) => r.delegator_count !== null).length;
  const withUptime = rows.filter((r) => r.missed_blocks !== null).length;
  console.log(
    `[validator-snapshots] built ${rows.length} rows (delegatorCount on ${withExtras}, uptime on ${withUptime})`,
  );

  if (DRY_RUN) {
    console.log(JSON.stringify(rows.slice(0, 3), null, 2));
    console.log("[validator-snapshots] dry run, nothing written");
    return;
  }

  let written = 0;
  for (const r of rows) {
    await query(
      `INSERT INTO validator_snapshots
         (date, operator_address, moniker, tokens, commission_rate, jailed, status,
          delegator_count, self_bonded_tx, missed_blocks, tombstoned)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (date, operator_address) DO UPDATE SET
         moniker = EXCLUDED.moniker,
         tokens = EXCLUDED.tokens,
         commission_rate = EXCLUDED.commission_rate,
         jailed = EXCLUDED.jailed,
         status = EXCLUDED.status,
         delegator_count = COALESCE(EXCLUDED.delegator_count, validator_snapshots.delegator_count),
         self_bonded_tx = COALESCE(EXCLUDED.self_bonded_tx, validator_snapshots.self_bonded_tx),
         missed_blocks = COALESCE(EXCLUDED.missed_blocks, validator_snapshots.missed_blocks),
         tombstoned = COALESCE(EXCLUDED.tombstoned, validator_snapshots.tombstoned),
         inserted_at = NOW()`,
      [
        r.date, r.operator_address, r.moniker, r.tokens, r.commission_rate, r.jailed, r.status,
        r.delegator_count, r.self_bonded_tx, r.missed_blocks, r.tombstoned,
      ],
    );
    written += 1;
  }
  console.log(`[validator-snapshots] wrote ${written} rows for ${DATE}`);
}

main()
  .catch((err) => {
    console.error("[validator-snapshots] FAILED", err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
