import { ogFrame, ogImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const runtime = "nodejs";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "TX PSE score";

export default function Image() {
  return ogImage(
    ogFrame({
      eyebrow: "Proof of Support Emission",
      title: "Check your PSE score",
      subtitle: "Look up any wallet's PSE standing and estimate its monthly and annual rewards.",
    }),
  );
}
