import { ogFrame, ogImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const runtime = "nodejs";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "ALL in ONE TX";

export default function Image() {
  return ogImage(
    ogFrame({
      eyebrow: "TX network",
      title: "The TX community dashboard",
      subtitle: "Stake, track PSE, explore validators, follow exchange flows, and read governance. All in one place.",
    }),
  );
}
