import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Feedback",
  description:
    "Suggest features and vote on what we build next for the TX community.",
  openGraph: { title: "Shape ALL in ONE TX" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
