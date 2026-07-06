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

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return ROUTES.map(([path, priority, changeFrequency]) => ({
    url: `${BASE}${path}`,
    lastModified: now,
    changeFrequency,
    priority,
  }));
}
