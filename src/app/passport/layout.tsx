import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Wallet Passport",
  description:
    "Holdings, staking, PSE, exchange flows, governance, and full on-chain history for any TX wallet.",
  openGraph: { title: "Wallet Passport" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
