import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Calculator",
  description:
    "TX staking rewards after your validator's commission, for any stake size.",
  // The same page as /earn, kept for links already shared.
  alternates: { canonical: "/earn" },
  openGraph: { title: "Estimate your TX rewards" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
