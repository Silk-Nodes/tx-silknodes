import { ogFrame, ogImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";
import { liveCoins, liveFragments, liveUstx } from "@/lib/stablecoins";

// Drawn from the same cached reads as /api/stablecoins, so a shared link's
// preview can never show a different number from the page it opens. Rebuilt
// every five minutes: when USTX mints, the chip below flips and every link
// shared after that carries the launch on the card itself.
export const runtime = "nodejs";
export const revalidate = 300;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "Stablecoins on TX: supply, holders, and the USTX launch";

const NEON = "#B1FC03";
const TEXT = "#f0ece3";
const MUTED = "rgba(240,236,227,0.62)";
// Bands of the "who holds the dollar" bar, from the largest wallet outwards.
const BANDS = ["#e0795a", "#f0b49c", "rgba(240,236,227,0.38)", "rgba(240,236,227,0.14)"];

const fmt = (v: number) => Math.round(v).toLocaleString("en-US");

export default async function Image() {
  const [coins, ustx, routes] = await Promise.all([liveCoins(), liveUstx(), liveFragments()]);
  const shown = coins.filter((c) => c.role !== "test" && c.breakdown);
  // Same total as the page's first tile: every USDC route plus SBC. Only the
  // main USDC route is a tracked coin, so summing `shown` fell short by the
  // other 38 routes (66,814 against the page's 69.2K on 2026-09-25).
  const usdcAll = routes.reduce((s, r) => s + r.amount, 0);
  const sbc = coins.find((c) => c.symbol === "SBC")?.supply ?? 0;
  const supply = usdcAll > 0 ? usdcAll + sbc : shown.reduce((s, c) => s + c.supply, 0);
  const live = ustx?.issued === true;

  return ogImage(
    ogFrame({
      eyebrow: "Stablecoins on TX",
      title: "Who holds the dollar",
      titleSize: 64,
      children: (
        <div style={{ display: "flex", flexDirection: "column", marginTop: 18 }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div
              style={{
                display: "flex",
                fontSize: 22,
                fontWeight: 700,
                padding: "6px 16px",
                borderRadius: 999,
                background: live ? NEON : "rgba(240,236,227,0.10)",
                color: live ? "#0a0d07" : TEXT,
              }}
            >
              {live ? "USTX is live" : "USTX: not issued yet"}
            </div>
            {supply > 0 ? (
              <div style={{ display: "flex", fontSize: 23, color: MUTED, marginLeft: 20 }}>
                {`${fmt(supply)} in stablecoins on chain`}
              </div>
            ) : null}
          </div>

          {shown.map((c) => {
            const b = c.breakdown!;
            const parts = [b.top1, b.second, b.next8, b.rest];
            return (
              <div key={c.denom} style={{ display: "flex", flexDirection: "column", marginTop: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 23, width: 1056 }}>
                  <div style={{ display: "flex", fontWeight: 700 }}>{c.symbol}</div>
                  <div style={{ display: "flex", color: MUTED }}>
                    {`largest wallet ${(b.top1 * 100).toFixed(1)}% of ${c.holders?.toLocaleString("en-US") ?? "?"} holders`}
                  </div>
                </div>
                <div style={{ display: "flex", width: 1056, height: 18, borderRadius: 5, overflow: "hidden", marginTop: 7 }}>
                  {parts.map((p, i) =>
                    p > 0 ? <div key={i} style={{ display: "flex", width: `${p * 100}%`, background: BANDS[i] }} /> : null,
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ),
    }),
  );
}
