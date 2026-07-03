import { ImageResponse } from "next/og";
import { ogFrame, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const alt = "Submit an Idea | ALL in ONE TX";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return new ImageResponse(
    ogFrame({
      kicker: "FEEDBACK",
      title: "Submit an Idea",
      subtitle: "Tell us what to build next for ALL in ONE TX.",
    }),
    OG_SIZE,
  );
}
