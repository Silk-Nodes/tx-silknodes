import { ogFrame, ogImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const runtime = "nodejs";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "Silk Nodes";

export default function Image() {
  return ogImage(
    ogFrame({
      eyebrow: "Silk Nodes",
      title: "Stake with Silk Nodes",
      subtitle: "5% commission, 99.98% uptime, zero slashing. The team behind ALL in ONE TX.",
    }),
  );
}
