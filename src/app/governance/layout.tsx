import type { Metadata } from "next";

// Per-route metadata + share card for /governance. The page is a client component
// (renders the shared HomePage shell), so title/description live here; the
// og:image comes from the sibling opengraph-image.tsx.
const DESCRIPTION = "Plain-English proposals, validator votes, and one-click voting.";

export const metadata: Metadata = {
  title: "Governance, Made Readable | ALL in ONE TX",
  description: DESCRIPTION,
  openGraph: { title: "Governance, Made Readable", description: DESCRIPTION, url: "https://tx.silknodes.io/governance" },
  twitter: { card: "summary_large_image", title: "Governance, Made Readable", description: DESCRIPTION },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
