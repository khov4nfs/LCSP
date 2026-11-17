import * as assert from "node:assert/strict";
import { test } from "node:test";
import { AUTH_ERROR_CODES, REQUIRED_ACTIONS } from "@lcsp/contracts/auth";
import { CREDENTIAL_PROVIDERS } from "@lcsp/contracts/github-integration";

import {
  connectGitHubRepository,
  disconnectProviderCredential,
  discoverGitHubRepositories,
  getProviderCredentialStatuses,
  GitHubRepositoryRequestError,
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

test("provider disconnect sends no body or secret and succeeds only on a matching acknowledgment", async () => {
  const originalFetch = globalThis.fetch;
  let captured: { input: RequestInfo | URL; init?: RequestInit } | undefined;
  try {
    globalThis.fetch = async (input, init) => {
      captured = { input, init };
      return Response.json({
        ok: true,
        data: {
          provider: CREDENTIAL_PROVIDERS.gitlab,
          configured: false,
          status: "REVOKED",
        },
      });
    };
    const result = await disconnectProviderCredential(
      CREDENTIAL_PROVIDERS.gitlab,
    );
    assert.equal(captured?.input, "/api/provider-credentials/GITLAB");
    assert.equal(captured?.init?.method, "DELETE");
    assert.equal(captured?.init?.body, undefined);
    assert.deepEqual(result, {
      provider: CREDENTIAL_PROVIDERS.gitlab,
      configured: false,
      status: null,
      account: null,
    });

    for (const data of [
      {},
      { provider: CREDENTIAL_PROVIDERS.github, configured: false },
      { provider: CREDENTIAL_PROVIDERS.gitlab, configured: true },
    ]) {
      globalThis.fetch = async () => Response.json({ ok: true, data });
      await assert.rejects(
        disconnectProviderCredential(CREDENTIAL_PROVIDERS.gitlab),
        GitHubRepositoryRequestError,
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider disconnect surfaces reauthentication requirements and never reports success", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      Response.json(
        {
          ok: false,
          problem: {
            code: AUTH_ERROR_CODES.reauthRequired,
            status: 403,
            requiredAction: REQUIRED_ACTIONS.reauthenticate,
          },
        },
        { status: 403 },
      );
    await assert.rejects(
      disconnectProviderCredential(CREDENTIAL_PROVIDERS.github),
      (error: unknown) =>
        error instanceof GitHubRepositoryRequestError &&
        error.requiredAction === REQUIRED_ACTIONS.reauthenticate,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("credential status list accepts lifecycle states for unhealthy credentials", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      Response.json({
        ok: true,
        data: [
          {
            provider: CREDENTIAL_PROVIDERS.github,
            configured: false,
            status: "EXPIRED",
            account: { id: "1", username: "octo" },
          },
        ],
      });
    const statuses = await getProviderCredentialStatuses();
    assert.equal(statuses[0].status, "EXPIRED");
    assert.equal(statuses[0].configured, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
