import type { Metadata } from "next";

export async function generateMetadata(
  { params }: { params: Promise<{ address: string }> },
): Promise<Metadata> {
  const { address } = await params;
  const short = `${address.slice(0, 12)}...${address.slice(-6)}`;
  return {
    title: { absolute: `${short} · Wallet Passport · All in ONE TX` },
    description: `Full on-chain profile for TX wallet ${short}: holdings, staking, PSE, exchange flows, governance votes, and activity history.`,
    alternates: { canonical: `/passport/${address}` },
    // Individual wallets shouldn't compete in search results, and indexing
    // one page per address would balloon the index with near-identical
    // pages. The passport landing page carries the SEO for this feature.
    robots: { index: false, follow: true },
  };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
