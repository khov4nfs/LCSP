import * as assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("Settings repository section contains credential status only", async () => {
  const source = await read(
    "../src/features/settings/components/organisms/repositories-settings-section.tsx",
  );
  assert.equal(source.includes("/auth/repositories"), false);
  assert.equal(source.includes("repositoryUrl"), false);
  assert.equal(source.includes("RepositoryConnection"), false);
  assert.equal(source.includes("providerCredentialStatuses"), true);
});

test("Readiness repository action connects by URL without handling credentials", async () => {
  const source = await read(
    "../src/features/readiness/components/molecules/repository-readiness-action.tsx",
  );
  assert.equal(source.includes("useAuthRepositoriesQuery"), false);
  assert.equal(source.includes("useConnectAssessmentRepositoryMutation"), true);
  assert.equal(source.includes("useStartRepositoryAnalysisMutation"), true);
  assert.equal(source.includes("selectedRepository"), false);
  assert.equal(source.includes("repositoryUrl"), true);
  assert.equal(source.includes('type="password"'), false);
  assert.equal(source.includes("PAT"), false);
  assert.equal(source.includes('register("credential")'), false);
  assert.equal(source.includes("credential:"), false);
});

test("provider credential BFF validates and forwards only provider and credential", async () => {
  const source = await read("../src/app/api/provider-credentials/route.ts");
  assert.equal(source.includes("provider: string"), true);
  assert.equal(source.includes("credential: string"), true);
  assert.equal(source.includes("repositoryUrl"), false);
});

test("readiness client contract contains no credential field", async () => {
  const source = await read("../src/lib/api/repository-analysis-client.ts");
  assert.equal(source.includes("connectAssessmentRepository"), true);
  assert.equal(source.includes("repositoryUrl"), true);
  assert.equal(source.includes("credential:"), false);
  assert.equal(source.includes("personalAccessToken"), false);
});
