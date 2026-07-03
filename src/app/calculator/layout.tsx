import type { Metadata } from "next";

// Per-route metadata + share card for /calculator. The page is a client component
// (renders the shared HomePage shell), so title/description live here; the
// og:image comes from the sibling opengraph-image.tsx.
const DESCRIPTION = "Estimate your TX staking rewards and PSE earnings.";

export const metadata: Metadata = {
  title: "Rewards Calculator | ALL in ONE TX",
  description: DESCRIPTION,
  openGraph: { title: "Rewards Calculator", description: DESCRIPTION, url: "https://tx.silknodes.io/calculator" },
  twitter: { card: "summary_large_image", title: "Rewards Calculator", description: DESCRIPTION },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
