import type { Metadata } from "next";

// Ordered pool, not a single host. The hardcoded one refused connections for a
// whole day, which silently degraded every validator title to the address-only
// fallback and every share card with it.
const LCD_HOSTS = [
  "https://full-node.mainnet-1.coreum.dev:1317",
  "https://rest-coreum.ecostake.com",
  "https://coreum-lcd.silknodes.io",
];

// Each validator gets a real, indexable page with its own title and
// description. 56 validators = 56 long-tail pages targeting "<moniker> TX
// validator" searches, which is why the moniker is fetched at request time
// rather than showing a generic title.
export async function generateMetadata(
  { params }: { params: Promise<{ address: string }> },
): Promise<Metadata> {
  const { address } = await params;
  let moniker = "";
  for (const host of LCD_HOSTS) {
    try {
      const res = await fetch(`${host}/cosmos/staking/v1beta1/validators/${address}`, {
        next: { revalidate: 3600 },
      });
      if (res.status === 404) break;      // real answer: no such validator
      if (!res.ok) continue;              // node problem: try the next host
      const json = await res.json();
      moniker = json?.validator?.description?.moniker || "";
      break;
    } catch {
      /* transport error, try the next host */
    }
  }
  const name = moniker || `${address.slice(0, 18)}...`;

  return {
    title: { absolute: `${name} · TX Validator · All in ONE TX` },
    description: `${name} on the TX chain: voting power, commission, uptime, self-bond, delegators, 30-day stake flow, and full governance voting record.`,
    alternates: { canonical: `/validators/${address}` },
    // `images` must be declared here. A nested segment's openGraph REPLACES the
    // parent's rather than merging, so declaring openGraph without images meant
    // the inherited /validators/opengraph-image was dropped and these pages
    // shipped with no og:image at all. The sibling opengraph-image.tsx renders
    // the validator's own numbers.
    openGraph: {
      title: `${name} · TX Validator`,
      description: `Voting power, commission, uptime, delegators, stake flow, and governance record for ${name}.`,
      images: [{ url: `/validators/${address}/opengraph-image`, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${name} · TX Validator`,
      description: `Voting power, commission, uptime, delegators, stake flow, and governance record for ${name}.`,
      images: [`/validators/${address}/opengraph-image`],
    },
  };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
