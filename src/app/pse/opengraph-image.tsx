import { ImageResponse } from "next/og";
import { ogFrame, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const alt = "PSE Score & Standing | ALL in ONE TX";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return new ImageResponse(
    ogFrame({
      kicker: "PSE",
      title: "PSE Score & Standing",
      subtitle: "Check your PSE score, projected rewards, and where you stand in the distribution.",
    }),
    OG_SIZE,
  );
}
