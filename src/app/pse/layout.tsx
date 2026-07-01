import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "PSE",
  description:
    "Look up any wallet's PSE score and estimate its monthly and annual rewards.",
  openGraph: { title: "Check your PSE score" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
