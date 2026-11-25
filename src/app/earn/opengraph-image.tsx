import { ogFrame, ogImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const runtime = "nodejs";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "Earn on TX";

export default function Image() {
  return ogImage(
    ogFrame({
      eyebrow: "Earn",
      title: "Stake TX or lock USTX",
      subtitle: "Staking rewards after commission and the USTX vault, read from the chain.",
    }),
  );
}
