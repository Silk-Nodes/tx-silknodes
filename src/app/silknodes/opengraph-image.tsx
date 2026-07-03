import { ImageResponse } from "next/og";
import { ogFrame, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const alt = "Silk Nodes | ALL in ONE TX";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return new ImageResponse(
    ogFrame({
      kicker: "SILK NODES",
      title: "Silk Nodes",
      subtitle: "Professional validator and infrastructure for the TX network.",
    }),
    OG_SIZE,
  );
}
