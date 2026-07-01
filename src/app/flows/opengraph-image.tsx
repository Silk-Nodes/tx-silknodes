import { ogFrame, ogImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const runtime = "nodejs";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "TX Exchange flows";

export default function Image() {
  return ogImage(
    ogFrame({
      eyebrow: "Exchange flows",
      title: "Follow the money",
      subtitle: "Live exchange inflows and outflows, net flow, and per-wallet flow history on TX.",
    }),
  );
}
