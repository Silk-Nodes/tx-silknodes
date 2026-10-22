import { ogFrame, ogImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";
import { testnetRadar } from "@/lib/testnet-radar";

// Drawn from the same scan as /api/testnet-radar, so a shared link's preview
// carries this week's numbers. If the scan fails the card still renders,
// without numbers, rather than breaking the link preview.
export const runtime = "nodejs";
export const revalidate = 3600;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "Testnet radar: what is being built on TX testnet";

const NEON = "#B1FC03";
const TEXT = "#f0ece3";
const MUTED = "rgba(240,236,227,0.62)";

export default async function Image() {
  const r = await testnetRadar().catch(() => null);
  const top = r?.lines.filter((l) => l.new7d > 0).slice(0, 4) ?? [];
  return ogImage(
    ogFrame({
      eyebrow: "Testnet radar",
      title: "What is being built on TX",
      titleSize: 64,
      children: r ? (
        <div style={{ display: "flex", flexDirection: "column", marginTop: 22 }}>
          <div style={{ display: "flex", fontSize: 26, color: MUTED }}>
            {`${r.totals.new7d} new contracts this week, ${r.totals.newWindow} in ${r.windowDays} days`}
          </div>
          {top.map((l) => (
            <div key={l.id} style={{ display: "flex", justifyContent: "space-between", width: 1056, marginTop: 14, fontSize: 28, color: TEXT }}>
              <div style={{ display: "flex", fontWeight: 700 }}>{l.name}</div>
              <div style={{ display: "flex", color: NEON, fontWeight: 700 }}>{`+${l.new7d}`}</div>
            </div>
          ))}
        </div>
      ) : undefined,
    }),
  );
}
