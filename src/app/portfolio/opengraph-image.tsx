// Social card for /portfolio.
//
// This route was the only tab without one. It still declared
// twitter:card=summary_large_image, so a shared link promised a large image
// and supplied none, which renders as an empty card rather than degrading to
// a plain link. Every other tab already had a generator; this uses the same
// shared frame so the whole site's cards stay one family.

import { ogFrame, ogImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const runtime = "nodejs";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "Your TX portfolio";

export default function Image() {
  return ogImage(
    ogFrame({
      eyebrow: "Your position",
      title: "Portfolio",
      // States what the page does for anyone, not what one wallet holds. The
      // read-only half is the part worth leading with: it works for cold and
      // hardware wallets, which is why it needs no connection.
      subtitle:
        "Track any number of TX wallets as one position. Combined totals, validator exposure with rank and voting power, and every PSE distribution you were paid. No connection needed to read.",
    }),
  );
}
