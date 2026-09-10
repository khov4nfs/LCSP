import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const webRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(webRoot, "../..");

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "flanked-shredding-theatrics.ngrok-free.dev",
    "127.0.0.1",
    "lcsp.fogewise.io.vn",
  ],
  transpilePackages: ["@lcsp/contracts", "@lcsp/i18n"],
  // Next 16 uses Turbopack by default. Pin the filesystem boundary to the
  // monorepo root so workspace packages outside apps/web remain resolvable
  // during Fast Refresh and incremental rebuilds.
  turbopack: {
    root: repoRoot,
  },
};

export default nextConfig;
