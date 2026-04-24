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
};

export default nextConfig;
