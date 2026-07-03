import { ImageResponse } from "next/og";
import { ogFrame, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const alt = "Exchange Flows | ALL in ONE TX";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return new ImageResponse(
    ogFrame({
      kicker: "EXCHANGE FLOWS",
      title: "Exchange Flows",
      subtitle: "Track TX moving to and from exchanges, by wallet and by window.",
    }),
    OG_SIZE,
  );
}
