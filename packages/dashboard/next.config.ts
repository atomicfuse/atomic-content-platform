import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@atomic-platform/shared-types"],
};

export default nextConfig;
