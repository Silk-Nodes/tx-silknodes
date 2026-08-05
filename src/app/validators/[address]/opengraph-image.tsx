import { ogFrame, ogImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

// Per-validator share card. Without this the detail pages had NO og:image at
// all: the layout declares an `openGraph` block, and a nested segment's
// openGraph replaces the parent's rather than merging into it, so the
// inherited /validators/opengraph-image was dropped. Sharing a validator link
// produced a text-only card.
//
// Rendering the validator's own numbers also gives operators a reason to share
// their page: the card is about them, not about us.
export const runtime = "nodejs";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "TX Validator";

// Ordered pool, same reasoning as the API routes: the previously hardcoded
// host was refusing connections for a whole day, which would have silently
// degraded every card to the address-only fallback.
const LCD_HOSTS = [
  "https://full-node.mainnet-1.coreum.dev:1317",
  "https://rest-coreum.ecostake.com",
  "https://coreum-lcd.silknodes.io",
];

const NEON = "#B1FC03";
const TEXT = "#f0ece3";
const MUTED = "rgba(240,236,227,0.62)";
const LINE = "rgba(240,236,227,0.14)";

async function lcd<T>(path: string): Promise<T | null> {
  for (const host of LCD_HOSTS) {
    try {
      const res = await fetch(`${host}${path}`, { next: { revalidate: 3600 } });
      if (res.status === 404) return null;
      if (!res.ok) continue;
      return (await res.json()) as T;
    } catch {
      /* next host */
    }
  }
  return null;
}

const fmt = (n: number) =>
  Math.abs(n) >= 1e9 ? `${(n / 1e9).toFixed(2)}B`
  : Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M`
  : Math.abs(n) >= 1e3 ? `${(n / 1e3).toFixed(0)}K`
  : n.toFixed(0);

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", marginRight: 64 }}>
      <div style={{ display: "flex", fontSize: 22, letterSpacing: 2, textTransform: "uppercase", color: MUTED }}>
        {label}
      </div>
      <div style={{ display: "flex", fontSize: 52, fontWeight: 800, letterSpacing: -1, marginTop: 8, color: accent ? NEON : TEXT }}>
        {value}
      </div>
    </div>
  );
}

export default async function Image({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;

  const [vRes, poolRes, setRes] = await Promise.all([
    lcd<{ validator: Record<string, any> }>(`/cosmos/staking/v1beta1/validators/${address}`),
    lcd<{ pool: { bonded_tokens: string } }>(`/cosmos/staking/v1beta1/pool`),
    lcd<{ validators: Record<string, any>[] }>(
      `/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=300`,
    ),
  ]);

  const v = vRes?.validator;
  // Chain unreachable or unknown address: fall back to the generic card rather
  // than shipping a broken one.
  if (!v) {
    return ogImage(
      ogFrame({
        eyebrow: "TX Validator",
        title: "Every TX validator, one page each",
        subtitle: "Commission, uptime, delegators, stake flow and governance record.",
      }),
    );
  }

  // Monikers are free text and some are sentences ("[Shutting down] cosmostation
  // please redelegate"). At the frame's 78px title size roughly 21 characters
  // fit per line, and a third line pushed the stats and the footer clean off
  // the card. Clamp to two lines' worth.
  const MAX_TITLE = 40;
  const raw: string = v.description?.moniker || `${address.slice(0, 16)}...`;
  const moniker = raw.length > MAX_TITLE ? `${raw.slice(0, MAX_TITLE - 1).trimEnd()}…` : raw;
  const tokens = Number(v.tokens || 0) / 1e6;
  const bonded = Number(poolRes?.pool?.bonded_tokens || 0) / 1e6;
  const commission = Number(v.commission?.commission_rates?.rate || 0) * 100;

  const set = (setRes?.validators || [])
    .slice()
    .sort((a, b) => Number(b.tokens) - Number(a.tokens));
  const rank = set.findIndex((x) => x.operator_address === address);
  const rankText = rank >= 0 ? `#${rank + 1} of ${set.length}` : "";

  const jailed = Boolean(v.jailed);
  const powerPct = bonded > 0 ? (tokens / bonded) * 100 : 0;

  return ogImage(
    ogFrame({
      eyebrow: rankText ? `TX VALIDATOR · RANK ${rankText}` : "TX VALIDATOR",
      title: moniker,
      children: (
        <div style={{ display: "flex", flexDirection: "column", marginTop: 30 }}>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <Stat label="Voting power" value={`${fmt(tokens)} TX`} accent />
            <Stat label="Share of bonded" value={`${powerPct.toFixed(2)}%`} />
            <Stat label="Commission" value={`${commission.toFixed(1)}%`} />
            <Stat label="Status" value={jailed ? "Jailed" : "Active"} accent={!jailed} />
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 30,
              paddingTop: 20,
              borderTop: `1px solid ${LINE}`,
              fontSize: 26,
              color: MUTED,
            }}
          >
            Delegators, stake flow, governance record and daily history
          </div>
        </div>
      ),
    }),
  );
}
