import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["better-sqlite3", "sharp", "heic-decode", "archiver"],
  outputFileTracingIncludes: {
    "/api/totes/*/photos": ["./node_modules/heic-decode/**/*", "./node_modules/libheif-js/**/*"],
  },
  experimental: { cpus: 2 },
};
export default nextConfig;
