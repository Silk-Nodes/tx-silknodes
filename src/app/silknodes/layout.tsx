import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Silk Nodes",
  description:
    "5% commission, 99.98% uptime, zero slashing. The team behind ALL in ONE TX.",
  openGraph: { title: "Stake with Silk Nodes" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
