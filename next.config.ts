import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // snowflake-sdk uses native Node modules; load it with plain require on the server.
  serverExternalPackages: ['snowflake-sdk'],
};

export default nextConfig;
