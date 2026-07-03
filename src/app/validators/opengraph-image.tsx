import { ogFrame, ogImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const runtime = "nodejs";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "TX Validators";

export default function Image() {
  return ogImage(
    ogFrame({
      eyebrow: "Validators",
      title: "Compare every TX validator",
      subtitle: "Commission, voting power, uptime, and rewards, side by side. Pick where to stake.",
    }),
  );
}
