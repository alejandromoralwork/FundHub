import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Mounted at fundhub.lu/admin through the website's multi-zone rewrite.
  basePath: "/admin",
  transpilePackages: ["@fundhub/core", "@fundhub/db", "@fundhub/email"],
  serverExternalPackages: ["pg"],
  // PDF report uploads go through a server action (Vercel's request limit is 4.5 MB).
  experimental: { serverActions: { bodySizeLimit: "4.5mb" } },
  // Internal tool: never indexed, never framed.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
