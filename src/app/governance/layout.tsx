import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Governance",
  description:
    "Proposals with live tallies, validator votes, and delegator overrides, in plain English.",
  openGraph: { title: "TX governance, decoded" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
