import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // libSQL ships native bindings; keep it out of the server bundle.
  serverExternalPackages: ["@libsql/client", "libsql"],
  // Admin PDF uploads go through a server action (Vercel's request limit is 4.5 MB).
  experimental: { serverActions: { bodySizeLimit: "4.5mb" } },
  async redirects() {
    return [
      { source: "/about", destination: "/methodology", permanent: true },
      { source: "/insights", destination: "/news", permanent: true },
      { source: "/insights/:slug", destination: "/news/:slug", permanent: true },
    ];
  },
};

export default nextConfig;
