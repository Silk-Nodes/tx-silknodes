// Sequelize models for every table defined in
// vm-service/migrations/001_initial.sql. The SQL file remains the
// authoritative schema — these models mirror it for read-side type
// safety and ergonomic query building in API routes.
//
// Convention:
//   - freezeTableName: true so Sequelize doesn't pluralise to
//     "daily_metrics" -> "daily_metrics_something" weirdness.
//   - timestamps: false because the VM collectors manage their own
//     `updated_at` / `computed_at` / `refreshed_at` columns; we don't
//     want Sequelize inventing createdAt / updatedAt columns.
//   - underscored: true so JS fields map to snake_case DB columns.
//
// Add associations only when the API actually needs a join — keep the
// models thin until we have a concrete read pattern to model.

import {
  DataTypes,
  Model,
  type InferAttributes,
  type InferCreationAttributes,
} from "sequelize";
import { sequelize } from "./index";

// ─── staking_events ──────────────────────────────────────────────────────
export class StakingEvent extends Model<
  InferAttributes<StakingEvent>,
  InferCreationAttributes<StakingEvent>
> {
  declare id: number;
  declare tx_hash: string;
  declare height: number;
  declare timestamp: Date;
  declare type: "delegate" | "undelegate" | "redelegate";
  declare delegator: string;
  declare validator: string;
  declare source_validator: string | null;
  declare amount: string; // NUMERIC arrives as string to preserve precision
  declare memo: string | null;
  declare inserted_at: Date;
}
StakingEvent.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    tx_hash: { type: DataTypes.TEXT, allowNull: false },
    height: { type: DataTypes.BIGINT, allowNull: false },
    timestamp: { type: DataTypes.DATE, allowNull: false },
    type: { type: DataTypes.TEXT, allowNull: false },
    delegator: { type: DataTypes.TEXT, allowNull: false },
    validator: { type: DataTypes.TEXT, allowNull: false },
    source_validator: { type: DataTypes.TEXT },
    amount: { type: DataTypes.DECIMAL, allowNull: false },
    memo: { type: DataTypes.TEXT },
    inserted_at: { type: DataTypes.DATE, allowNull: false },
  },
  { sequelize, tableName: "staking_events", timestamps: false, underscored: true },
);

// ─── validators ──────────────────────────────────────────────────────────
export class Validator extends Model<
  InferAttributes<Validator>,
  InferCreationAttributes<Validator>
> {
  declare operator_address: string;
  declare moniker: string;
  declare updated_at: Date;
}
Validator.init(
  {
    operator_address: { type: DataTypes.TEXT, primaryKey: true },
    moniker: { type: DataTypes.TEXT, allowNull: false },
    updated_at: { type: DataTypes.DATE, allowNull: false },
  },
  { sequelize, tableName: "validators", timestamps: false, underscored: true },
);

// ─── top_delegators ──────────────────────────────────────────────────────
export class TopDelegator extends Model<
  InferAttributes<TopDelegator>,
  InferCreationAttributes<TopDelegator>
> {
  declare address: string;
  declare rank: number;
  declare total_stake: string;
  declare validator_count: number;
  declare label_text: string | null;
  declare label_type: string | null;
  declare label_verified: boolean | null;
  declare refreshed_at: Date;
}
TopDelegator.init(
  {
    address: { type: DataTypes.TEXT, primaryKey: true },
    rank: { type: DataTypes.INTEGER, allowNull: false },
    total_stake: { type: DataTypes.DECIMAL, allowNull: false },
    validator_count: { type: DataTypes.INTEGER, allowNull: false },
    label_text: { type: DataTypes.TEXT },
    label_type: { type: DataTypes.TEXT },
    label_verified: { type: DataTypes.BOOLEAN },
    refreshed_at: { type: DataTypes.DATE, allowNull: false },
  },
  { sequelize, tableName: "top_delegators", timestamps: false, underscored: true },
);

// ─── top_delegators_history ──────────────────────────────────────────────
export class TopDelegatorHistory extends Model<
  InferAttributes<TopDelegatorHistory>,
  InferCreationAttributes<TopDelegatorHistory>
> {
  declare date: string; // YYYY-MM-DD
  declare rank: number;
  declare address: string;
  declare total_stake: string;
  declare label_type: string | null;
}
TopDelegatorHistory.init(
  {
    date: { type: DataTypes.DATEONLY, primaryKey: true },
    rank: { type: DataTypes.INTEGER, allowNull: false },
    address: { type: DataTypes.TEXT, primaryKey: true },
    total_stake: { type: DataTypes.DECIMAL, allowNull: false },
    label_type: { type: DataTypes.TEXT },
  },
  { sequelize, tableName: "top_delegators_history", timestamps: false, underscored: true },
);

// ─── whale_changes (singleton, id = 1) ───────────────────────────────────
export class WhaleChanges extends Model<
  InferAttributes<WhaleChanges>,
  InferCreationAttributes<WhaleChanges>
> {
  declare id: number;
  declare updated_at: Date;
  declare rank_threshold: number;
  declare stake_threshold_tx: string;
  declare arrivals: unknown;
  declare exits: unknown;
  declare rank_movers: unknown;
  declare stake_movers: unknown;
}
WhaleChanges.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true },
    updated_at: { type: DataTypes.DATE, allowNull: false },
    rank_threshold: { type: DataTypes.INTEGER, allowNull: false },
    stake_threshold_tx: { type: DataTypes.DECIMAL, allowNull: false },
    arrivals: { type: DataTypes.JSONB, allowNull: false },
    exits: { type: DataTypes.JSONB, allowNull: false },
    rank_movers: { type: DataTypes.JSONB, allowNull: false },
    stake_movers: { type: DataTypes.JSONB, allowNull: false },
  },
  { sequelize, tableName: "whale_changes", timestamps: false, underscored: true },
);

// ─── pending_undelegations ───────────────────────────────────────────────
export class PendingUndelegation extends Model<
  InferAttributes<PendingUndelegation>,
  InferCreationAttributes<PendingUndelegation>
> {
  declare date: string;
  declare value: string;
  declare updated_at: Date;
}
PendingUndelegation.init(
  {
    date: { type: DataTypes.DATEONLY, primaryKey: true },
    value: { type: DataTypes.DECIMAL, allowNull: false },
    updated_at: { type: DataTypes.DATE, allowNull: false },
  },
  { sequelize, tableName: "pending_undelegations", timestamps: false, underscored: true },
);

// ─── daily_metrics ───────────────────────────────────────────────────────
export class DailyMetric extends Model<
  InferAttributes<DailyMetric>,
  InferCreationAttributes<DailyMetric>
> {
  declare date: string;
  declare transactions: number | null;
  declare active_addresses: number | null;
  declare total_stake: string | null;
  declare staking_apr: string | null;
  declare staked_pct: string | null;
  declare total_supply: string | null;
  declare circulating_supply: string | null;
  declare price_usd: string | null;
  declare computed_at: Date;
}
DailyMetric.init(
  {
    date: { type: DataTypes.DATEONLY, primaryKey: true },
    transactions: { type: DataTypes.BIGINT },
    active_addresses: { type: DataTypes.BIGINT },
    total_stake: { type: DataTypes.DECIMAL },
    staking_apr: { type: DataTypes.DECIMAL },
    staked_pct: { type: DataTypes.DECIMAL },
    total_supply: { type: DataTypes.DECIMAL },
    circulating_supply: { type: DataTypes.DECIMAL },
    price_usd: { type: DataTypes.DECIMAL },
    computed_at: { type: DataTypes.DATE, allowNull: false },
  },
  { sequelize, tableName: "daily_metrics", timestamps: false, underscored: true },
);

// ─── known_entities ──────────────────────────────────────────────────────
export class KnownEntity extends Model<
  InferAttributes<KnownEntity>,
  InferCreationAttributes<KnownEntity>
> {
  declare address: string;
  declare label: string;
  declare type: string;
  declare verified: boolean;
  declare source: string | null;
  declare updated_at: Date;
}
KnownEntity.init(
  {
    address: { type: DataTypes.TEXT, primaryKey: true },
    label: { type: DataTypes.TEXT, allowNull: false },
    type: { type: DataTypes.TEXT, allowNull: false },
    verified: { type: DataTypes.BOOLEAN, allowNull: false },
    source: { type: DataTypes.TEXT },
    updated_at: { type: DataTypes.DATE, allowNull: false },
  },
  { sequelize, tableName: "known_entities", timestamps: false, underscored: true },
);

// ─── exchange_addresses ──────────────────────────────────────────────────
export class ExchangeAddress extends Model<
  InferAttributes<ExchangeAddress>,
  InferCreationAttributes<ExchangeAddress>
> {
  declare address: string;
  declare exchange_name: string;
  declare added_at: Date;
  declare notes: string | null;
}
ExchangeAddress.init(
  {
    address: { type: DataTypes.TEXT, primaryKey: true },
    exchange_name: { type: DataTypes.TEXT, allowNull: false },
    added_at: { type: DataTypes.DATE, allowNull: false },
    notes: { type: DataTypes.TEXT },
  },
  {
    sequelize,
    tableName: "exchange_addresses",
    timestamps: false,
    underscored: true,
  },
);

// ─── exchange_flows ──────────────────────────────────────────────────────
export class ExchangeFlow extends Model<
  InferAttributes<ExchangeFlow>,
  InferCreationAttributes<ExchangeFlow>
> {
  declare id: number;
  declare tx_hash: string;
  declare height: number;
  declare timestamp: Date;
  declare exchange_address: string;
  declare direction: "inflow" | "outflow";
  declare counterparty: string;
  declare amount: string; // NUMERIC -> string for precision
  declare inserted_at: Date;
}
ExchangeFlow.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    tx_hash: { type: DataTypes.TEXT, allowNull: false },
    height: { type: DataTypes.BIGINT, allowNull: false },
    timestamp: { type: DataTypes.DATE, allowNull: false },
    exchange_address: { type: DataTypes.TEXT, allowNull: false },
    direction: { type: DataTypes.TEXT, allowNull: false },
    counterparty: { type: DataTypes.TEXT, allowNull: false },
    amount: { type: DataTypes.DECIMAL, allowNull: false },
    inserted_at: { type: DataTypes.DATE, allowNull: false },
  },
  {
    sequelize,
    tableName: "exchange_flows",
    timestamps: false,
    underscored: true,
  },
);

// ─── pse_score ───────────────────────────────────────────────────────────
export class PseScore extends Model<
  InferAttributes<PseScore>,
  InferCreationAttributes<PseScore>
> {
  declare computed_at: Date;
  declare score: string;
  declare payload: unknown;
}
PseScore.init(
  {
    computed_at: { type: DataTypes.DATE, primaryKey: true },
    score: { type: DataTypes.DECIMAL, allowNull: false },
    payload: { type: DataTypes.JSONB },
  },
  { sequelize, tableName: "pse_score", timestamps: false, underscored: true },
);
