#!/usr/bin/env node

/**
 * Tiny CLI for reviewing community submissions to entity_submissions.
 * Avoids dealing with raw psql + remembering the multi-statement
 * approve transaction.
 *
 * Usage:
 *   node vm-service/review-submissions.mjs list
 *   node vm-service/review-submissions.mjs approve <id>
 *   node vm-service/review-submissions.mjs reject  <id> [reason]
 *   node vm-service/review-submissions.mjs show    <id>
 *
 * Approve: copies the row's (address, label, type, source) into
 *   known_entities (UPSERT, marks verified=true), then sets the
 *   submission's status='approved' + reviewed_at=NOW().
 * Reject : sets status='rejected' + reviewed_at + reviewer_note.
 *   Address stays in the audit panel for someone else to label.
 *
 * Reads PGHOST/PGUSER/PGPASSWORD/PGDATABASE from env. Source the
 * silknodes env file before running:
 *   source /home/zoltan/.silknodes-db.env
 */

import { query, closePool } from "./db.mjs";

const COLOURS = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  red:    "\x1b[31m",
  green:  "\x1b[32m",
  yellow: "\x1b[33m",
  cyan:   "\x1b[36m",
};
const c = (clr, s) => `${COLOURS[clr]}${s}${COLOURS.reset}`;

function usage() {
  console.log(`Usage:
  node vm-service/review-submissions.mjs list
  node vm-service/review-submissions.mjs show    <id>
  node vm-service/review-submissions.mjs approve <id>
  node vm-service/review-submissions.mjs reject  <id> [reason]`);
}

async function list() {
  const res = await query(
    `SELECT id, address, label, type, source, submitted_at
     FROM entity_submissions
     WHERE status = 'pending'
     ORDER BY submitted_at DESC`,
    [],
  );
  if (res.rows.length === 0) {
    console.log(c("dim", "no pending submissions"));
    return;
  }
  console.log(c("bold", `${res.rows.length} pending submission(s):`));
  for (const r of res.rows) {
    console.log(
      `\n  ${c("yellow", `#${r.id}`)}  ${c("cyan", r.address)}` +
      `\n    label : ${c("bold", r.label)}` +
      `\n    type  : ${r.type}` +
      (r.source ? `\n    source: ${r.source}` : "") +
      `\n    when  : ${new Date(r.submitted_at).toLocaleString()}`,
    );
  }
  console.log(
    `\n${c("dim", "approve with: node vm-service/review-submissions.mjs approve <id>")}`,
  );
}

async function show(id) {
  const res = await query(
    `SELECT * FROM entity_submissions WHERE id = $1`,
    [id],
  );
  if (res.rows.length === 0) {
    console.log(c("red", `no submission with id=${id}`));
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify(res.rows[0], null, 2));
}

async function approve(id) {
  const sub = await query(
    `SELECT id, address, label, type, source, status FROM entity_submissions WHERE id = $1`,
    [id],
  );
  if (sub.rows.length === 0) {
    console.log(c("red", `no submission with id=${id}`));
    process.exitCode = 1;
    return;
  }
  const row = sub.rows[0];
  if (row.status !== "pending") {
    console.log(
      c("yellow", `submission ${id} is already ${row.status}; refusing to re-approve`),
    );
    process.exitCode = 1;
    return;
  }

  // Single transaction so partial failure doesn't leave the
  // submission marked approved while known_entities never updates.
  await query("BEGIN", []);
  try {
    await query(
      `INSERT INTO known_entities (address, label, type, verified, source)
       VALUES ($1, $2, $3, true, COALESCE($4, 'community submission'))
       ON CONFLICT (address) DO UPDATE SET
         label    = EXCLUDED.label,
         type     = EXCLUDED.type,
         verified = EXCLUDED.verified,
         source   = EXCLUDED.source`,
      [row.address, row.label, row.type, row.source],
    );
    await query(
      `UPDATE entity_submissions
       SET status = 'approved', reviewed_at = NOW()
       WHERE id = $1`,
      [id],
    );
    await query("COMMIT", []);
    console.log(
      c("green", `approved #${id}: ${row.address} -> ${row.label} (${row.type})`),
    );
    console.log(
      c("dim", "address will be reclassified on the next page refresh."),
    );
  } catch (err) {
    await query("ROLLBACK", []);
    throw err;
  }
}

async function reject(id, reason) {
  const sub = await query(
    `SELECT status FROM entity_submissions WHERE id = $1`,
    [id],
  );
  if (sub.rows.length === 0) {
    console.log(c("red", `no submission with id=${id}`));
    process.exitCode = 1;
    return;
  }
  if (sub.rows[0].status !== "pending") {
    console.log(
      c("yellow", `submission ${id} is already ${sub.rows[0].status}; refusing to re-reject`),
    );
    process.exitCode = 1;
    return;
  }
  await query(
    `UPDATE entity_submissions
     SET status = 'rejected', reviewed_at = NOW(), reviewer_note = $2
     WHERE id = $1`,
    [id, reason ?? null],
  );
  console.log(c("red", `rejected #${id}${reason ? ` (${reason})` : ""}`));
}

async function main() {
  const [, , cmd, idStr, ...rest] = process.argv;
  if (!cmd || cmd === "-h" || cmd === "--help") {
    usage();
    return;
  }
  const id = idStr ? Number(idStr) : NaN;
  switch (cmd) {
    case "list":
      await list();
      break;
    case "show":
      if (!Number.isFinite(id)) { usage(); process.exitCode = 1; return; }
      await show(id);
      break;
    case "approve":
      if (!Number.isFinite(id)) { usage(); process.exitCode = 1; return; }
      await approve(id);
      break;
    case "reject":
      if (!Number.isFinite(id)) { usage(); process.exitCode = 1; return; }
      await reject(id, rest.join(" ") || null);
      break;
    default:
      console.log(c("red", `unknown command: ${cmd}`));
      usage();
      process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(c("red", `fatal: ${err?.message ?? err}`));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
