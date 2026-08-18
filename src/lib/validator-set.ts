// The active validator set, resolved from a source we control.
//
// Why this is not read from the Coreum indexer any more
// ----------------------------------------------------
// The governance page used to build its validator list from Hasura's
// validator_voting_power / validator_status tables. On 2026-08-18 that
// index had no status row at all for four bonded validators: Kraken,
// SOLONATIONLABS, Huobi and Zeeve Inc., 339,303,713 TX between them and
// 9.87% of all bonded stake. The page rendered 50 validators while the
// chain had 54, and Kraken, the fourth largest validator on the network,
// was simply absent from a governance breakdown.
//
// Nothing was wrong with our code. It faithfully rendered a bad upstream.
// That is the failure worth designing out: an incomplete answer that looks
// complete is worse than an error, because nobody goes looking for the
// missing rows.
//
// Resolution order, first success wins:
//   1. validator_snapshots, our own daily LCD-sourced table on the VM
//   2. the LCD directly, if the table is empty or the day's run has not fired
//
// Hasura keeps exactly one job on that page: telling us who voted.

import { QueryTypes } from "sequelize";
import { decode as bech32Decode, encode as bech32Encode } from "bech32";
import { sequelize } from "@/lib/db";
import { lcdGet } from "@/lib/chain-config";

export interface ValidatorSetRow {
  operatorAddress: string;
  /** Account address that casts this validator's governance vote. */
  selfDelegateAddress: string;
  moniker: string;
  /** Bonded stake in display TX. */
  bondedStakeTX: number;
  /** Cosmos SDK numeric status: 3 = BOND_STATUS_BONDED. */
  status: number;
  jailed: boolean;
}

export type ValidatorSetSource = "db" | "lcd" | "none";

/**
 * An operator address and the account that votes for it are the same 20
 * bytes with a different bech32 prefix, so this needs no lookup at all.
 *
 * Checked against every row the Coreum indexer holds: 99 of 100 agreed, and
 * the one that did not was a corrupt 90-character value where an address
 * belongs. Deriving is strictly more reliable than reading it.
 */
export function deriveSelfDelegate(operatorAddress: string): string {
  try {
    const { words } = bech32Decode(operatorAddress);
    return bech32Encode("core", words);
  } catch {
    return "";
  }
}

const STATUS_TO_NUM: Record<string, number> = {
  BOND_STATUS_UNBONDED: 1,
  BOND_STATUS_UNBONDING: 2,
  BOND_STATUS_BONDED: 3,
};

/** Latest day of validator_snapshots. Empty array if the table has nothing. */
async function fromDb(): Promise<ValidatorSetRow[]> {
  const rows = await sequelize.query<{
    operator_address: string;
    self_delegate_address: string | null;
    moniker: string;
    tokens: string;
    status: string;
    jailed: boolean;
  }>(
    `SELECT operator_address, self_delegate_address, moniker, tokens, status, jailed
       FROM validator_snapshots
      WHERE date = (SELECT MAX(date) FROM validator_snapshots)`,
    { type: QueryTypes.SELECT },
  );
  return rows.map((r) => ({
    operatorAddress: r.operator_address,
    // Derive even when the column is populated: the column is only as good
    // as the run that wrote it, and the derivation cannot be stale.
    selfDelegateAddress:
      deriveSelfDelegate(r.operator_address) || r.self_delegate_address || "",
    moniker: r.moniker,
    bondedStakeTX: Number(r.tokens) || 0,
    status: STATUS_TO_NUM[r.status] ?? 0,
    jailed: r.jailed,
  }));
}

/** Straight from the chain. Used when the table is empty or a day behind. */
async function fromLcd(): Promise<ValidatorSetRow[]> {
  const res = await lcdGet(
    "/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=500",
  );
  if (!res.ok) throw new Error(`lcd HTTP ${res.status}`);
  const json = (await res.json()) as {
    validators?: {
      operator_address: string;
      tokens: string;
      jailed: boolean;
      status: string;
      description?: { moniker?: string };
    }[];
  };
  return (json.validators || []).map((v) => ({
    operatorAddress: v.operator_address,
    selfDelegateAddress: deriveSelfDelegate(v.operator_address),
    moniker: v.description?.moniker || v.operator_address.slice(0, 16),
    bondedStakeTX: Number(v.tokens) / 1_000_000,
    status: STATUS_TO_NUM[v.status] ?? 0,
    jailed: v.jailed,
  }));
}

/**
 * The bonded, non-jailed set.
 *
 * Returns the source alongside the rows so a caller can say where the
 * numbers came from rather than presenting two very different provenances
 * as the same thing.
 */
export async function getActiveValidatorSet(): Promise<{
  validators: ValidatorSetRow[];
  source: ValidatorSetSource;
}> {
  for (const [source, load] of [
    ["db", fromDb],
    ["lcd", fromLcd],
  ] as [ValidatorSetSource, () => Promise<ValidatorSetRow[]>][]) {
    try {
      const all = await load();
      const bonded = all.filter((v) => v.status === 3 && !v.jailed);
      if (bonded.length > 0) return { validators: bonded, source };
    } catch {
      // Try the next source. A caller that gets source "none" can decide
      // whether to fail or fall back to whatever it had before.
    }
  }
  return { validators: [], source: "none" };
}
