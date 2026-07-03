// Shared Open Graph image toolkit.
//
// Renders 1200x630 social-preview cards with next/og (Satori). Every page's
// opengraph-image.tsx imports ogFrame() for a branded static card; the
// dynamic ones (governance proposals) add live data via `children`.
//
// Satori constraints to remember when editing:
//   - every element with >1 child MUST set display:flex
//   - layout is flexbox only (no grid), inline styles only
//   - colors are literal hex (no CSS variables)
// These match the app's dark theme: neon #B1FC03 on near-black #0a0d07.

import { ImageResponse } from "next/og";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement, ReactNode } from "react";

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

const NEON = "#B1FC03";
const DARK = "#0a0d07";
const TEXT = "#f0ece3";
const MUTED = "rgba(240,236,227,0.58)";
const LINE = "rgba(240,236,227,0.12)";

// The [tx] mark, read once from /public and inlined as a data URI so the
// image is self-contained (no network fetch at render time).
let _logo: string | null = null;
function logoSrc(): string {
  if (_logo === null) {
    try {
      const buf = readFileSync(join(process.cwd(), "public", "tx-icon.png"));
      _logo = `data:image/png;base64,${buf.toString("base64")}`;
    } catch {
      _logo = "";
    }
  }
  return _logo;
}

export function ogFrame(opts: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  children?: ReactNode;
}): ReactElement {
  const { eyebrow, title, subtitle, children } = opts;
  const logo = logoSrc();
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: DARK,
        backgroundImage:
          "radial-gradient(1100px 520px at 10% -12%, rgba(177,252,3,0.18), transparent 60%)",
        padding: "64px 72px",
        color: TEXT,
        fontFamily: "sans-serif",
      }}
    >
      {/* Header: "All in ONE [tx]" (the icon IS the TX) on the left, the
          site URL on the right, aligned on the same baseline. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ display: "flex", fontSize: 32, fontWeight: 700, letterSpacing: -0.5 }}>
            All in ONE
          </div>
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} width={58} height={58} style={{ borderRadius: 14, marginLeft: 16 }} alt="" />
          ) : null}
        </div>
        <div style={{ display: "flex", fontSize: 27, fontWeight: 600, color: NEON }}>tx.silknodes.io</div>
      </div>

      {/* Body */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {eyebrow ? (
          <div
            style={{
              display: "flex",
              fontSize: 25,
              fontWeight: 700,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: NEON,
              marginBottom: 18,
            }}
          >
            {eyebrow}
          </div>
        ) : null}
        <div style={{ display: "flex", fontSize: 78, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2, maxWidth: 1010 }}>
          {title}
        </div>
        {subtitle ? (
          <div style={{ display: "flex", fontSize: 33, color: MUTED, marginTop: 22, maxWidth: 960, lineHeight: 1.32 }}>
            {subtitle}
          </div>
        ) : null}
        {children}
      </div>

      {/* Footer: URL moved to the header (top-right), so the bottom-left is
          intentionally empty; only the Silk Nodes credit sits bottom-right. */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          borderTop: `1px solid ${LINE}`,
          paddingTop: 24,
        }}
      >
        <div style={{ display: "flex", fontSize: 24, color: MUTED }}>Built by Silk Nodes</div>
      </div>
    </div>
  );
}

// Horizontal Yes/No/Abstain/Veto tally bar for the dynamic proposal card.
export function ogTallyBar(t: { yes: number; no: number; abstain: number; veto: number }): ReactElement {
  const total = Math.max(t.yes + t.no + t.abstain + t.veto, 1);
  const segs = [
    { v: t.yes, c: NEON, label: "Yes" },
    { v: t.no, c: "#e0795a", label: "No" },
    { v: t.abstain, c: "rgba(240,236,227,0.35)", label: "Abstain" },
    { v: t.veto, c: "#b5442e", label: "Veto" },
  ].filter((s) => s.v > 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", marginTop: 34 }}>
      <div style={{ display: "flex", width: 1010, height: 26, borderRadius: 999, overflow: "hidden", background: "rgba(240,236,227,0.08)" }}>
        {segs.map((s, i) => (
          <div key={i} style={{ display: "flex", width: `${(s.v / total) * 100}%`, background: s.c }} />
        ))}
      </div>
      <div style={{ display: "flex", marginTop: 14, color: MUTED, fontSize: 26 }}>
        {segs.map((s, i) => (
          <div key={i} style={{ display: "flex", marginRight: 28 }}>
            {s.label} {Math.round((s.v / total) * 100)}%
          </div>
        ))}
      </div>
    </div>
  );
}

export function ogStatusPill(status: string): ReactElement {
  const s = status.toLowerCase();
  const passed = s.includes("pass");
  const rejected = s.includes("reject") || s.includes("fail") || s.includes("veto");
  const color = passed ? NEON : rejected ? "#e0795a" : "#f0ece3";
  const bg = passed ? "rgba(177,252,3,0.16)" : rejected ? "rgba(224,121,90,0.16)" : "rgba(240,236,227,0.12)";
  return (
    <div style={{ display: "flex", alignSelf: "flex-start", marginBottom: 20, fontSize: 24, fontWeight: 800, letterSpacing: 2, textTransform: "uppercase", color, background: bg, padding: "8px 18px", borderRadius: 999 }}>
      {passed ? "Passed" : rejected ? "Rejected" : "Voting"}
    </div>
  );
}

export function ogImage(node: ReactElement): ImageResponse {
  return new ImageResponse(node, OG_SIZE);
}

// ── Data fetch for the dynamic proposal card ──
const HASURA_URL = "https://hasura.mainnet-1.coreum.dev/v1/graphql";
export async function fetchProposalOg(id: number): Promise<{
  title: string;
  status: string;
  yes: number; no: number; abstain: number; veto: number;
} | null> {
  const q = `query Q($id: Int!) {
    proposal_by_pk(id: $id) {
      title status
      proposal_tally_result { yes no abstain no_with_veto }
    }
  }`;
  try {
    const res = await fetch(HASURA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: q, variables: { id } }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = await res.json();
    const p = json?.data?.proposal_by_pk;
    if (!p) return null;
    const t = p.proposal_tally_result ?? {};
    const n = (v: unknown) => Number(v ?? 0) / 1_000_000;
    return {
      title: p.title ?? `Proposal #${id}`,
      status: p.status ?? "",
      yes: n(t.yes), no: n(t.no), abstain: n(t.abstain), veto: n(t.no_with_veto),
    };
  } catch {
    return null;
  }
}
