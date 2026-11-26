import { describe, expect, it, jest } from "@jest/globals";
import {
  GITHUB_CREDENTIAL_ERROR_CODES,
  encodeBitbucketApiTokenCredential,
} from "@lcsp/contracts/github-integration";

import { CredentialLease } from "../../application/security/credential-lease.js";
import {
  BitbucketRestProviderError,
  BitbucketRestRepositoryProvider,
} from "./bitbucket-rest-repository.provider.js";

const REPOSITORY_ID = "{12345678-1234-1234-1234-123456789abc}";
const OTHER_REPOSITORY_ID = "{87654321-4321-4321-4321-cba987654321}";
const SHA = "a".repeat(40);
const SECRET = encodeBitbucketApiTokenCredential({
  email: "user@example.com",
  apiToken: "atlassian-api-token-test-value",
});

function lease(): CredentialLease {
  return new CredentialLease(SECRET, {
    internalCredentialId: "credential-1",
    credentialVersion: 3,
    repositoryFullName: "workspace/repository",
    expiresAt: new Date(Date.now() + 60_000),
  });
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function repositoryRecord(overrides: Record<string, unknown> = {}) {
  return {
    uuid: REPOSITORY_ID,
    name: "repository display name",
    slug: "repository",
    full_name: "workspace/repository",
    mainbranch: { name: "main" },
    is_private: true,
    ...overrides,
  };
}

describe("BitbucketRestRepositoryProvider", () => {
  it("validates a typed account email/API Token using Basic authentication", async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ uuid: REPOSITORY_ID, username: "bb-user" }),
      );
    const provider = new BitbucketRestRepositoryProvider({
      timeoutMs: 1000,
      maxArchiveBytes: 1024,
      fetchImpl,
    });
    const credential = lease();

    try {
      await expect(
        provider.validateIdentity(credential),
      ).resolves.toMatchObject({
        id: REPOSITORY_ID,
        login: "bb-user",
        htmlUrl: "https://bitbucket.org/bb-user",
      });
    } finally {
      credential.dispose();
    }

    const request = fetchImpl.mock.calls[0];
    expect(request[0]).toBe("https://api.bitbucket.org/2.0/user");
    expect(request[1]?.headers).toMatchObject({
      Authorization: `Basic ${Buffer.from("user@example.com:atlassian-api-token-test-value").toString("base64")}`,
      Accept: "application/json",
    });
    expect(request[1]?.redirect).toBe("manual");
  });

  it("lists accessible repositories with bounded workspace pagination", async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ values: [{ slug: "workspace" }] }))
      .mockResolvedValueOnce(jsonResponse({ values: [repositoryRecord()] }));
    const provider = new BitbucketRestRepositoryProvider({
      timeoutMs: 1000,
      maxArchiveBytes: 1024,
      fetchImpl,
    });
    const credential = lease();
    try {
      await expect(
        provider.listAccessibleRepositories(credential, {
          perPage: 100,
          maxPages: 4,
          maxRepositories: 10,
        }),
      ).resolves.toEqual([
        {
          id: REPOSITORY_ID,
          name: "repository display name",
          fullName: "workspace/repository",
          defaultBranch: "main",
          private: true,
        },
      ]);
    } finally {
      credential.dispose();
    }
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][0]).toContain(
      "/2.0/repositories/workspace?pagelen=100",
    );
  });

  it("reserves the repository page budget after resolving the first workspace", async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ values: [{ slug: "workspace" }] }))
      .mockResolvedValueOnce(jsonResponse({ values: [repositoryRecord()] }));
    const provider = new BitbucketRestRepositoryProvider({
      timeoutMs: 1000,
      maxArchiveBytes: 1024,
      fetchImpl,
    });
    const credential = lease();
    try {
      await expect(
        provider.listAccessibleRepositories(credential, {
          perPage: 100,
          maxPages: 1,
          maxRepositories: 10,
        }),
      ).resolves.toHaveLength(1);
    } finally {
      credential.dispose();
    }
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("requires the provider repository UUID and a real default branch", async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          repositoryRecord({ uuid: "12345678-1234-1234-1234-123456789abz" }),
        ),
      );
    const provider = new BitbucketRestRepositoryProvider({
      timeoutMs: 1000,
      maxArchiveBytes: 1024,
      fetchImpl,
    });
    const credential = lease();
    try {
      await expect(
        provider.validateRepositoryAccess(credential, "workspace/repository"),
      ).rejects.toMatchObject({
        category: GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
      });
    } finally {
      credential.dispose();
    }
  });

  it("pins the unique branch revision and rejects a mismatched connection UUID", async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(repositoryRecord()))
      .mockResolvedValueOnce(jsonResponse({ target: { hash: SHA } }))
      .mockResolvedValueOnce(jsonResponse({}, 404))
      .mockResolvedValueOnce(
        jsonResponse({ values: [{ hash: SHA, date: "2025-01-02T03:04:05Z" }] }),
      )
      .mockResolvedValueOnce(jsonResponse(repositoryRecord()));
    const provider = new BitbucketRestRepositoryProvider({
      timeoutMs: 1000,
      maxArchiveBytes: 1024,
      fetchImpl,
    });
    const credential = lease();
    try {
      await expect(
        provider.resolveCommit(
          credential,
          "workspace/repository",
          "main",
          REPOSITORY_ID,
        ),
      ).resolves.toMatchObject({
        sha: SHA,
        repositoryFullName: "workspace/repository",
        authorDate: "2025-01-02T03:04:05.000Z",
      });
      await expect(
        provider.resolveCommit(
          credential,
          "workspace/repository",
          SHA,
          OTHER_REPOSITORY_ID,
        ),
      ).rejects.toMatchObject({
        category: GITHUB_CREDENTIAL_ERROR_CODES.repositoryUnavailable,
      });
    } finally {
      credential.dispose();
    }
  });

  it("rejects a branch and tag with the same name as ambiguous", async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(repositoryRecord()))
      .mockResolvedValueOnce(jsonResponse({ target: { hash: SHA } }))
      .mockResolvedValueOnce(
        jsonResponse({ target: { hash: "b".repeat(40) } }),
      );
    const provider = new BitbucketRestRepositoryProvider({
      timeoutMs: 1000,
      maxArchiveBytes: 1024,
      fetchImpl,
    });
    const credential = lease();
    try {
      await expect(
        provider.resolveCommit(credential, "workspace/repository", "release"),
      ).rejects.toMatchObject({
        category: GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
      } satisfies Partial<BitbucketRestProviderError>);
    } finally {
      credential.dispose();
    }
  });

  it("resolves an explicit tag to the immutable commit returned by Bitbucket", async () => {
    const tagSha = "b".repeat(40);
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(repositoryRecord()))
      .mockResolvedValueOnce(jsonResponse({}, 404))
      .mockResolvedValueOnce(jsonResponse({ target: { hash: tagSha } }))
      .mockResolvedValueOnce(jsonResponse({ values: [{ hash: tagSha }] }));
    const provider = new BitbucketRestRepositoryProvider({
      timeoutMs: 1000,
      maxArchiveBytes: 1024,
      fetchImpl,
    });
    const credential = lease();
    try {
      await expect(
        provider.resolveCommit(
          credential,
          "workspace/repository",
          "v1.2.3",
          REPOSITORY_ID,
        ),
      ).resolves.toMatchObject({
        sha: tagSha,
        repositoryFullName: "workspace/repository",
      });
    } finally {
      credential.dispose();
    }
    expect(fetchImpl.mock.calls[2][0]).toContain("/refs/tags/v1.2.3");
  });

  it.each([
    [401, GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid],
    [403, GITHUB_CREDENTIAL_ERROR_CODES.repositoryAccessDenied],
    [429, GITHUB_CREDENTIAL_ERROR_CODES.providerRateLimited],
  ])(
    "preserves typed provider error category for HTTP %s",
    async (status, category) => {
      const fetchImpl = jest
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({}, status));
      const provider = new BitbucketRestRepositoryProvider({
        timeoutMs: 1000,
        maxArchiveBytes: 1024,
        fetchImpl,
      });
      const credential = lease();
      try {
        await expect(
          provider.validateIdentity(credential),
        ).rejects.toMatchObject({ category });
      } finally {
        credential.dispose();
      }
    },
  );

  it("maps an aborted request to providerTimeout", async () => {
    const fetchImpl = jest.fn<typeof fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        }),
    );
    const provider = new BitbucketRestRepositoryProvider({
      timeoutMs: 5,
      maxArchiveBytes: 1024,
      fetchImpl,
    });
    const credential = lease();
    try {
      await expect(provider.validateIdentity(credential)).rejects.toMatchObject(
        {
          category: GITHUB_CREDENTIAL_ERROR_CODES.providerTimeout,
        },
      );
    } finally {
      credential.dispose();
    }
  });
});
