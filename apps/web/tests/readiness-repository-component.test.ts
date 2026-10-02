import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const clientPath = new URL(
  "../src/lib/api/repository-analysis-client.ts",
  import.meta.url,
);
const pagePath = new URL(
  "../src/app/(workspace)/assessments/[id]/readiness/page.tsx",
  import.meta.url,
);
const queriesPath = new URL(
  "../src/lib/api/assessment-queries.ts",
  import.meta.url,
);

test("Readiness connection client sends only repositoryUrl", async () => {
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

test("Readiness page is disconnected from the legacy step UI after workflow-run cutover", async () => {
  const source = await readFile(pagePath, "utf8");
  assert.match(source, /import \{ redirect \} from "next\/navigation"/);
  assert.match(source, /encodeURIComponent\(id\)/);
  assert.doesNotMatch(source, /ReadinessStatusPage/);
});

test("successful analysis invalidates and refetches Readiness state", async () => {
  const source = await readFile(queriesPath, "utf8");
  const analysisHook = source.slice(
    source.indexOf("export function useStartRepositoryAnalysisMutation"),
    source.indexOf("export function useRerunRepositoryScanMutation"),
  );
  assert.match(analysisHook, /onSuccess:\s*async/);
  assert.match(
    analysisHook,
    /apiQueryKeys\.assessment\.readiness\(assessmentId\)/,
  );
});
