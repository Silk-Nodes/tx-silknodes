import type { Metadata } from "next";

const LCD = "https://full-node.mainnet-1.coreum.dev:1317";

// Each validator gets a real, indexable page with its own title and
// description. 56 validators = 56 long-tail pages targeting "<moniker> TX
// validator" searches, which is why the moniker is fetched at request time
// rather than showing a generic title.
export async function generateMetadata(
  { params }: { params: Promise<{ address: string }> },
): Promise<Metadata> {
  const { address } = await params;
  let moniker = "";
  try {
    const res = await fetch(`${LCD}/cosmos/staking/v1beta1/validators/${address}`, {
      next: { revalidate: 3600 },
    });
    if (res.ok) {
      const json = await res.json();
      moniker = json?.validator?.description?.moniker || "";
    }
  } catch {
    /* fall through to the address-only title */
  }
  const name = moniker || `${address.slice(0, 18)}...`;

  return {
    title: { absolute: `${name} · TX Validator · All in ONE TX` },
    description: `${name} on the TX chain: voting power, commission, uptime, self-bond, delegators, 30-day stake flow, and full governance voting record.`,
    alternates: { canonical: `/validators/${address}` },
    openGraph: {
      title: `${name} · TX Validator`,
      description: `Voting power, commission, uptime, delegators, stake flow, and governance record for ${name}.`,
    },
  };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
