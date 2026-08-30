#!/usr/bin/env node
// Validator Identity Collector
//
// Moniker, Keybase identity, avatar and website for every validator, stored
// in validator_identity so pages do not depend on the Coreum indexer for it.
//
// Every validator logo on the site disappeared on 2026-08-30 when
// hasura.mainnet-1.coreum.dev returned 503 for two days: avatar_url and
// website came only from its validator_description table. Monikers survived
// because those already come from validator_snapshots, which is ours.
//
// None of this needs the indexer. The chain carries moniker, website and
// identity in each validator's description, and identity is the Keybase key
// suffix that resolves to a picture.
//
// Sources:
//   LCD       /cosmos/staking/v1beta1/validators   moniker, identity, website
//   Keybase   /_/api/1.0/user/lookup.json          picture URL for an identity
//
// Keybase is treated as optional. A failed lookup leaves avatar_url as it was
// and does not stamp avatar_checked_at, so the next run retries rather than
// caching an outage as "this validator has no logo".
const DRY = process.argv.includes("--dry-run");
const { query, closePool } = DRY
  ? { query: async () => ({ rows: [] }), closePool: async () => {} }
  : await import("./db.mjs");

const LCD_POOL = (process.env.GOV_LCD_POOL || [
  "https://api.silknodes.io/coreum",
  "https://rest-coreum.ecostake.com",
  "https://coreum-api.polkachu.com",
].join(",")).split(",").map((s) => s.trim()).filter(Boolean);

const levels = { debug: 0, info: 1, warn: 2, error: 3 };
const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const log = (l, m) => {
  if (levels[l] >= levels[LOG_LEVEL]) console[l === "error" ? "error" : "log"](`[vid] ${l}: ${m}`);
};

async function lcd(path) {
  let lastErr;
  for (const host of LCD_POOL) {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 20_000);
      const res = await fetch(`${host}${path}`, { signal: c.signal });
      clearTimeout(t);
      if (res.ok) return await res.json();
      lastErr = new Error(`HTTP ${res.status} from ${host}`);
    } catch (e) { lastErr = e; }
  }
  throw lastErr ?? new Error("no LCD host answered");
}

/** Keybase picture for an identity suffix, or null. Never throws: a logo is
 *  a nice-to-have and must not fail the run. */
async function keybaseAvatar(identity) {
  if (!identity || identity.length < 8) return null;
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 12_000);
    const res = await fetch(
      `https://keybase.io/_/api/1.0/user/lookup.json?key_suffix=${encodeURIComponent(identity)}&fields=pictures`,
      { signal: c.signal },
    );
    clearTimeout(t);
    if (!res.ok) return null;
    const body = await res.json();
    return body?.them?.[0]?.pictures?.primary?.url ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const started = Date.now();
  const all = [];
  let key = null;
  for (let page = 0; page < 10; page++) {
    const q = new URLSearchParams({ "pagination.limit": "200" });
    if (key) q.set("pagination.key", key);
    const body = await lcd(`/cosmos/staking/v1beta1/validators?${q}`);
    all.push(...(body?.validators ?? []));
    key = body?.pagination?.next_key ?? null;
    if (!key) break;
  }
  log("info", `chain has ${all.length} validators`);

  let withIdentity = 0, resolved = 0, failed = 0;

  for (const v of all) {
    const d = v.description ?? {};
    const identity = (d.identity || "").trim();
    let avatar = null;
    let checked = null;

    if (identity) {
      withIdentity++;
      avatar = await keybaseAvatar(identity);
      if (avatar) { resolved++; checked = new Date().toISOString(); }
      else { failed++; }
    } else {
      // No identity is a real answer, not a failure: stamp it so we do not
      // retry a validator that simply has no Keybase account every run.
      checked = new Date().toISOString();
    }

    await query(
      `INSERT INTO validator_identity
         (operator_address, moniker, identity, avatar_url, website, details,
          avatar_checked_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now())
       ON CONFLICT (operator_address) DO UPDATE SET
         moniker=EXCLUDED.moniker,
         identity=EXCLUDED.identity,
         website=EXCLUDED.website,
         details=EXCLUDED.details,
         -- Keep the last good avatar when this run could not resolve one, so
         -- a Keybase outage does not blank every logo on the site.
         avatar_url=COALESCE(EXCLUDED.avatar_url, validator_identity.avatar_url),
         avatar_checked_at=COALESCE(EXCLUDED.avatar_checked_at, validator_identity.avatar_checked_at),
         updated_at=now()`,
      [v.operator_address, d.moniker || v.operator_address, identity || null,
       avatar, d.website || null, d.details || null, checked],
    );
  }

  log("info",
    `done in ${((Date.now() - started) / 1000).toFixed(1)}s: ${all.length} validators, ` +
    `${withIdentity} with a Keybase identity, ${resolved} avatars resolved, ${failed} unresolved`);
}

main()
  .catch((e) => { log("error", e.stack || e.message); process.exitCode = 1; })
  .finally(() => closePool());
