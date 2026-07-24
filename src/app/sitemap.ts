import type { MetadataRoute } from "next";

// Complete sitemap for every crawlable route. Previously a static
// public/sitemap.xml listed only the homepage, so search engines never
// discovered the other pages via the sitemap. Generated here so new routes
// stay in one place. lastModified uses build time.
const BASE = "https://tx.silknodes.io";

// [path, priority, changeFrequency]
const ROUTES: [string, number, MetadataRoute.Sitemap[number]["changeFrequency"]][] = [
  ["/", 1.0, "daily"],
  ["/today", 0.9, "hourly"],
  ["/pse", 0.9, "daily"],
  ["/governance", 0.9, "daily"],
  ["/analytics", 0.8, "daily"],
  ["/flows", 0.8, "hourly"],
  ["/passport", 0.8, "weekly"],
  ["/validators", 0.8, "daily"],
  ["/calculator", 0.7, "monthly"],
  ["/rwa", 0.6, "weekly"],
  ["/portfolio", 0.6, "weekly"],
  ["/silknodes", 0.6, "monthly"],
  ["/feedback", 0.5, "weekly"],
];

const LCD = "https://full-node.mainnet-1.coreum.dev:1317";

// One sitemap entry per validator. These are real indexable pages targeting
// "<moniker> TX validator" long-tail searches, so they belong in the
// sitemap rather than relying on Google finding them by crawling the table.
// Chain lookup failure degrades to the static routes only: a short sitemap
// is recoverable, a build failure is not.
async function validatorRoutes(now: Date): Promise<MetadataRoute.Sitemap> {
  try {
    const res = await fetch(
      `${LCD}/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=300`,
      { next: { revalidate: 86400 } },
    );
    if (!res.ok) return [];
    const json = await res.json();
    return (json.validators || []).map((v: { operator_address: string }) => ({
      url: `${BASE}/validators/${v.operator_address}`,
      lastModified: now,
      changeFrequency: "daily" as const,
      priority: 0.6,
    }));
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const staticRoutes = ROUTES.map(([path, priority, changeFrequency]) => ({
    url: `${BASE}${path}`,
    lastModified: now,
    changeFrequency,
    priority,
  }));
  return [...staticRoutes, ...(await validatorRoutes(now))];
}
