import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  async rewrites() {
    return [
      {
        source: "/api/lcd/:path*",
        destination: "https://full-node.mainnet-1.coreum.dev:1317/:path*",
      },
      {
        source: "/api/rpc/:path*",
        destination: "https://full-node.mainnet-1.coreum.dev:26657/:path*",
      },
    ];
  },
};

export default nextConfig;
