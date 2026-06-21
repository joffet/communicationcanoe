import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@communication-canoe/database", "@communication-canoe/shared"],
};

export default nextConfig;
