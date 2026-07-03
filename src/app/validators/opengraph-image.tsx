import { ImageResponse } from "next/og";
import { ogFrame, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const alt = "Validator Explorer | ALL in ONE TX";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return new ImageResponse(
    ogFrame({
      kicker: "VALIDATORS",
      title: "Validator Explorer",
      subtitle: "Compare validators by stake, commission, uptime, and PSE.",
    }),
    OG_SIZE,
  );
}
