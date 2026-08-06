import type { NextConfig } from "next";

// Phase 2 of the DB migration: we host Next.js on the VM instead of
// deploying static HTML to GitHub Pages. That unlocks API routes (our
// new /api/* endpoints read from Postgres via Sequelize) and means the
// app is no longer constrained to a /tx-silknodes/ basePath.
//
// During transition the previously-deployed Pages site remains
// accessible (it has its old basePath baked in); the GHA deploy
// workflow is disabled so no new Pages deploys happen. Once DNS cuts
// over to the VM the Pages site can be decommissioned.
//
// images.unoptimized stays because GitHub Pages + static export needed
// it and removing it risks breaking any remaining asset references
// during the cut-over window. Can be cleaned up post-cutover.
const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  // Sequelize does dynamic `require('pg')` / `require('pg-hstore')` at
  // runtime rather than via static imports, which Turbopack and Webpack
  // can't follow — bundling breaks module resolution ("Please install pg
  // package manually"). Listing these as serverExternalPackages tells
  // Next.js to leave them as native Node requires loaded from
  // node_modules at runtime. Only matters for server-side code paths
  // (API routes, server components); no effect on the client bundle.
  serverExternalPackages: ["sequelize", "pg", "pg-hstore"],
  // Phase 1 of the migration shipped under a /tx-silknodes/ basePath
  // (GitHub Pages requirement). Google indexed those URLs and any
  // existing inbound links still point there. Permanent-redirect them
  // to the root so search engines update their index and broken
  // bookmarks just work.
  async redirects() {
    return [
      {
        source: "/tx-silknodes",
        destination: "/",
        permanent: true,
      },
      {
        source: "/tx-silknodes/:path*",
        destination: "/:path*",
        permanent: true,
      },
    ];
  },
  // Local-dev convenience: the flows/analytics API routes read the VM's
  // Postgres, which a laptop can't reach, so those pages show "Could not
  // load" locally. Setting DEV_API_PROXY=https://tx.silknodes.io in
  // .env.local proxies just those read-only, DB-backed endpoints to the
  // live site so the pages render with real data. It never touches the
  // passport's own indexer/LCD routes (those already work locally), and
  // it is inert unless the env var is set, so production is unaffected.
  async rewrites() {
    const base = process.env.DEV_API_PROXY;
    if (!base) return [];
    const root = base.replace(/\/$/, "");
    const paths = [
      "flows",
      "flows-address",
      "flows-recent",
      "flows-history",
      "flows-counterparties",
      "flows-destinations",
      "flows-private-destinations",
      "analytics-data",
      "pse-score",
      "pse-cohort",
      "staking-feed",
      "whale-data",
      "validator-flows",
    ];
    // beforeFiles so the proxy wins over the local (DB-less) API route,
    // which would otherwise handle the request and 500.
    return {
      beforeFiles: [
        ...paths.map((p) => ({
          source: `/api/${p}`,
          destination: `${root}/api/${p}`,
        })),
        // Validator detail is a dynamic route, so it needs its own param
        // rewrite. Without it the stake-flow, history and events sections
        // render empty locally (they read the VM's Postgres) and layout work
        // has to be judged against placeholder-free panels.
        {
          source: "/api/validator/:address",
          destination: `${root}/api/validator/:address`,
        },
      ],
    };
  },
  // Cache policy. Prerendered HTML was served with a 1-year s-maxage and
  // nothing telling browsers to revalidate, so browsers (Safari
  // especially) held the OLD HTML across deploys. That stale HTML
  // references hashed JS/CSS chunks the new build deleted, so they 404
  // and the page renders blank. Fix: HTML must always revalidate
  // ("no-cache" = may cache but must check the ETag first; a 304 keeps
  // it cheap, a changed ETag pulls the new build). The hashed
  // /_next/static/* assets are immutable and keep their long-lived cache
  // (Next.js sets that itself; the source regex excludes them so this
  // doesn't weaken it).
  async headers() {
    return [
      {
        // API routes are excluded here so each one can declare its own
        // caching. A blanket no-cache would fight the response cache and
        // strip the s-maxage the read routes now set for themselves.
        source: "/((?!_next/static|_next/image|api/).*)",
        headers: [
          { key: "Cache-Control", value: "no-cache, must-revalidate" },
        ],
      },
      {
        source: "/:path*",
        headers: [
          // Clickjacking. This is not theoretical for a crypto dashboard:
          // framing tx.silknodes.io inside a page dressed up as a wallet
          // borrows our credibility as the wrapper for a drainer. Both
          // headers are set because frame-ancestors is the modern control
          // and X-Frame-Options is the fallback for older clients.
          { key: "X-Frame-Options", value: "DENY" },
          // Stops the browser second-guessing declared content types, which
          // is how a JSON response gets reinterpreted as HTML and executed.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Do not leak the full URL (which can carry an address someone is
          // inspecting) to third-party sites they click through to.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // We ask for none of these; deny them so an injected script cannot.
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          {
            key: "Content-Security-Policy",
            // Deliberately NOT locking down script-src. Next.js injects inline
            // bootstrap scripts, so 'self' alone would break the app and the
            // correct fix (per-request nonces) needs middleware changes worth
            // doing separately rather than bundled into a hardening pass.
            //
            // What IS locked down here are the directives that carry real risk
            // and cost nothing: framing, plugins, and <base> hijacking. Those
            // close the clickjacking and base-tag injection paths outright.
            value: [
              "frame-ancestors 'none'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
