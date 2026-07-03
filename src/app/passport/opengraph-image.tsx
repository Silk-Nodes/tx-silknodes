import { ImageResponse } from "next/og";

// Branded share card for /passport, styled to match the app-wide og-image.png
// (centered, glowing [tx] mark, neon dotted subtitle, outlined pill chips,
// Silk Nodes footer on a green-glow background) so shared Passport links look
// like part of the same family. Satori-only CSS: flexbox, inline styles,
// literal hex, bundled default font.

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
          background: "radial-gradient(circle at 50% 32%, #17330b 0%, #0F1B07 52%, #091204 100%)",
          fontFamily: "sans-serif",
          position: "relative",
        }}
      >
        {/* Centered hero block */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            flex: 1,
            padding: "0 80px",
          }}
        >
          {/* [tx] mark with neon glow */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "104px",
              height: "104px",
              background: "#B1FC03",
              borderRadius: "24px",
              color: "#0D0D0C",
              fontSize: "56px",
              fontWeight: 800,
              boxShadow: "0 0 90px 12px rgba(177,252,3,0.35)",
            }}
          >
            tx
          </div>

          {/* Title */}
          <div
            style={{
              display: "flex",
              color: "#FFFFFF",
              fontSize: "84px",
              fontWeight: 800,
              marginTop: "36px",
              letterSpacing: "-1px",
            }}
          >
            Wallet Passport
          </div>

          {/* Neon dotted subtitle, mirrors "STAKE · PSE · EXPLORE · TRACK" */}
          <div
            style={{
              display: "flex",
              color: "#B1FC03",
              fontSize: "34px",
              fontWeight: 700,
              letterSpacing: "3px",
              marginTop: "18px",
            }}
          >
            ONE WALLET · EVERYTHING ON-CHAIN
          </div>

          {/* Outlined feature chips */}
          <div style={{ display: "flex", gap: "16px", marginTop: "40px", flexWrap: "wrap", justifyContent: "center" }}>
            {CHIPS.map((t) => (
              <div
                key={t}
                style={{
                  display: "flex",
                  padding: "13px 26px",
                  background: "rgba(177,252,3,0.04)",
                  border: "2px solid rgba(177,252,3,0.30)",
                  borderRadius: "999px",
                  color: "#DFEFD3",
                  fontSize: "27px",
                }}
              >
                {t}
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "0 72px 52px",
          }}
        >
          <div style={{ display: "flex", color: "#BECCB3", fontSize: "28px", fontWeight: 600 }}>Built by Silk Nodes</div>
          <div style={{ display: "flex", color: "#B1FC03", fontSize: "30px", fontWeight: 700 }}>tx.silknodes.io</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
