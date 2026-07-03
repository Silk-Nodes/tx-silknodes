import { ogFrame, ogImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const runtime = "nodejs";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "TX Network analytics";

export default function Image() {
  return ogImage(
    ogFrame({
      eyebrow: "Network analytics",
      title: "TX Network Pulse",
      subtitle: "Staking APR, bonded ratio, active addresses, supply, and price, at a glance.",
    }),
  );
}
