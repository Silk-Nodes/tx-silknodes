// Verifies our tally logic against cosmos-sdk v0.53.6 rules and against every
// settled proposal the chain has already decided. Run: node scripts/verify-tally.mjs
const LCD = process.env.LCD || "https://full-node.mainnet-1.coreum.dev:1317";

const calcVetoShare = (t) => (t.totalVoted <= 0 ? 0 : t.noWithVeto / t.totalVoted);
function evaluateTally(t, p) {
  const bonded = t.bondedSnapshot, total = t.totalVoted;
  if (bonded > 0 && total / bonded < p.quorum) return { verdict: "quorum-not-met", depositBurned: true };
  const nonAbstain = total - t.abstain;
  if (nonAbstain <= 0) return { verdict: "all-abstain", depositBurned: false };
  if (calcVetoShare(t) > p.vetoThreshold) return { verdict: "vetoed", depositBurned: true };
  if (t.yes / nonAbstain > p.threshold) return { verdict: "passing", depositBurned: false };
  return { verdict: "rejected", depositBurned: false };
}

const u = (x) => Number(x || 0) / 1e6;
const get = async (path) => {
  const r = await fetch(`${LCD}${path}`);
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return r.json();
};

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n         got ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};

const P = { quorum: 0.4, threshold: 0.5, vetoThreshold: 0.334 };
const T = (yes, no, veto, abstain, bonded) => ({
  yes, no, noWithVeto: veto, abstain, totalVoted: yes + no + veto + abstain, bondedSnapshot: bonded,
});

console.log("=== unit: SDK boundary semantics ===");
// veto denominator INCLUDES abstain. 334 veto of 1000 total is exactly 33.4%,
// which is NOT greater than the threshold, so it must NOT veto.
check("veto exactly at threshold does not veto", evaluateTally(T(566, 0, 334, 100, 1000), P).verdict, "passing");
// On the wrong (non-abstain) denominator 334/900 = 37.1% would have vetoed.
check("veto uses total incl. abstain", calcVetoShare(T(566, 0, 334, 100, 1000)).toFixed(4), "0.3340");
check("veto just over threshold vetoes", evaluateTally(T(565, 0, 335, 100, 1000), P).verdict, "vetoed");
check("vetoed burns deposit", evaluateTally(T(565, 0, 335, 100, 1000), P).depositBurned, true);
// yes threshold is over NON-abstain, strictly greater
check("yes exactly at 50% of non-abstain fails", evaluateTally(T(450, 450, 0, 100, 1000), P).verdict, "rejected");
check("yes just over 50% passes", evaluateTally(T(451, 449, 0, 100, 1000), P).verdict, "passing");
check("abstain excluded from yes denominator", evaluateTally(T(300, 200, 0, 500, 1000), P).verdict, "passing");
check("quorum exactly met is not a fail", evaluateTally(T(400, 0, 0, 0, 1000), P).verdict, "passing");
check("below quorum fails first", evaluateTally(T(399, 0, 0, 0, 1000), P).verdict, "quorum-not-met");
check("quorum fail burns deposit", evaluateTally(T(399, 0, 0, 0, 1000), P).depositBurned, true);
check("all abstain", evaluateTally(T(0, 0, 0, 500, 1000), P).verdict, "all-abstain");
// veto beats a landslide yes -- the prop 45 shape
check("veto outranks a yes majority", evaluateTally(T(600, 0, 400, 0, 1000), P).verdict, "vetoed");

console.log("\n=== live: replay every settled proposal on chain ===");
const params = (await get("/cosmos/gov/v1/params/tallying")).params;
const live = { quorum: +params.quorum, threshold: +params.threshold, vetoThreshold: +params.veto_threshold };
console.log(`  chain params: quorum ${live.quorum} threshold ${live.threshold} veto ${live.vetoThreshold}`);

let props = [], key = null;
do {
  const q = new URLSearchParams({ "pagination.limit": "100" });
  if (key) q.set("pagination.key", key);
  const d = await get(`/cosmos/gov/v1/proposals?${q}`);
  props = props.concat(d.proposals);
  key = d.pagination?.next_key;
} while (key);

// The quorum leg needs each proposal's bonded snapshot at voting time, which
// the LCD does not serve historically. Today's pool is 4.6x the 2025 pool
// because of PSE, so using it would fail quorum on every old proposal for
// reasons that have nothing to do with the tally rules. We therefore replay
// the two legs this change actually touches -- veto and threshold -- by
// handing the evaluator a snapshot equal to the votes cast, so quorum is met, and report the
// quorum leg as not covered here.
let replayed = 0, agreed = 0;
for (const p of props) {
  const st = p.status;
  if (st !== "PROPOSAL_STATUS_PASSED" && st !== "PROPOSAL_STATUS_REJECTED") continue;
  const ft = p.final_tally_result;
  const yes = u(ft.yes_count), no = u(ft.no_count), veto = u(ft.no_with_veto_count), abstain = u(ft.abstain_count);
  const totalVoted = yes + no + veto + abstain;
  if (totalVoted === 0) continue;
  const t = { yes, no, noWithVeto: veto, abstain, totalVoted, bondedSnapshot: totalVoted };
  const r = evaluateTally(t, live);
  const wePass = r.verdict === "passing";
  const chainPassed = st === "PROPOSAL_STATUS_PASSED";
  replayed++;
  if (wePass === chainPassed) agreed++;
  else console.log(`  DISAGREE #${p.id}: chain=${chainPassed ? "PASSED" : "REJECTED"} ours=${r.verdict} (veto ${(calcVetoShare(t) * 100).toFixed(2)}%, yes ${(yes / (totalVoted - abstain) * 100).toFixed(2)}% non-abstain)`);
}
console.log(`  replayed ${replayed} settled proposals on the veto+threshold legs, agreed on ${agreed}`);
if (replayed !== agreed) failures++;
console.log(`\n${failures === 0 ? "ALL UNIT CHECKS PASSED" : failures + " UNIT CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
