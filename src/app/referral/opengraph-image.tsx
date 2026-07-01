import { ogFrame, ogImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const runtime = "nodejs";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "Refer & Earn on TX";

export default function Image() {
  return ogImage(
    ogFrame({
      eyebrow: "Refer & Earn",
      title: "Earn 500 TX per signup",
      subtitle: "Share your tx.market link. You and your friend both earn 500 TX after KYC. Elite Club earns 2x.",
    }),
  );
}
