import { ogFrame, ogImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const runtime = "nodejs";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "TX Governance";

export default function Image() {
  return ogImage(
    ogFrame({
      eyebrow: "Governance",
      title: "TX governance, decoded",
      subtitle: "Proposals with live tallies, validator votes, and delegator overrides, in plain English.",
    }),
  );
}
