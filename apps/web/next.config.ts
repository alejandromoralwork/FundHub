import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Shared workspace packages ship TypeScript source.
  transpilePackages: ["@fundhub/core", "@fundhub/db", "@fundhub/email"],
  serverExternalPackages: ["pg"],
  // Multi-zones: the internal admin platform is a separate app mounted at /admin.
  async rewrites() {
    const admin = process.env.ADMIN_ORIGIN ?? (process.env.NODE_ENV === "development" ? "http://localhost:3001" : null);
    if (!admin) return [];
    return [
      { source: "/admin", destination: `${admin}/admin` },
      { source: "/admin/:path*", destination: `${admin}/admin/:path*` },
    ];
  },
  async redirects() {
    return [
      { source: "/about", destination: "/methodology", permanent: true },
      { source: "/insights", destination: "/news", permanent: true },
      { source: "/insights/:slug", destination: "/news/:slug", permanent: true },
    ];
  },
};

export default nextConfig;
