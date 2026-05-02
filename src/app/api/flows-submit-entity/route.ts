// POST /api/flows-submit-entity
//
// Accepts community submissions for the Top Private Destinations
// audit panel. Body:
//   {
//     address: string,        // required, the core1... address
//     label:   string,        // required, free text (max 80 chars)
//     type:    string,        // required, one of ALLOWED_TYPES
//     source?: string,        // optional, free text (max 240 chars)
//     website?: string,       // honeypot — must be empty or absent
//   }
//
// Submissions land in entity_submissions with status=pending. The
// team reviews them and migrates approved rows into known_entities,
// at which point the destinations classifier reclassifies the
// address on the next page render.
//
// Defences against spam / abuse:
//   honeypot       hidden form field; any value -> reject silently
//   rate limit     max RATE_LIMIT_MAX submissions per IP per hour
//   field caps     bounded label, source, type lengths
//   type allowlist only known classifier types accepted
//   address shape  basic core1... + length sanity check
//
// On success, posts a brief notification to SLACK_SUBMISSIONS_WEBHOOK
// (if set) so the team gets pinged in real time. Webhook failure is
// logged but never fails the request — DB write already succeeded.

import { NextResponse } from "next/server";
import { QueryTypes } from "sequelize";
import { sequelize } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ALLOWED_TYPES = ["cex", "bridge", "ibc", "dex", "contract", "module", "individual"] as const;
type AllowedType = (typeof ALLOWED_TYPES)[number];
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const LABEL_MAX = 80;
const SOURCE_MAX = 240;
const ADDRESS_MIN = 39;
const ADDRESS_MAX = 80;

function isAllowedType(t: unknown): t is AllowedType {
  return typeof t === "string" && (ALLOWED_TYPES as readonly string[]).includes(t);
}

function getClientIp(req: Request): string {
  // Trust the first hop's X-Forwarded-For when present (we sit
  // behind nginx on the VM). Falls back to "unknown" so the column
  // is never null.
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

async function postSlackNotification(payload: {
  address: string;
  label: string;
  type: string;
  source: string | null;
}) {
  const webhook = process.env.SLACK_SUBMISSIONS_WEBHOOK;
  if (!webhook) return;
  try {
    const text =
      `*New entity submission*\n` +
      `Address: \`${payload.address}\`\n` +
      `Label: *${payload.label}*\n` +
      `Type: \`${payload.type}\`\n` +
      (payload.source ? `Source: ${payload.source}\n` : "") +
      `\nReview pending in entity_submissions.`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
  } catch (e) {
    console.warn(
      `[flows-submit-entity] slack notify failed: ${e instanceof Error ? e.message : e}`,
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;

    // Honeypot. Bots fill every visible-looking field; humans never
    // touch the hidden one. Any value here = silent 200 so the bot
    // thinks it succeeded and doesn't retry.
    if (typeof body.website === "string" && body.website.trim().length > 0) {
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    const address = String(body.address ?? "").trim();
    const label = String(body.label ?? "").trim();
    const type = body.type;
    const source =
      typeof body.source === "string" && body.source.trim().length > 0
        ? body.source.trim().slice(0, SOURCE_MAX)
        : null;

    if (
      address.length < ADDRESS_MIN ||
      address.length > ADDRESS_MAX ||
      !address.startsWith("core1")
    ) {
      return NextResponse.json(
        { error: "address must be a core1... bech32 address" },
        { status: 400 },
      );
    }
    if (label.length === 0 || label.length > LABEL_MAX) {
      return NextResponse.json(
        { error: `label is required and must be 1 to ${LABEL_MAX} characters` },
        { status: 400 },
      );
    }
    if (!isAllowedType(type)) {
      return NextResponse.json(
        { error: `type must be one of: ${ALLOWED_TYPES.join(", ")}` },
        { status: 400 },
      );
    }

    const ip = getClientIp(req);

    // Rate limit. Cheap query thanks to idx_entity_submissions_ip_time.
    const recentRows = (await sequelize.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM entity_submissions
       WHERE submitter_ip = :ip
         AND submitted_at > NOW() - INTERVAL '1 hour'`,
      {
        type: QueryTypes.SELECT,
        replacements: { ip },
      },
    )) as unknown as Array<{ count: string }>;
    const recent = Number(recentRows[0]?.count ?? 0);
    if (recent >= RATE_LIMIT_MAX) {
      return NextResponse.json(
        { error: `rate limit: max ${RATE_LIMIT_MAX} submissions per hour` },
        { status: 429 },
      );
    }

    await sequelize.query(
      `INSERT INTO entity_submissions (address, label, type, source, submitter_ip)
       VALUES (:address, :label, :type, :source, :ip)`,
      {
        type: QueryTypes.INSERT,
        replacements: { address, label: label.slice(0, LABEL_MAX), type, source, ip },
      },
    );

    // Fire-and-forget Slack ping. Never blocks the response.
    void postSlackNotification({ address, label, type, source });

    void RATE_LIMIT_WINDOW_MS; // referenced in comments, keeps lint happy
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: message, at: new Date().toISOString() },
      { status: 500 },
    );
  }
}
