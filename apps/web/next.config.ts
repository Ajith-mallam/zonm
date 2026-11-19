import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server-only libraries loaded from node_modules at runtime instead of being
  // bundled (BullMQ has optional backends that webpack cannot resolve).
  serverExternalPackages: ["bullmq", "ioredis", "apify-client"],
};

export default nextConfig;
