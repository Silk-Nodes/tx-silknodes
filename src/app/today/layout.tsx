import type { Metadata } from "next";

// Per-route metadata + share card for /today. The page is a client component
// (renders the shared HomePage shell), so title/description live here; the
// og:image comes from the sibling opengraph-image.tsx.
const DESCRIPTION = "Live on-chain signals, governance, PSE, whales, and news, in one feed.";

export const metadata: Metadata = {
  title: "What's Happening on TX | ALL in ONE TX",
  description: DESCRIPTION,
  openGraph: { title: "What's Happening on TX", description: DESCRIPTION, url: "https://tx.silknodes.io/today" },
  twitter: { card: "summary_large_image", title: "What's Happening on TX", description: DESCRIPTION },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
