import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@contact/database", "@contact/shared"],
};

export default nextConfig;
