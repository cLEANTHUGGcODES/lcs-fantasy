import type { NextConfig } from "next";

const configuredDistDir = process.env.NEXT_DIST_DIR?.trim();
const defaultDistDir =
  process.platform === "win32" && process.env.NODE_ENV !== "production"
    ? ".next-win-dev"
    : ".next";

const nextConfig: NextConfig = {
<<<<<<< Updated upstream
  distDir: process.env.NEXT_DIST_DIR || ".next",
  allowedDevOrigins: ["127.0.0.1"],
=======
  distDir:
    configuredDistDir && configuredDistDir.length > 0 ? configuredDistDir : defaultDistDir,
>>>>>>> Stashed changes
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
