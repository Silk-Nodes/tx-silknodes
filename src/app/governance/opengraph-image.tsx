import { ImageResponse } from "next/og";
import { ogFrame, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const alt = "Governance, Made Readable | ALL in ONE TX";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return new ImageResponse(
    ogFrame({
      kicker: "GOVERNANCE",
      title: "Governance, Made Readable",
      subtitle: "Plain-English proposals, validator votes, and one-click voting.",
    }),
    OG_SIZE,
  );
}
