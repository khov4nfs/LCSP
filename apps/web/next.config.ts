import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "flanked-shredding-theatrics.ngrok-free.dev",
    "127.0.0.1",
    "lcsp.fogewise.io.vn",
  ],
  transpilePackages: ["@lcsp/contracts", "@lcsp/i18n"],
};

export default nextConfig;
