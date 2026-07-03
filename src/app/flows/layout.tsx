import type { Metadata } from "next";

// Per-route metadata + share card for /flows. The page is a client component
// (renders the shared HomePage shell), so title/description live here; the
// og:image comes from the sibling opengraph-image.tsx.
const DESCRIPTION = "Track TX moving to and from exchanges, by wallet and by window.";

export const metadata: Metadata = {
  title: "Exchange Flows | ALL in ONE TX",
  description: DESCRIPTION,
  openGraph: { title: "Exchange Flows", description: DESCRIPTION, url: "https://tx.silknodes.io/flows" },
  twitter: { card: "summary_large_image", title: "Exchange Flows", description: DESCRIPTION },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
