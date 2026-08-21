// Reports how far behind tip each LCD host is, and cross-checks a live
// governance tally across all of them. A host that answers 200 OK while
// stale is the failure this catches: on 2026-08-21 one such host served a
// tally missing a 240.9M TX abstain vote, putting proposal 45 on the wrong
// side of the veto threshold on our dashboard.
//
// Run: node scripts/check-lcd-freshness.mjs [proposalId]
const HOSTS = [
  "https://rest-coreum.ecostake.com",
  "https://coreum-api.polkachu.com",
  "https://coreum-rest.publicnode.com",
  "https://rest.cosmos.directory/coreum",
  "https://full-node.mainnet-1.coreum.dev:1317",
  "https://coreum-lcd.silknodes.io",
];
const MAX_LAG_MS = 120_000;
const PROPOSAL = process.argv[2] || "45";

const get = async (host, path) => {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 12_000);
  try {
    const r = await fetch(`${host}${path}`, { signal: c.signal });
    return r.ok ? await r.json() : null;
  } catch { return null; } finally { clearTimeout(t); }
};

console.log("host".padEnd(46), "height".padStart(12), "lag".padStart(10), "  status");
const rows = [];
for (const h of HOSTS) {
  const b = await get(h, "/cosmos/base/tendermint/v1beta1/blocks/latest");
  if (!b) { console.log(h.replace("https://", "").padEnd(46), "unreachable".padStart(12)); continue; }
  const height = Number(b.block.header.height);
  const lag = Date.now() - Date.parse(b.block.header.time);
  const stale = lag > MAX_LAG_MS;
  rows.push({ h, height, lag, stale });
  console.log(
    h.replace("https://", "").padEnd(46),
    height.toLocaleString().padStart(12),
    `${(lag / 1000).toFixed(0)}s`.padStart(10),
    stale ? "  STALE" : "  ok",
  );
}

console.log(`\ntally cross-check on proposal ${PROPOSAL}:`);
const seen = new Map();
for (const { h, stale } of rows) {
  const t = await get(h, `/cosmos/gov/v1/proposals/${PROPOSAL}/tally`);
  if (!t?.tally) continue;
  const v = t.tally;
  const n = (x) => Number(x || 0) / 1e6;
  const tot = n(v.yes_count) + n(v.no_count) + n(v.abstain_count) + n(v.no_with_veto_count);
  const veto = tot > 0 ? n(v.no_with_veto_count) / tot : 0;
  const key = `${Math.round(tot)}`;
  seen.set(key, (seen.get(key) || 0) + 1);
  console.log(
    `  ${h.replace("https://", "").padEnd(44)} abstain ${n(v.abstain_count).toLocaleString(undefined, { maximumFractionDigits: 0 }).padStart(14)} TX  veto ${(veto * 100).toFixed(2)}%  ${veto > 0.334 ? "VETOED" : "passing"}${stale ? "   <- from a STALE host" : ""}`,
  );
}
if (seen.size > 1) {
  console.log(`\nWARNING: hosts disagree on the tally (${seen.size} distinct totals). Trust the freshest.`);
  process.exit(1);
}
console.log("\nall responding hosts agree on the tally.");
