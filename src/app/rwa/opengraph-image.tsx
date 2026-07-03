import { ogFrame, ogImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const runtime = "nodejs";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "TX RWA Explorer";

export default function Image() {
  return ogImage(
    ogFrame({
      eyebrow: "RWA Explorer",
      title: "Tokenized assets on TX",
      subtitle: "Explore real-world assets and smart tokens issued on the TX chain.",
    }),
  );
}
