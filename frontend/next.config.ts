import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/Node-only packages used by the API route handlers; they must be
  // required by Node at runtime rather than bundled.
  serverExternalPackages: ["better-sqlite3", "@actual-app/api"],
};

export default nextConfig;
