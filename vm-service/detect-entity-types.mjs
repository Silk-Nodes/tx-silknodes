#!/usr/bin/env node

/**
 * Phase 3 of the Flows page destinations classifier accuracy work.
 *
 * Walks the top N counterparties currently bucketed as "private" by
 * the destinations classifier and queries the chain to figure out
 * what kind of address each one actually is. Findings get UPSERTed
 * into known_entities so the destinations classifier can reclassify
 * them on the next render.
 *
 * Detection strategy per address (cheapest checks first):
 *
 *   1. /cosmos/auth/v1beta1/accounts/{addr} returns the account's
 *      @type field. ModuleAccount → it's a chain module (gov,
 *      distribution, ibc transfer, mint, fee_collector, ...).
 *      The module name comes from the response body and we map it
 *      to a known_entities type.
 *
 *   2. /cosmwasm/wasm/v1/contract/{addr} returns 200 if the address
 *      is a CosmWasm contract. We leave the type as "contract" since
 *      figuring out *which* contract requires per-address knowledge
 *      we don't have here. The team can edit the label later.
 *
 *   3. Everything else is left untouched. The team curates real CEX
 *      / bridge / DEX entries by hand based on the audit panel.
 *
 * Idempotent: only inserts new rows or upgrades unknown→known. Never
 * downgrades a verified label. Safe to re-run.
 *
 * Manual run:
 *   node vm-service/detect-entity-types.mjs           # top 50 private
 *   LIMIT=200 node vm-service/detect-entity-types.mjs # top 200
 *   DRY_RUN=1 node ...                                # log only
 *
 * Not wired to a systemd timer; run it after seeding new exchange
 * addresses via SQL or whenever the audit panel surfaces a batch of
 * unidentified high-volume destinations.
 */

import { query, closePool } from "./db.mjs";

const LCD = process.env.SILK_LCD || "https://rest-coreum.ecostake.com";
const LIMIT = Number(process.env.LIMIT ?? 50);
const DRY_RUN = process.env.DRY_RUN === "1";
const REQUEST_TIMEOUT_MS = 6000;
const REQUEST_DELAY_MS = 150; // polite rate limit between LCD calls

function log(level, msg, extra) {
  console.log(JSON.stringify({ level, msg, ...extra, at: new Date().toISOString() }));
}

async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, body: await res.json() };
  } catch (e) {
    return { ok: false, error: e?.message ?? String(e) };
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Map cosmos-sdk module account names to known_entities.type +
// human-friendly label. Names taken from the ModuleAccount.name field
// of /cosmos/auth/v1beta1/accounts/{addr}.
const MODULE_NAME_TO_LABEL = {
  fee_collector: { label: "Fee Collector",        type: "module" },
  distribution:  { label: "Distribution Module",  type: "module" },
  bonded_tokens_pool:    { label: "Bonded Tokens Pool",   type: "module" },
  not_bonded_tokens_pool:{ label: "Not Bonded Tokens Pool", type: "module" },
  gov:           { label: "Governance Module",    type: "module" },
  mint:          { label: "Mint Module",          type: "module" },
  transfer:      { label: "IBC Transfer",         type: "ibc" },
  ibc:           { label: "IBC Module",           type: "ibc" },
  pse:           { label: "PSE Distribution",     type: "module" },
  reward:        { label: "Reward Module",        type: "module" },
};

async function classifyAddress(address) {
  // 1. Auth account lookup. Catches module accounts.
  const acct = await fetchJson(`${LCD}/cosmos/auth/v1beta1/accounts/${address}`);
  if (acct.ok && acct.body?.account) {
    const a = acct.body.account;
    const type = a["@type"] ?? "";
    if (type.includes("ModuleAccount")) {
      const name = a.name ?? "module";
      const meta = MODULE_NAME_TO_LABEL[name] ?? {
        label: `Module: ${name}`,
        type: "module",
      };
      return { ...meta, source: "chain-detect:module" };
    }
  }

  // 2. CosmWasm contract lookup. Returns 404 for non-contracts.
  const contract = await fetchJson(`${LCD}/cosmwasm/wasm/v1/contract/${address}`);
  if (contract.ok && contract.body?.contract_info) {
    return {
      label: "Smart Contract",
      type: "contract",
      source: "chain-detect:cosmwasm",
    };
  }

  return null;
}

async function main() {
  log("info", "starting entity detection", { limit: LIMIT, dryRun: DRY_RUN });

  // Pull the top N current "private" addresses by total amount.
  // Mirrors /api/flows-private-destinations logic but unscoped by
  // window so we look at all-time volume.
  const rows = await query(
    `
    WITH outflows AS (
      SELECT counterparty, amount FROM exchange_flows WHERE direction = 'outflow'
    ),
    private_only AS (
      SELECT counterparty, amount FROM outflows o
      WHERE NOT EXISTS (SELECT 1 FROM exchange_addresses ea WHERE ea.address = o.counterparty)
        AND NOT EXISTS (SELECT 1 FROM top_delegators td   WHERE td.address = o.counterparty)
        AND NOT EXISTS (
          SELECT 1 FROM staking_events se
          WHERE se.delegator = o.counterparty AND se.type = 'delegate'
        )
        AND NOT EXISTS (
          SELECT 1 FROM known_entities ke
          WHERE ke.address = o.counterparty
            AND ke.type IN ('cex', 'bridge', 'ibc', 'dex', 'contract', 'module')
        )
    )
    SELECT counterparty, SUM(amount) AS total_amount
    FROM private_only
    GROUP BY counterparty
    ORDER BY total_amount DESC
    LIMIT $1
    `,
    [LIMIT],
  );

  if (!rows.rows || rows.rows.length === 0) {
    log("info", "no untyped private addresses to investigate");
    return;
  }

  let detected = 0;
  for (const r of rows.rows) {
    const address = r.counterparty;
    const result = await classifyAddress(address);
    await sleep(REQUEST_DELAY_MS);

    if (!result) {
      log("info", "no detection", { address });
      continue;
    }
    detected++;
    log("info", "detected", { address, ...result });

    if (DRY_RUN) continue;

    await query(
      `
      INSERT INTO known_entities (address, label, type, verified, source)
      VALUES ($1, $2, $3, false, $4)
      ON CONFLICT (address) DO UPDATE SET
        label  = COALESCE(known_entities.label, EXCLUDED.label),
        type   = CASE
                   WHEN known_entities.verified THEN known_entities.type
                   ELSE EXCLUDED.type
                 END,
        source = COALESCE(known_entities.source, EXCLUDED.source)
      `,
      [address, result.label, result.type, result.source],
    );
  }

  log("info", `done. detected ${detected}/${rows.rows.length} addresses`);
}

main()
  .catch((err) => {
    log("error", `fatal: ${err?.message ?? err}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
