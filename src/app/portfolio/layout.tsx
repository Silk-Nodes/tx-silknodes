import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Portfolio",
  description:
    "Your TX delegations, rewards, and positions in one place.",
  openGraph: { title: "Your TX portfolio" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
