import type { Metadata } from "next";

// Per-route metadata + share card for /rwa. The page is a client component
// (renders the shared HomePage shell), so title/description live here; the
// og:image comes from the sibling opengraph-image.tsx.
const DESCRIPTION = "Explore real-world assets tokenized on the TX blockchain.";

export const metadata: Metadata = {
  title: "Tokenized Assets | ALL in ONE TX",
  description: DESCRIPTION,
  openGraph: { title: "Tokenized Assets", description: DESCRIPTION, url: "https://tx.silknodes.io/rwa" },
  twitter: { card: "summary_large_image", title: "Tokenized Assets", description: DESCRIPTION },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
