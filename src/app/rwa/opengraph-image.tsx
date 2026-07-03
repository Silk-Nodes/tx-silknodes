import { ImageResponse } from "next/og";
import { ogFrame, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const alt = "Tokenized Assets | ALL in ONE TX";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return new ImageResponse(
    ogFrame({
      kicker: "RWA",
      title: "Tokenized Assets",
      subtitle: "Explore real-world assets tokenized on the TX blockchain.",
    }),
    OG_SIZE,
  );
}
