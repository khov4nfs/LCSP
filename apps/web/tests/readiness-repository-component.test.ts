import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { runRepositoryReadinessAnalysis } from "../src/features/readiness/utils/repository-readiness-analysis.ts";
import { repositoryConnectionSchema } from "../src/features/readiness/schemas/repository-connection.schema.ts";

const componentPath = new URL(
  "../src/features/readiness/components/molecules/repository-readiness-action.tsx",
  import.meta.url,
);
const clientPath = new URL(
  "../src/lib/api/repository-analysis-client.ts",
  import.meta.url,
);
const pagePath = new URL(
  "../src/features/readiness/components/organisms/readiness-status-page.tsx",
  import.meta.url,
);
const queriesPath = new URL(
  "../src/lib/api/assessment-queries.ts",
  import.meta.url,
);

test("repository URL schema accepts GitHub and GitLab URLs and rejects invalid input", () => {
  assert.equal(
    repositoryConnectionSchema.safeParse({
      repositoryUrl: "https://github.com/acme/repository",
    }).success,
    true,
  );
  assert.equal(
    repositoryConnectionSchema.safeParse({
      repositoryUrl: "https://gitlab.com/acme/repository",
    }).success,
    true,
  );
  assert.equal(
    repositoryConnectionSchema.safeParse({ repositoryUrl: "not-a-url" })
      .success,
    false,
  );
});

test("Readiness repository component renders a URL form without repository or credential selectors", async () => {
  const source = await readFile(componentPath, "utf8");
  assert.match(source, /id="readiness-repository-url"/);
  assert.match(source, /useConnectAssessmentRepositoryMutation/);
  assert.match(source, /useStartRepositoryAnalysisMutation/);
  assert.doesNotMatch(source, /useAuthRepositoriesQuery|<Select/);
  assert.doesNotMatch(
    source,
    /type=\"password\"|PAT|GITLAB_TOKEN|GH_TOKEN|personalAccessToken/,
  );
});

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

test("Readiness keeps provider detection out of the URL form", async () => {
  const source = await readFile(componentPath, "utf8");
  assert.doesNotMatch(source, /parseGitHub|parseGitLab|CREDENTIAL_PROVIDERS/);
});

const connection = {
  connectionId: "connection-1",
  provider: "GITHUB",
  repositoryId: "repository-1",
  repositoryFullName: "acme/repository",
  defaultBranch: "main",
  status: "ACTIVE",
};

const analysisResult = {
  snapshotId: "snapshot-1",
  commitSha: "abc123",
  scanJobId: "scan-1",
  scanStatus: "QUEUED",
};

for (const repositoryUrl of [
  "https://github.com/acme/repository",
  "https://gitlab.com/acme/repository",
]) {
  test(`URL-first flow connects ${repositoryUrl} and starts analysis`, async () => {
    const connectedUrls: string[] = [];
    const analysisInputs: unknown[] = [];
    const result = await runRepositoryReadinessAnalysis(
      { connection: null, repositoryUrl },
      {
        connect: (url) => {
          connectedUrls.push(url);
          return Promise.resolve(connection);
        },
        analyze: (input) => {
          analysisInputs.push(input);
          return Promise.resolve(analysisResult);
        },
      },
    );

    assert.deepEqual(connectedUrls, [repositoryUrl]);
    assert.deepEqual(analysisInputs, [
      { connectionId: "connection-1", branch: "main" },
    ]);
    assert.deepEqual(result, analysisResult);
  });
}

test("connect failure does not start repository analysis", async () => {
  let analysisCalls = 0;
  await assert.rejects(
    runRepositoryReadinessAnalysis(
      {
        connection: null,
        repositoryUrl: "https://github.com/acme/repository",
      },
      {
        connect: () =>
          Promise.reject(new Error("PROVIDER_CREDENTIAL_REQUIRED")),
        analyze: () => {
          analysisCalls += 1;
          return Promise.resolve(analysisResult);
        },
      },
    ),
    /PROVIDER_CREDENTIAL_REQUIRED/,
  );
  assert.equal(analysisCalls, 0);
});

test("analysis failure retains the newly connected repository for retry", async () => {
  let retainedConnection = null;
  await assert.rejects(
    runRepositoryReadinessAnalysis(
      {
        connection: null,
        repositoryUrl: "https://github.com/acme/repository",
      },
      {
        connect: () => Promise.resolve(connection),
        onConnected: (connected) => {
          retainedConnection = connected;
        },
        analyze: () => Promise.reject(new Error("snapshot-failed")),
      },
    ),
    /snapshot-failed/,
  );
  assert.deepEqual(retainedConnection, connection);
});

test("existing connection resumes analysis without reconnecting", async () => {
  let connectCalls = 0;
  const analysisInputs: unknown[] = [];
  await runRepositoryReadinessAnalysis(
    { connection },
    {
      connect: () => {
        connectCalls += 1;
        return Promise.resolve(connection);
      },
      analyze: (input) => {
        analysisInputs.push(input);
        return Promise.resolve(analysisResult);
      },
    },
  );

  assert.equal(connectCalls, 0);
  assert.deepEqual(analysisInputs, [
    { connectionId: "connection-1", branch: "main" },
  ]);
});

test("credential-required failures provide a Settings recovery action", async () => {
  const source = await readFile(componentPath, "utf8");
  assert.match(source, /credentialRequired/);
  assert.match(source, /section=repositories/);
  assert.match(source, /configureCredential/);
});

test("Readiness keeps repository recovery visible while technical evidence is missing", async () => {
  const source = await readFile(pagePath, "utf8");
  assert.match(source, /item\.type === "technical_evidence"/);
  assert.match(
    source,
    /repositoryConnection={viewModel\.repositoryConnection}/,
  );
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
