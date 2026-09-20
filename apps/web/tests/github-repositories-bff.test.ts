import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CREDENTIAL_PROVIDERS,
  REPOSITORY_AUTHENTICATION_MODES,
  REPOSITORY_CONNECTION_STATUSES,
} from "@lcsp/contracts/github-integration";

import { getAuthRepositories } from "../src/lib/api/auth-client.ts";
import { getRepositoryConnections } from "../src/lib/api/github-repository-client.ts";
import { sanitizeRepositoriesPayload } from "../src/lib/server/repository-connections.ts";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("github repositories BFF route requests upstream /github/repositories and uses shared sanitizer", async () => {
  const source = await read("../src/app/api/github/repositories/route.ts");
  assert.equal(source.includes('upstreamRequest("/github/repositories"'), true);
  assert.equal(
    source.includes("sanitizeRepositoriesPayload"),
    true,
  );
});

test("auth repositories compatibility route uses shared sanitizer and mock fixture", async () => {
  const source = await read("../src/app/api/auth/repositories/route.ts");
  assert.equal(source.includes('upstreamRequest("/github/repositories"'), true);
  assert.equal(
    source.includes("sanitizeRepositoriesPayload"),
    true,
  );
});

test("mock repositories fixture defines provider GITHUB and satisfies connection schema", async () => {
  const raw = await read("../src/public/assets/mocks/repositories.json");
  const data = JSON.parse(raw);
  assert.equal(Array.isArray(data.repositories), true);
  assert.equal(data.repositories[0].provider, CREDENTIAL_PROVIDERS.github);
  const sanitized = sanitizeRepositoriesPayload(data);
  assert.notEqual(sanitized, null);
  assert.equal(sanitized?.repositories[0].provider, CREDENTIAL_PROVIDERS.github);
});

test("getRepositoryConnections receives mock BFF shape and returns defined provider", async () => {
  const mockPayload = JSON.parse(
    await read("../src/public/assets/mocks/repositories.json"),
  );
  const originalFetch = globalThis.fetch;
  let capturedInput: RequestInfo | URL | undefined;

  globalThis.fetch = async (input) => {
    capturedInput = input;
    return Response.json({
      ok: true,
      data: mockPayload,
    });
  };

  try {
    const repos = await getRepositoryConnections();
    assert.equal(capturedInput, "/api/github/repositories");
    assert.equal(repos.length, 1);
    assert.equal(repos[0].provider, CREDENTIAL_PROVIDERS.github);
    assert.equal(repos[0].repository_name, "lcsp-platform");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sanitizeRepositoriesPayload rejects upstream repository missing provider", () => {
  const payloadMissingProvider = {
    repositories: [
      {
        id: "repo-1",
        authentication_mode: REPOSITORY_AUTHENTICATION_MODES.githubApp,
        installation_id: "install-123",
        repository_name: "lcsp-platform",
        repository_full_name: "khovan123/LCSP",
        default_branch: "main",
        status: REPOSITORY_CONNECTION_STATUSES.active,
        connected_at: "2026-08-25T00:00:00.000Z",
        revoked_at: null,
        assessment_id: null,
        assessment_name: null,
      },
    ],
  };

  assert.equal(sanitizeRepositoriesPayload(payloadMissingProvider), null);
});

test("sanitizeRepositoriesPayload rejects repository with invalid provider enum", () => {
  const payloadInvalidProvider = {
    repositories: [
      {
        id: "repo-1",
        provider: "UNSUPPORTED_PROVIDER",
        authentication_mode: REPOSITORY_AUTHENTICATION_MODES.githubApp,
        installation_id: "install-123",
        repository_name: "lcsp-platform",
        repository_full_name: "khovan123/LCSP",
        default_branch: "main",
        status: REPOSITORY_CONNECTION_STATUSES.active,
        connected_at: "2026-08-25T00:00:00.000Z",
        revoked_at: null,
        assessment_id: null,
        assessment_name: null,
      },
    ],
  };

  assert.equal(sanitizeRepositoriesPayload(payloadInvalidProvider), null);
});

test("sanitizeRepositoriesPayload accepts all valid credential provider values", () => {
  for (const provider of Object.values(CREDENTIAL_PROVIDERS)) {
    const payload = {
      repositories: [
        {
          id: `repo-${provider}`,
          provider,
          authentication_mode:
            REPOSITORY_AUTHENTICATION_MODES.githubCliCredential,
          installation_id: null,
          repository_name: "test-repo",
          repository_full_name: `org/test-${provider}`,
          default_branch: "main",
          status: REPOSITORY_CONNECTION_STATUSES.active,
          connected_at: "2026-08-25T00:00:00.000Z",
          revoked_at: null,
          assessment_id: null,
          assessment_name: null,
        },
      ],
    };

    const sanitized = sanitizeRepositoriesPayload(payload);
    assert.notEqual(sanitized, null);
    assert.equal(sanitized?.repositories[0].provider, provider);
  }
});

test("getAuthRepositories remains backwards compatible and queries /api/auth/repositories with provider", async () => {
  const originalFetch = globalThis.fetch;
  let capturedInput: RequestInfo | URL | undefined;

  globalThis.fetch = async (input) => {
    capturedInput = input;
    return Response.json({
      ok: true,
      data: {
        repositories: [
          {
            id: "repo-compat-1",
            provider: CREDENTIAL_PROVIDERS.github,
            authentication_mode:
              REPOSITORY_AUTHENTICATION_MODES.githubCliCredential,
            installation_id: null,
            repository_name: "legacy-repo",
            repository_full_name: "khovan123/legacy-repo",
            default_branch: "master",
            status: REPOSITORY_CONNECTION_STATUSES.active,
            connected_at: "2026-08-20T00:00:00.000Z",
            revoked_at: null,
            assessment_id: null,
            assessment_name: null,
          },
        ],
      },
    });
  };

  try {
    const repos = await getAuthRepositories();
    assert.equal(capturedInput, "/api/auth/repositories");
    assert.equal(repos.length, 1);
    assert.equal(repos[0].provider, CREDENTIAL_PROVIDERS.github);
    assert.equal(repos[0].repository_name, "legacy-repo");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
