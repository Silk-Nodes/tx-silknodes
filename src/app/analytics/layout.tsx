import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Analytics",
  description:
    "Staking APR, bonded ratio, active addresses, supply, and price. The live pulse of the TX chain.",
  openGraph: { title: "TX Network Pulse" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
