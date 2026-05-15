# PSE Cohort Methodology

> **Status**: living draft, owned by Silk Nodes.
> **Last revised**: 2026-05-15.
> **Purpose**: documents how we measure recipient behavior around PSE distributions, what we will and will not claim, and what we don't yet know.

This is the reference we check against every time we publish a number related to PSE recipient cohorts. If a chart or social post can't be grounded in something below, it doesn't ship.

---

## 1. Position and disclosure

We operate a validator on the TX network (Silk Nodes). Anything we say about staking behavior on this chain is read with that lens. We commit to:

- **Show on-chain data, not opinions.** Numbers and sources, no inferred motives.
- **State sample size and time window** on every claim.
- **Disclose limitations** in the same place we display the data — not buried elsewhere.
- **Never publish from a single cycle.** Cycle-over-cycle claims require at least 3 distributions.
- **Never frame results as bullish or bearish.** That framing presumes intent we can't observe.

If we slip on any of these, the data isn't honest analysis — it's marketing with our incentive baked in.

---

## 2. What we measure

For each PSE community-pool distribution, we measure a defined cohort of recipients at two points in time and look at three pure-data quantities.

### 2.1. Cohort selection

A "cohort" is the top **N** recipients of the cycle's `pse_community` allocation, ranked by `amount` in the `pse_transfer` table on Coreum's Hasura indexer. We report three cohort sizes for any cycle:

- **Top 100** — concentrated, high-signal but high variance from individual wallets.
- **Top 500** — moderate concentration.
- **Top 1000** — broad sample of who received any meaningful PSE.

Cohort selection bias is real: a "top recipient" is by construction a large pre-existing staker. Smaller delegators' behavior may differ. Cohort numbers should never be generalized to "all stakers."

### 2.2. The two measurement points

For each recipient in a cohort, we record their on-chain bonded stake and liquid `ucore` balance at:

- **`t = before`**: block height `distributionHeight − 1` (the block before the cycle's `start_at_height` from `pse_distribution_allocation`).
- **`t = after`**: block height `min(distributionHeight + 688,648, current_height)`. The +688,648 blocks is ~7 days at Coreum's measured block time of ~98,378 blocks/day. We use 7 days because it is also the unbonding period — the smallest window inside which a delegator could complete a full unbond.

When the +7d height is in the future (cycle still open), we measure at current chain height and label the snapshot `window_complete = false`. Daily snapshots are taken until the window closes.

### 2.3. The three quantities we report

For each recipient:

- **`received_tx`** — the `amount` in `pse_transfer` for this cycle. The PSE the chain awarded them.
- **`bonded_delta_tx`** — `bonded(after) − bonded(before)`.
- **`liquid_delta_tx`** — `liquid(after) − liquid(before)`, restricted to the `ucore` denom.

Aggregated across the cohort:

- **`total received`** — sum of `received_tx`.
- **`net bonded change`** — sum of `bonded_delta_tx`.
- **`net liquid change (ucore only)`** — sum of `liquid_delta_tx`.

These nine numbers per (cycle, cohort_size) are the entire output. Everything else is derived from them.

---

## 3. What we will NOT claim

This section is more important than section 2. The data described above can be sliced many ways; most slices imply motive or behavior we cannot observe.

We will not publish:

- **"Sell pressure" or "sold X TX"** — a TX leaving a wallet is not a sell. Destinations we don't track include other wallets owned by the same person, DEXes, bridges, OTC counterparties, and any CEX not in our `exchange_addresses` table. Without comprehensive CEX coverage, "sold" is unsupportable.
- **"Held" or "compounded"** — Coreum's PSE module auto-bonds the reward at distribution. A recipient whose bonded stake increased by approximately `received_tx` did not actively compound; the protocol did it for them. The neutral term is "the auto-bonded reward remained bonded after 7 days."
- **"Dumped" or "de-risking"** — these imply intent. A wallet whose bonded and liquid both decreased may have:
  - Paid a counterparty in `ucore` for goods or services.
  - Rotated funds to cold storage (another address they control).
  - Sold via a venue we track or one we don't.
  - Lost access to a wallet and someone else moved the funds.
  We can't distinguish these from on-chain data alone.
- **Single-wallet narratives** — calling out individual addresses by activity. The data is public and anyone can look it up, but our publishing the spotlight isn't analysis, it's pressure. We may show wallet-level data inside an internal report, but not in public posts or dashboard UI without explicit operator review.
- **Cycle-over-cycle "trend" claims with fewer than 3 cycles.** N=2 is one data point of difference. N=3 is the minimum where "variance vs trend" becomes a fair question.
- **Network health framing.** "X% retention is healthy / weak" requires a baseline we don't have. Other chains' numbers aren't comparable because PSE auto-bonding is a Coreum-specific mechanism. Until we have a chain-internal historical baseline (e.g. five cycles), no health adjective.

---

## 4. Assumptions we currently rely on, and how to verify each

Every assumption below should be either verified (and the verification linked) or downgraded to an explicit "we believe but have not confirmed."

### 4.1. PSE rewards auto-bond at distribution

**Status**: inferred from observation, not formally verified.

**Why we believe it**: at both observed cycles, the recipient's `action_delegation_total` increased by approximately `pse_transfer.amount` at or immediately after `start_at_height`. The recipient's liquid balance did not increase by the same amount.

**How to verify**:
- Read the Coreum PSE module source.
- Confirm in the Coreum / TX team's v7.0.0 release notes.
- Reproduce with a small test delegation if possible.

**Why it matters**: if auto-bonding stops in a future PSE version (e.g. v8 distributes liquid instead), our analysis silently breaks. We need to re-verify each major chain release.

### 4.2. `pse_transfer.recipient_address` is the same wallet that staked

**Status**: assumed.

**Why we believe it**: at every observation, the recipient address's bonded stake increased after the cycle, which only makes sense if it's the delegator's primary wallet.

**How to verify**: spot-check the recipient address against the validator's `delegations` list at the distribution height; confirm the address appears as a delegator before the cycle.

### 4.3. Coreum block time ≈ 1.05 seconds (98,378 blocks/day)

**Status**: empirically measured between cycle 1 (h=69,509,771) and cycle 2 (h=72,461,119), a 30-day span.

**Why it matters**: we compute "+7 days" as `+688,648` blocks. If block time changes materially (e.g. a chain parameter update), our window drifts.

**How to verify**: re-measure between cycles 2 and 3 once cycle 3 lands. Update the constant if drift > 1%.

### 4.4. Hasura is an accurate indexer of chain state

**Status**: assumed.

**Why it matters**: our entire pipeline reads from Hasura. If the indexer ever lags, returns stale values, or has gaps in `pse_transfer`, we'd produce wrong numbers without noticing.

**How to verify**: spot-check at least one Hasura query against the LCD endpoint for the same address/height. We have done this informally; we should formalize a periodic cross-check.

---

## 5. What we don't know yet

Open questions, in rough order of how much they would improve the analysis:

1. **Where unbonded `ucore` actually goes.** Resolving this requires comprehensive CEX hot-wallet coverage in `exchange_addresses`. We currently track 4 CEXes (Gate, Kraken, MEXC, Bitrue), aggregate 30-day inflow ~163 TX. Effectively zero coverage of where TX volume actually trades.
2. **Block time stability across PSE module updates.** See 4.3.
3. **Whether `pse_transfer` ever miscounts** (e.g. for excluded addresses, vesting accounts, contract recipients).
4. **What other on-chain tokens (e.g. `usaramin`, `txd-*`) mean for the analysis.** Some recipients hold significant balances in tokens other than `ucore`. We currently filter to `ucore` only for the liquid delta but that may understate or overstate behavior depending on what those tokens represent.
5. **Whether smart contract or multi-sig accounts ever appear in the cohort** with different liquidity semantics than human-held EOAs.
6. **The actual sampling cadence we need.** Daily snapshots through a cycle's open window seem informative based on cycles 1-2, but maybe finer granularity (e.g. block-level) reveals patterns we miss.

---

## 6. What we can publish today

Anything below this line is fair to share, given current data:

- **Total community-pool TX distributed per cycle** (sourced from `pse_distribution_allocation.total_amount`).
- **Number of distinct recipients per cycle.**
- **For each cohort size we measure (100, 500, 1000):**
  - Total `received_tx`.
  - Net `bonded_delta_tx` across the cohort.
  - Net `liquid_delta_tx` across the cohort.
- **Per-recipient values, in an internal report only.** Not in public UI without explicit operator review of each release.

For comparisons across cycles: only after **at least 3 completed cycles** of the same mechanism version. Even then, framed as observed variance, not trend.

---

## 7. What we can publish later (after gaps close)

When the corresponding gap is closed, the following become fair:

- "% of unbonded `ucore` reached a tracked CEX within 7 days" — after `exchange_addresses` covers the dominant TX venues.
- Cycle-over-cycle trend language — after N ≥ 3 cycles of stable mechanism.
- "Network retention pattern" framing — after N ≥ 5 cycles, with a documented stable baseline.
- Wallet labels in public UI — after a community-driven submission system with verifiable proof attaches `label` to `address` (we already have `entity_submissions` infrastructure for this).

---

## 8. Process: every chart we ship checks against this doc

When we want to publish a chart, post, or dashboard card that uses PSE cohort data:

1. **Identify the claim.** What does the visual say in one sentence?
2. **Map the claim to numbers in this doc's section 6 (Allowed) or 7 (Future).** If it maps to neither, the claim is wrong as written.
3. **Show source.** Every number gets a tooltip / footnote citing the table and field it came from.
4. **Show limitations.** A "Notes & caveats" link with at least one item from section 5 or one assumption from section 4 visible from the same view.
5. **Get a second pair of eyes** — at least one other Silk Nodes operator confirms the wording before publish.

---

## 9. Revisions

| Date | Author | Change |
|---|---|---|
| 2026-05-15 | Silk Nodes | Initial draft after cycle 2 closed (window ended 2026-05-13 12:00 UTC). |

Future revisions: bump the date and append a row here. Don't silently rewrite — methodology drift undermines the entire point of having a methodology doc.
