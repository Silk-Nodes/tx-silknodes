import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Flows",
  description:
    "Live exchange inflows and outflows, net flow, and per-wallet flow history on the TX chain.",
  openGraph: { title: "Follow the money" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
