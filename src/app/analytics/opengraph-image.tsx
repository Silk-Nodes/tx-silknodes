import { ImageResponse } from "next/og";
import { ogFrame, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const alt = "TX Network Pulse | ALL in ONE TX";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return new ImageResponse(
    ogFrame({
      kicker: "NETWORK ANALYTICS",
      title: "TX Network Pulse",
      subtitle: "Staking APR, bonded ratio, active addresses, supply, and price, at a glance.",
    }),
    OG_SIZE,
  );
}
