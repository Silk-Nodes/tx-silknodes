import type { Metadata } from "next";

// Per-route metadata for /passport. The page itself is a client component
// (it renders the shared HomePage shell), so the title/description live here
// on a server layout. The og:image + twitter:image come from the sibling
// opengraph-image.tsx via Next's file convention, overriding the generic
// app-wide card for shared Passport links.
const DESCRIPTION =
  "Everything about any TX wallet in one place: holdings, staking, PSE earned, exchange flows, governance, tokens and full on-chain history.";

export const metadata: Metadata = {
  title: "Wallet Passport | ALL in ONE TX",
  description: DESCRIPTION,
  openGraph: {
    title: "TX Wallet Passport",
    description: DESCRIPTION,
    url: "https://tx.silknodes.io/passport",
  },
  twitter: {
    card: "summary_large_image",
    title: "TX Wallet Passport",
    description: DESCRIPTION,
  },
};

export default function PassportLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
