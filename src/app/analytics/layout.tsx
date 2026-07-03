import type { Metadata } from "next";

// Per-route metadata + share card for /analytics. The page is a client component
// (renders the shared HomePage shell), so title/description live here; the
// og:image comes from the sibling opengraph-image.tsx.
const DESCRIPTION = "Staking APR, bonded ratio, active addresses, supply, and price, at a glance.";

export const metadata: Metadata = {
  title: "TX Network Pulse | ALL in ONE TX",
  description: DESCRIPTION,
  openGraph: { title: "TX Network Pulse", description: DESCRIPTION, url: "https://tx.silknodes.io/analytics" },
  twitter: { card: "summary_large_image", title: "TX Network Pulse", description: DESCRIPTION },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
