import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: {
    root: process.cwd(),
  },
  images: {
    qualities: [75, 100],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.wikia.nocookie.net",
      },
      {
        protocol: "https",
        hostname: "**.supabase.co",
      },
      {
        protocol: "https",
        hostname: "ddragon.leagueoflegends.com",
      },
    ],
    localPatterns: [
      {
        pathname: "/img/**",
      },
    ],
  },
};

export default nextConfig;
