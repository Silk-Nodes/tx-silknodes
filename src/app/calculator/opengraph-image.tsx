import { ImageResponse } from "next/og";
import { ogFrame, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const alt = "Rewards Calculator | ALL in ONE TX";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return new ImageResponse(
    ogFrame({
      kicker: "CALCULATOR",
      title: "Rewards Calculator",
      subtitle: "Estimate your TX staking rewards and PSE earnings.",
    }),
    OG_SIZE,
  );
}
