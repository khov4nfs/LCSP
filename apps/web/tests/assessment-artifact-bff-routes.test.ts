import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../src/", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

test("every assessment artifact client path has a BFF route proxying the same upstream path", async () => {
  const client = await read("lib/api/assessment-artifact-client.ts");
  const paths = [
    ...client.matchAll(/`\/api\/assessments\/\$\{encodeURIComponent\(assessmentId\)\}(\/[^`]+)`/g),
  ].map((match) => match[1]);

  assert.deepEqual(paths, [
    "/artifacts",
    "/artifacts/business-context",
    "/artifacts/investigation-notes",
  ]);
  for (const path of paths) {
    const route = await read(`app/api/assessments/[id]${path}/route.ts`);
    assert.match(route, /requireSessionToken\(request\)/);
    assert.ok(
      route.includes(`\`/assessments/\${encodeURIComponent(id)}${path}\``),
      `route for ${path} must proxy the matching upstream path`,
    );
    assert.match(route, /return upstreamJson\(upstream\)/);
  }
});
