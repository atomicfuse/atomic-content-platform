import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@atomic-platform/shared-types"],
  experimental: {
    serverActions: {
      bodySizeLimit: "5mb",
    },
  },
};

export default nextConfig;
