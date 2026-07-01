import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Today",
  description:
    "The PSE cycle countdown, live on-chain signals, and today's activity across the TX chain.",
  openGraph: { title: "Today on TX" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
