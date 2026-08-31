import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

const componentPath = new URL(
  "../src/features/settings/components/organisms/repositories-settings-section.tsx",
  import.meta.url,
);
const queriesPath = new URL(
  "../src/lib/api/github-repository-queries.ts",
  import.meta.url,
);
const queryKeysPath = new URL("../src/lib/api/query-keys.ts", import.meta.url);

async function source() {
  return readFile(componentPath, "utf8");
}

test("Settings repository section contains credential-only controls and safe status", async () => {
  const component = await source();
  assert.match(component, /provider-credential/);
  assert.match(component, /type="password"/);
  assert.match(component, /account/);
  assert.doesNotMatch(
    component,
    /glpat-|ghp_|repositoryUrl|connectedRepositories|auth\/repositories/,
  );
});

test("Settings repository section supports both providers and never renders a stored PAT", async () => {
  const component = await source();
  assert.match(component, /GitHub/);
  assert.match(component, /GitLab/);
  assert.match(component, /autoComplete="new-password"/);
  assert.doesNotMatch(component, /Personal access token value/);
});

test("initial configure and rotation refresh the shared provider credential status query", async () => {
  const [queries, queryKeys] = await Promise.all([
    readFile(queriesPath, "utf8"),
    readFile(queryKeysPath, "utf8"),
  ]);

  assert.match(
    queryKeys,
    /providerCredentials:\s*\(\)\s*=>\s*\["provider-credentials"\]\s*as const/,
  );
  assert.equal(
    queries.match(/apiQueryKeys\.githubIntegration\.providerCredentials\(\)/g)
      ?.length,
    2,
  );
  assert.match(
    queries,
    /onSuccess:\s*async\s*\(\)\s*=>\s*{[\s\S]*?invalidateQueries\([\s\S]*?providerCredentials\(\)/,
  );
});

test("successful credential submission clears the plaintext PAT without exposing it", async () => {
  const component = await source();
  assert.match(component, /onSuccess:\s*\(\)\s*=>\s*{\s*setCredential\(""\)/);
  assert.match(component, /type="password"/);
  assert.doesNotMatch(component, /setCredential\([^"e]/);
});

test("reauthentication retries the pending credential update", async () => {
  const component = await source();
  assert.match(component, /onReauthenticate\?\.\(\(\)\s*=>\s*{/);
  assert.match(
    component,
    /queueMicrotask\(\(\)\s*=>\s*{[\s\S]*?mutation\.mutate\(\{\s*provider,\s*credential\s*\}\)/,
  );
});
