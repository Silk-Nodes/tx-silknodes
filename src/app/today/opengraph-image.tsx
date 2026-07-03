import { ImageResponse } from "next/og";
import { ogFrame, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const alt = "What's Happening on TX | ALL in ONE TX";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return new ImageResponse(
    ogFrame({
      kicker: "TODAY",
      title: "What's Happening on TX",
      subtitle: "Live on-chain signals, governance, PSE, whales, and news, in one feed.",
    }),
    OG_SIZE,
  );
}
