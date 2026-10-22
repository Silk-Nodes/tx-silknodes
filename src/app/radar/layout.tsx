import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Testnet radar",
  description:
    "What is being deployed on TX testnet, by product line: tokenized securities, repo, pools, oracles, liquid staking. Scanned from the chain every hour.",
  openGraph: { title: "Testnet radar" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
