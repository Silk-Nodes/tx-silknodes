import { ImageResponse } from "next/og";

// Branded share card for /passport. Next's file convention wires this up as
// the og:image + twitter:image for the route, so a shared Passport link shows
// a "Wallet Passport" card instead of the generic app card. Satori-only CSS:
// flexbox, inline styles, literal hex, bundled default font.

export const alt = "TX Wallet Passport";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const CHIPS = ["Holdings", "Staking", "PSE earned", "Exchange flows", "Governance", "Tokens"];

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          background: "#0F1B07",
          padding: "72px",
          justifyContent: "space-between",
          fontFamily: "sans-serif",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "60px",
              height: "60px",
              background: "#B1FC03",
              borderRadius: "16px",
              color: "#0F1B07",
              fontSize: "32px",
              fontWeight: 800,
            }}
          >
            tx
          </div>
          <div style={{ display: "flex", color: "#DFEFD3", fontSize: "28px", fontWeight: 700, letterSpacing: "1px" }}>
            ALL in ONE
          </div>
        </div>

        {/* Main */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", color: "#FFFFFF", fontSize: "94px", fontWeight: 800, lineHeight: 1 }}>
            Wallet Passport
          </div>
          <div style={{ display: "flex", color: "#BECCB3", fontSize: "36px", fontWeight: 500, marginTop: "22px" }}>
            Everything about any TX wallet in one place.
          </div>
          <div style={{ display: "flex", gap: "14px", marginTop: "34px", flexWrap: "wrap" }}>
            {CHIPS.map((t) => (
              <div
                key={t}
                style={{
                  display: "flex",
                  padding: "12px 22px",
                  background: "rgba(177,252,3,0.12)",
                  border: "2px solid rgba(177,252,3,0.45)",
                  borderRadius: "999px",
                  color: "#E6FF91",
                  fontSize: "27px",
                }}
              >
                {t}
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", color: "#B1FC03", fontSize: "32px", fontWeight: 700 }}>tx.silknodes.io</div>
          <div style={{ display: "flex", color: "#BECCB3", fontSize: "27px" }}>Built by Silk Nodes</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
