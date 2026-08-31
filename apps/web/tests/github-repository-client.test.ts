import * as assert from "node:assert/strict";
import { test } from "node:test";
import { CREDENTIAL_PROVIDERS } from "@lcsp/contracts/github-integration";

import {
  connectGitHubRepository,
  discoverGitHubRepositories,
} from "../src/lib/api/github-repository-client.ts";

const TEST_CREDENTIAL = "github_pat_TEST_ONLY_RECOGNIZABLE_SECRET";

test("GitHub discovery sends the credential only in the POST body", async () => {
  const originalFetch = globalThis.fetch;
  let capturedInput: RequestInfo | URL | undefined;
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    capturedInput = input;
    capturedInit = init;
    return Response.json({
      ok: true,
      data: {
        authenticated_account: { id: "1", login: "manager" },
        repositories: [],
        next_cursor: null,
      },
    });
  };
  try {
    await discoverGitHubRepositories({
      credential: TEST_CREDENTIAL,
      limit: 50,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(capturedInput, "/api/github/repository-discoveries");
  assert.equal(String(capturedInput).includes(TEST_CREDENTIAL), false);
  assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
    credential: TEST_CREDENTIAL,
    limit: 50,
  });
});

test("GitHub connect exposes no credential in its sanitized result", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      ok: true,
      data: {
        connection_id: "connection",
        repository: {
          repository_id: "2",
          name: "repo",
          full_name: "owner/repo",
          default_branch: "main",
          private: true,
        },
        connection_status: "ACTIVE",
        credential_status: "ACTIVE",
        connected_at: "2026-08-25T00:00:00.000Z",
      },
    });
  try {
    const result = await connectGitHubRepository({
      credential: TEST_CREDENTIAL,
      provider: CREDENTIAL_PROVIDERS.github,
      repository_url: "https://github.com/owner/repo",
      assessment_id: "assessment",
    });
    assert.equal(JSON.stringify(result).includes(TEST_CREDENTIAL), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
