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
import { Op } from "sequelize";
import { withCache } from "@/lib/response-cache";
import {
  KnownEntity,
  TopDelegator,
  TopDelegatorHistory,
  WhaleChanges,
} from "@/lib/db/models";

const ROUTE_TAG = "whale-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Widest UI window is 90d; 30 days of margin so the 90d lookback can still
// match the nearest older snapshot rather than falling off the end.
const HISTORY_DAYS = 120;
const HISTORY_CUTOFF = () =>
  new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);

async function handler(_req: Request) {
  try {
    // All four fanned out in parallel. PG handles the concurrency
    // fine and halves total latency vs sequential awaits.
    const [topRows, knownRows, changesRow, historyRows, maxRefreshed] =
      await Promise.all([
        TopDelegator.findAll({ order: [["rank", "ASC"]], raw: true }),
        KnownEntity.findAll({ raw: true }),
        WhaleChanges.findOne({ where: { id: 1 }, raw: true }),
        // Bounded on purpose. This table grows by ~500 rows a day forever, and
        // the response was already 5.9MB (2.9MB gzipped) with no ceiling. An
        // unbounded, uncacheable, multi-megabyte public endpoint is a
        // bandwidth lever for anyone who wants one, and it gets worse on its
        // own every single day.
        //
        // The widest window the UI can ask for is 90 days (WINDOW_LOOKBACK_DAYS
        // in lib/whale-moves), so anything older than the margin below can
        // never be selected. Keeping 120 days leaves room for the
        // nearest-older-snapshot match at the 90d boundary.
        TopDelegatorHistory.findAll({
          where: { date: { [Op.gte]: HISTORY_CUTOFF() } },
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
    // The raw message can carry the DB role, connection string, internal
    // hostnames or upstream credentials, so it is logged and never returned.
    // Callers get a generic failure; operators get the detail in the journal.
    console.error(`[${ROUTE_TAG}]`, err);
    return NextResponse.json(
      { error: "internal error", at: new Date().toISOString() },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

// Cached and single-flighted: repeat traffic costs nothing upstream, and
// concurrent misses share one execution instead of one fan-out each.
export const GET = withCache("whale-data", 300, handler);
