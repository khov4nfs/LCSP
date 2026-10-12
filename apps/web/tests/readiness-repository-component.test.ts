import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const clientPath = new URL(
  "../src/lib/api/repository-analysis-client.ts",
  import.meta.url,
);

test("repository connection client sends only repositoryUrl", async () => {
  const source = await readFile(clientPath, "utf8");
  const connect = source.slice(
    source.indexOf("export async function connectAssessmentRepository"),
    source.indexOf("export type StartRepositoryAnalysisResult"),
  );
  assert.match(connect, /body: JSON\.stringify\(\{ repositoryUrl \}\)/);
  assert.doesNotMatch(
    connect,
    /credential|token|providerCredential|authorizationId/,
  );
});
