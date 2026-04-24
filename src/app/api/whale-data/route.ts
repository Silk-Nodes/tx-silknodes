// GET /api/whale-data
//
// One endpoint that returns everything useWhaleData() currently
// composes from 4 separate JSON fetches:
//
//   topDelegators   current top-500 snapshot (overwrites every 6 h)
//   knownEntities   address -> label metadata
//   whaleChanges    latest 6 h diff (singleton row, JSONB payload)
//   whaleHistory    daily snapshots for the windowed movers view
//
// Rolling these into a single response halves the client's round
// trips during initial load + saves 3 poll cycles every 5 min.
//
// Shape is IDENTICAL to what the 4 JSONs produced, so the hook only
// needs a URL swap — no component changes downstream.

import { NextResponse } from "next/server";
import {
  KnownEntity,
  TopDelegator,
  TopDelegatorHistory,
  WhaleChanges,
} from "@/lib/db/models";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    // All four fanned out in parallel. PG handles the concurrency
    // fine and halves total latency vs sequential awaits.
    const [topRows, knownRows, changesRow, historyRows, maxRefreshed] =
      await Promise.all([
        TopDelegator.findAll({ order: [["rank", "ASC"]], raw: true }),
        KnownEntity.findAll({ raw: true }),
        WhaleChanges.findOne({ where: { id: 1 }, raw: true }),
        TopDelegatorHistory.findAll({
          order: [
            ["date", "ASC"],
            ["rank", "ASC"],
          ],
          raw: true,
        }),
        TopDelegator.max<Date, TopDelegator>("refreshed_at"),
      ]);

    // ─ topDelegators ─────────────────────────────────────────────
    const topEntries = topRows.map((r) => ({
      rank: r.rank,
      address: r.address,
      totalStake: Number(r.total_stake),
      validatorCount: r.validator_count,
      label:
        r.label_text && r.label_type
          ? {
              text: r.label_text,
              type: r.label_type,
              verified: !!r.label_verified,
            }
          : null,
    }));
    const topDelegators = {
      updatedAt:
        maxRefreshed instanceof Date
          ? maxRefreshed.toISOString()
          : new Date().toISOString(),
      entries: topEntries,
    };

    // ─ knownEntities ─────────────────────────────────────────────
    // Old file shape: { updatedAt, entries: { [address]: meta } }
    const knownMap: Record<
      string,
      { label: string; type: string; verified: boolean; source?: string }
    > = {};
    let knownMaxUpdated: Date | null = null;
    for (const k of knownRows) {
      knownMap[k.address] = {
        label: k.label,
        type: k.type,
        verified: !!k.verified,
        ...(k.source ? { source: k.source } : {}),
      };
      if (!knownMaxUpdated || k.updated_at > knownMaxUpdated) {
        knownMaxUpdated = k.updated_at;
      }
    }
    const knownEntities = {
      updatedAt:
        knownMaxUpdated?.toISOString() ?? new Date().toISOString(),
      entries: knownMap,
    };

    // ─ whaleChanges ──────────────────────────────────────────────
    // JSONB columns come back as already-parsed objects from pg so no
    // JSON.parse here. Defaults to the neutral EMPTY payload the hook
    // uses when the table is empty (first-ever boot or schema reset).
    const whaleChanges = changesRow
      ? {
          updatedAt: changesRow.updated_at.toISOString(),
          rankThreshold: changesRow.rank_threshold,
          stakeThresholdTX: Number(changesRow.stake_threshold_tx),
          arrivals: changesRow.arrivals ?? [],
          exits: changesRow.exits ?? [],
          rankMovers: changesRow.rank_movers ?? [],
          stakeMovers: changesRow.stake_movers ?? [],
        }
      : {
          updatedAt: null,
          rankThreshold: 5,
          stakeThresholdTX: 500_000,
          arrivals: [],
          exits: [],
          rankMovers: [],
          stakeMovers: [],
        };

    // ─ whaleHistory ──────────────────────────────────────────────
    // Group per-address rows into per-date snapshots so the payload
    // matches whale-history.json exactly:
    //   { updatedAt, snapshots: [{ date, entries: [{rank, address, totalStake, labelType}] }] }
    type HistoryEntry = {
      rank: number;
      address: string;
      totalStake: number;
      labelType: string | null;
    };
    const byDate = new Map<string, HistoryEntry[]>();
    for (const h of historyRows) {
      const date = String(h.date);
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date)!.push({
        rank: h.rank,
        address: h.address,
        totalStake: Number(h.total_stake),
        labelType: h.label_type,
      });
    }
    const snapshots = Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, entries]) => ({ date, entries }));
    const whaleHistory = {
      updatedAt: new Date().toISOString(),
      snapshots,
    };

    return NextResponse.json(
      { topDelegators, knownEntities, whaleChanges, whaleHistory },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: message, at: new Date().toISOString() },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

