import type { Metadata } from "next";

const DESCRIPTION = "Professional validator and infrastructure for the TX network.";

export const metadata: Metadata = {
  title: "Silk Nodes | ALL in ONE TX",
  description: DESCRIPTION,
  openGraph: { title: "Silk Nodes", description: DESCRIPTION, url: "https://tx.silknodes.io/silknodes" },
  twitter: { card: "summary_large_image", title: "Silk Nodes", description: DESCRIPTION },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
