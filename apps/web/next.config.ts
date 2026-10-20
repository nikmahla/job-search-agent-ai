import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The app lives in a sub-folder of the agent repository; keep tracing local.
  outputFileTracingRoot: __dirname
};

export default nextConfig;
