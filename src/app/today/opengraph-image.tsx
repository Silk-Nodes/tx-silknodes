import { ogFrame, ogImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const runtime = "nodejs";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "Today on TX";

export default function Image() {
  return ogImage(
    ogFrame({
      eyebrow: "TX Network today",
      title: "Today on TX",
      subtitle: "The PSE cycle countdown, live on-chain signals, and everything happening across the chain today.",
    }),
  );
}
