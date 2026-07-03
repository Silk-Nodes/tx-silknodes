import type { Metadata } from "next";

const DESCRIPTION = "Tell us what to build next for ALL in ONE TX.";

export const metadata: Metadata = {
  title: "Submit an Idea | ALL in ONE TX",
  description: DESCRIPTION,
  openGraph: { title: "Submit an Idea", description: DESCRIPTION, url: "https://tx.silknodes.io/feedback" },
  twitter: { card: "summary_large_image", title: "Submit an Idea", description: DESCRIPTION },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
