import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Use polling in dev to avoid "EMFILE: too many open files" on macOS
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        poll: 1000,
        ignored: ["**/node_modules"],
      };
    }
    return config;
  },
};

export default nextConfig;
