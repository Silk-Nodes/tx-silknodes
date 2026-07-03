import type { ReactElement } from "react";

// Shared Open Graph share-card frame for every page, so all links preview in
// one consistent house style: "All in ONE [tx]" top-left, "tx.silknodes.io"
// top-right, a neon kicker + big title + muted subtitle on the left, a
// divider, and "Built by Silk Nodes" bottom-right, on a near-black card with
// a green glow in the top-left corner. Satori-only CSS: flexbox, inline
// styles, literal hex, bundled default font.

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

export function ogFrame({
  kicker,
  title,
  subtitle,
}: {
  kicker: string;
  title: string;
  subtitle: string;
}): ReactElement {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: "radial-gradient(circle at 8% 4%, #1b3a0c 0%, #0D0D0C 44%)",
        padding: "56px 64px",
        fontFamily: "sans-serif",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <div style={{ display: "flex", color: "#F5F5F0", fontSize: "30px", fontWeight: 700 }}>All in ONE</div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "52px",
              height: "52px",
              background: "#B1FC03",
              borderRadius: "13px",
              color: "#0D0D0C",
              fontSize: "27px",
              fontWeight: 800,
            }}
          >
            tx
          </div>
        </div>
        <div style={{ display: "flex", color: "#B1FC03", fontSize: "28px", fontWeight: 700 }}>tx.silknodes.io</div>
      </div>

      {/* Main */}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>
        <div style={{ display: "flex", color: "#B1FC03", fontSize: "29px", fontWeight: 700, letterSpacing: "6px" }}>
          {kicker}
        </div>
        <div
          style={{
            display: "flex",
            color: "#F5F5F0",
            fontSize: "82px",
            fontWeight: 800,
            marginTop: "24px",
            letterSpacing: "-1px",
            lineHeight: 1.05,
            maxWidth: "1010px",
          }}
        >
          {title}
        </div>
        <div
          style={{
            display: "flex",
            color: "#8B8B84",
            fontSize: "35px",
            fontWeight: 500,
            marginTop: "26px",
            maxWidth: "1010px",
            lineHeight: 1.3,
          }}
        >
          {subtitle}
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          borderTop: "1px solid rgba(255,255,255,0.10)",
          paddingTop: "28px",
        }}
      >
        <div style={{ display: "flex", color: "#8B8B84", fontSize: "28px", fontWeight: 600 }}>Built by Silk Nodes</div>
      </div>
    </div>
  );
}
