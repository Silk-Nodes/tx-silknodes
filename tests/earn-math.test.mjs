// Run with `npm test`. Plain node:test, no test framework: Node strips the
// types from the .ts import itself.
//
// The expected values are not round-trips of the code. Each one is either
// arithmetic done by hand or a figure read from the chain on 2026-11-18.

import test from "node:test";
import assert from "node:assert/strict";
import {
  stakingReward, averageCommission, vaultReward, gridStep,
  cleanAmount, groupAmount, amountOf,
} from "../src/lib/earn-math.ts";

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

test("staking: a year at the APR pays exactly the APR", () => {
  assert.equal(stakingReward(10_000, 0.2, 365, false), 2_000);
  // 24.57% base, 5.5972% average commission, read from the chain 2026-11-18.
  near(stakingReward(10_000, 0.2457 * (1 - 0.055972), 365, false), 2319.47, 0.01);
  // Kraken, 8% commission.
  near(stakingReward(10_000, 0.2457 * 0.92, 365, false), 2260.44, 0.01);
});

test("staking: shorter periods scale by days", () => {
  near(stakingReward(10_000, 0.2, 73, false), 400, 1e-9);
  near(stakingReward(10_000, 0.2, 1, false), 2000 / 365, 1e-9);
});

test("staking: daily restaking compounds and always beats not restaking", () => {
  // (1 + 0.2/365)^365 - 1 = 0.2213358...
  near(stakingReward(10_000, 0.2, 365, true), 2213.36, 0.01);
  for (const d of [1, 30, 90, 365]) {
    assert.ok(stakingReward(1_000, 0.2, d, true) >= stakingReward(1_000, 0.2, d, false));
  }
});

test("staking: nothing in, nothing out", () => {
  assert.equal(stakingReward(0, 0.2, 365, false), 0);
  assert.equal(stakingReward(-5, 0.2, 365, true), 0);
  assert.equal(stakingReward(100, 0, 365, false), 0);
  assert.equal(stakingReward(100, 0.2, 0, true), 0);
});

test("average commission is weighted by stake", () => {
  assert.equal(averageCommission([]), null);
  assert.equal(averageCommission([{ tokens: 0, commission: 0.05 }]), null);
  near(averageCommission([{ tokens: 300, commission: 0.05 }, { tokens: 100, commission: 0.2 }]), 0.0875, 1e-12);
});

test("vault: matches positions read from the contract", () => {
  // The page's own example: 1,000 USTX, 90 days, 7%.
  near(vaultReward(1_000, 7, 90), 17.2603, 0.0001);
  // Position 3: 25 USTX at 7% earned 3.713849 TX on day 20770 at an oracle
  // price of 0.001290984109668704. One day of reward, converted at that price.
  near(vaultReward(25, 7, 1) / 0.001290984109668704, 3.713849, 0.000005);
  // The other five steps of the ladder for 1,000 USTX.
  near(vaultReward(1_000, 6, 30), 4.9315, 0.0001);
  near(vaultReward(1_000, 3, 30), 2.4658, 0.0001);
  near(vaultReward(1_000, 6.5, 60), 10.6849, 0.0001);
  near(vaultReward(1_000, 3.25, 60), 5.3425, 0.0001);
  near(vaultReward(1_000, 3.5, 90), 8.6301, 0.0001);
  assert.equal(vaultReward(0, 7, 90), 0);
});

test("grid step is round and gives two to four lines", () => {
  for (const [max, step] of [[2457, 1000], [999, 250], [600, 250], [1900, 500], [4900, 2000], [9900, 2500], [0.9, 0.25], [2_460_000, 1_000_000]]) {
    assert.equal(gridStep(max), step, `max ${max}`);
    const lines = Math.floor(max / step);
    assert.ok(lines >= 2 && lines <= 4, `max ${max} gives ${lines} lines`);
  }
  assert.equal(gridStep(0), 0);
  assert.equal(gridStep(NaN), 0);
  assert.equal(gridStep(Infinity), 0);
});

test("amount field: cleaning", () => {
  assert.equal(cleanAmount("10,000"), "10000");
  assert.equal(cleanAmount("abc12x.5y"), "12.5");
  assert.equal(cleanAmount("1.2.3"), "1.23");
  assert.equal(cleanAmount("0007"), "7");
  assert.equal(cleanAmount("0.5"), "0.5");
  assert.equal(cleanAmount("0"), "0");
  assert.equal(cleanAmount("1.123456789"), "1.123456");
  assert.equal(cleanAmount("12."), "12.");
  assert.equal(cleanAmount(""), "");
});

test("amount field: grouping", () => {
  assert.equal(groupAmount("10000"), "10,000");
  assert.equal(groupAmount("1234567.5"), "1,234,567.5");
  assert.equal(groupAmount("999"), "999");
  assert.equal(groupAmount("1000."), "1,000.");
  assert.equal(groupAmount("1000.123456"), "1,000.123456");
  assert.equal(groupAmount(""), "");
});

test("amount field: value", () => {
  assert.equal(amountOf("2500.25"), 2500.25);
  assert.equal(amountOf(""), 0);
  assert.equal(amountOf("."), 0);
  assert.equal(amountOf("12."), 12);
});
