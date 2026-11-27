import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const authPagePaths = [
  "src/app/(auth)/sign-in/page.tsx",
  "src/app/(auth)/sign-up/page.tsx",
  "src/app/(auth)/mfa/verify/page.tsx",
  "src/app/(auth)/mfa/enroll/page.tsx",
  "src/app/(auth)/recovery/request/page.tsx",
  "src/app/(auth)/recovery/confirm/page.tsx",
];

// Keep page metadata request-local so concurrent requests with different locale cookies cannot share a module-level language snapshot.
test("auth page metadata resolves locale from the current request", () => {
  for (const relativePath of authPagePaths) {
    const source = readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
    assert.match(source, /export\s+async\s+function\s+generateMetadata\s*\(/, `${relativePath} should resolve request metadata asynchronously`);
    assert.doesNotMatch(source, /import\s*\{\s*appLocale\s*\}\s*from\s*["']@\/lib\/locale["']/, `${relativePath} must not snapshot the client locale store at module load`);
  }
});
