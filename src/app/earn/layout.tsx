import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Earn",
  description:
    "Staking rewards after your validator's commission, and the USTX vault's terms and live state, read from the chain.",
  alternates: { canonical: "/earn" },
  openGraph: { title: "Earn on TX", url: "/earn" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
