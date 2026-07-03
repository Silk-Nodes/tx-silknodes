import { ogFrame, ogImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const runtime = "nodejs";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "TX Wallet Passport";

export default function Image() {
  return ogImage(
    ogFrame({
      eyebrow: "Wallet lookup",
      title: "Wallet Passport",
      subtitle: "Holdings, staking, PSE, exchange flows, governance, and full on-chain history for any TX wallet.",
    }),
  );
}
