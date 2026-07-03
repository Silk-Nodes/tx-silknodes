import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "RWA Explorer",
  description:
    "Explore real-world assets and smart tokens issued on the TX chain.",
  openGraph: { title: "Tokenized assets on TX" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
