import { ImageResponse } from "next/og";
import { ogFrame, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const alt = "My Portfolio | ALL in ONE TX";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return new ImageResponse(
    ogFrame({
      kicker: "PORTFOLIO",
      title: "My Portfolio",
      subtitle: "Your TX holdings, staking, rewards, and PSE in one place.",
    }),
    OG_SIZE,
  );
}
