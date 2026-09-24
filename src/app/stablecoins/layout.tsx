import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Stablecoins on TX",
  description:
    "Every stablecoin on the TX chain, read live: supply, holders, how concentrated each one is, and the launch status of USTX.",
  openGraph: { title: "Stablecoins on TX" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
