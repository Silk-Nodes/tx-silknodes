import { ogFrame, ogImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const runtime = "nodejs";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "TX Staking calculator";

export default function Image() {
  return ogImage(
    ogFrame({
      eyebrow: "Staking calculator",
      title: "Estimate your TX rewards",
      subtitle: "Staking rewards after your validator's commission, for any stake size.",
    }),
  );
}
