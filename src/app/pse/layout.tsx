import type { Metadata } from "next";

// Per-route metadata + share card for /pse. The page is a client component
// (renders the shared HomePage shell), so title/description live here; the
// og:image comes from the sibling opengraph-image.tsx.
const DESCRIPTION = "Check your PSE score, projected rewards, and where you stand in the distribution.";

export const metadata: Metadata = {
  title: "PSE Score & Standing | ALL in ONE TX",
  description: DESCRIPTION,
  openGraph: { title: "PSE Score & Standing", description: DESCRIPTION, url: "https://tx.silknodes.io/pse" },
  twitter: { card: "summary_large_image", title: "PSE Score & Standing", description: DESCRIPTION },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
