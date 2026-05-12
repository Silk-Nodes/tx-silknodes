#!/usr/bin/env node
// Forensic: find who delegated ~2M TX to Silk Nodes' validator, then
// reverse-engineer how it landed (PSE auto-bond? bank send + self-bond?
// authz exec? smart contract?).
//
// READ-ONLY. No DB writes. No PR.
//
// Usage:
//   node vm-service/find-silknodes-delegation.mjs              # auto-detect Silk Nodes valoper
//   node vm-service/find-silknodes-delegation.mjs --valoper=corevaloper1...

import { writeFileSync } from "node:fs";

const HASURA = "https://hasura.mainnet-1.coreum.dev/v1/graphql";
const LCD = "https://full-node.mainnet-1.coreum.dev:1317";
const DECIMALS = 6;
const TARGET_MIN_TX = 1_000_000; // flag delegations ≥ 1M TX

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);

async function gql(query) {
  const res = await fetch(HASURA, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const d = await res.json();
  if (d.errors) throw new Error(JSON.stringify(d.errors));
  return d.data;
}

// 1. Find the Silk Nodes valoper via Hasura validator descriptions.
async function findSilknodesValoper() {
  if (args.valoper) return args.valoper;
  const d = await gql(`{
    validator_description(where: { moniker: { _ilike: "%silk%nodes%" } }) {
      moniker
      validator_address
    }
  }`);
  const rows = d.validator_description || [];
  if (rows.length === 0) throw new Error("No validator with 'Silk Nodes' moniker found");
  console.log("Candidate validators:");
  for (const r of rows) console.log(`  ${r.moniker}  ${r.validator_address}`);
  return rows[0].validator_address;
}

// 2. Pull every delegation to that validator. LCD endpoint paginates.
async function fetchAllDelegations(valoper) {
  const all = [];
  let nextKey = "";
  while (true) {
    const url = nextKey
      ? `${LCD}/cosmos/staking/v1beta1/validators/${valoper}/delegations?pagination.limit=1000&pagination.key=${encodeURIComponent(nextKey)}`
      : `${LCD}/cosmos/staking/v1beta1/validators/${valoper}/delegations?pagination.limit=1000`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`LCD ${r.status} ${r.statusText}`);
    const d = await r.json();
    for (const resp of d.delegation_responses || []) {
      all.push({
        delegator: resp.delegation.delegator_address,
        amountUcore: resp.balance.amount,
        amountTX: Number(BigInt(resp.balance.amount)) / 10 ** DECIMALS,
      });
    }
    nextKey = d.pagination?.next_key || "";
    if (!nextKey) break;
  }
  return all.sort((a, b) => b.amountTX - a.amountTX);
}

// 3. For each big delegator: did they ever send a MsgDelegate to this
// validator (i.e. user-initiated)? If yes, the dashboard should have
// caught it. If no, the stake arrived via a path our collector doesn't
// see (authz / contract / PSE auto-bond / module operation).
async function checkDelegationProvenance(delegator, valoper) {
  const d = await gql(`{
    transaction(
      where: {
        messages: {
          type: { _eq: "/cosmos.staking.v1beta1.MsgDelegate" }
          value: { _has_key: "delegator_address" }
        }
        success: { _eq: true }
      }
      limit: 5
      order_by: { height: desc }
    ) { hash height }
  }`).catch(() => null);
  // The above is illustrative — Hasura's transaction.messages schema
  // varies by indexer. We try simpler: count all txs sent BY the
  // delegator that touched staking.
  const simpler = await gql(`{
    transaction(
      where: { signer_infos: { _has_key: "${delegator}" } }
      limit: 1
    ) { hash height }
  }`).catch(() => null);
  return simpler;
}

// 4. Check if the delegator received a PSE transfer (auto-bond path).
async function checkPseTransfer(address) {
  const d = await gql(`{
    pse_transfer(
      where: {
        recipient_address: { _eq: "${address}" }
        allocation_type: { _eq: "pse_community" }
      }
    ) { distribution_id amount height allocation_type }
  }`);
  return d.pse_transfer || [];
}

// 5. Check if the delegator was the recipient of a bank send around
// the time their delegation landed.
async function summarizeAddress(address) {
  // delegation total now
  const d = await gql(`{
    action_delegation_total(address: "${address}") { coins }
  }`);
  const coins = d.action_delegation_total?.coins || [];
  const ucore = coins.find((c) => c.denom === "ucore");
  return ucore ? Number(BigInt(ucore.amount)) / 10 ** DECIMALS : 0;
}

async function main() {
  const valoper = await findSilknodesValoper();
  console.log(`\nInspecting validator: ${valoper}`);

  const delegations = await fetchAllDelegations(valoper);
  console.log(`\n${delegations.length} delegators total. Top 15 by amount:`);
  for (const d of delegations.slice(0, 15)) {
    console.log(`  ${d.amountTX.toLocaleString(undefined, { maximumFractionDigits: 0 }).padStart(13)} TX  ${d.delegator}`);
  }

  console.log(`\nProvenance check for delegators ≥ ${TARGET_MIN_TX.toLocaleString()} TX:`);
  const big = delegations.filter((d) => d.amountTX >= TARGET_MIN_TX);
  for (const d of big) {
    const psetransfers = await checkPseTransfer(d.delegator);
    const psetTotal = psetransfers.reduce(
      (s, t) => s + Number(BigInt(t.amount)) / 10 ** DECIMALS,
      0,
    );
    const verdict = psetTotal >= d.amountTX * 0.5
      ? `PSE auto-bond (received ${psetTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })} TX via PSE)`
      : psetTotal > 0
      ? `partial PSE (${psetTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })} TX via PSE)`
      : `unknown — likely bank send + self-bond, authz, or module op`;
    console.log(
      `  ${d.amountTX.toLocaleString(undefined, { maximumFractionDigits: 0 }).padStart(13)} TX  ${d.delegator}  →  ${verdict}`,
    );
  }

  writeFileSync(
    "/tmp/silknodes-delegations.json",
    JSON.stringify({ valoper, delegations }, null, 2),
  );
  console.log("\nFull list: /tmp/silknodes-delegations.json");
}

main().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
