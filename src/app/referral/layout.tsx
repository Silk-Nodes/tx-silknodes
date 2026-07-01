import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Refer & Earn",
  description:
    "Share your tx.market referral link and earn 500 TX per verified signup (2x as Elite Club). Includes a QR share card and an earnings calculator.",
  openGraph: { title: "Refer & Earn 500 TX" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
