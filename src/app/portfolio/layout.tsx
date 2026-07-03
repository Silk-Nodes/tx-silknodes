import type { Metadata } from "next";

// Per-route metadata + share card for /portfolio. The page is a client component
// (renders the shared HomePage shell), so title/description live here; the
// og:image comes from the sibling opengraph-image.tsx.
const DESCRIPTION = "Your TX holdings, staking, rewards, and PSE in one place.";

export const metadata: Metadata = {
  title: "My Portfolio | ALL in ONE TX",
  description: DESCRIPTION,
  openGraph: { title: "My Portfolio", description: DESCRIPTION, url: "https://tx.silknodes.io/portfolio" },
  twitter: { card: "summary_large_image", title: "My Portfolio", description: DESCRIPTION },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
