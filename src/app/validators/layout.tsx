import type { Metadata } from "next";

// Per-route metadata + share card for /validators. The page is a client component
// (renders the shared HomePage shell), so title/description live here; the
// og:image comes from the sibling opengraph-image.tsx.
const DESCRIPTION = "Compare validators by stake, commission, uptime, and PSE.";

export const metadata: Metadata = {
  title: "Validator Explorer | ALL in ONE TX",
  description: DESCRIPTION,
  openGraph: { title: "Validator Explorer", description: DESCRIPTION, url: "https://tx.silknodes.io/validators" },
  twitter: { card: "summary_large_image", title: "Validator Explorer", description: DESCRIPTION },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
