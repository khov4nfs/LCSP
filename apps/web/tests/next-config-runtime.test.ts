import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import nextConfig from "../next.config.ts";

const configDirectory = dirname(
  fileURLToPath(new URL("../next.config.ts", import.meta.url)),
);

test("Turbopack is pinned to the LCSP monorepo root", () => {
  const expectedRoot = resolve(configDirectory, "../..");

  assert.equal(nextConfig.turbopack?.root, expectedRoot);
  assert.deepEqual(nextConfig.transpilePackages, ["@lcsp/contracts", "@lcsp/i18n"]);
});
