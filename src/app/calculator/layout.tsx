import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Calculator",
  description:
    "Model your TX staking returns and PSE rewards for any stake size.",
  openGraph: { title: "Estimate your TX rewards" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
