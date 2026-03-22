import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/tx-silknodes",
  assetPrefix: "/tx-silknodes/",
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
