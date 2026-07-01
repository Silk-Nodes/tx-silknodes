import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Validators",
  description:
    "Commission, voting power, uptime, and rewards, side by side. Find where to stake.",
  openGraph: { title: "Compare every TX validator" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
