import { describe, expect, it, jest } from "@jest/globals";
import {
  encodeAzureDevOpsOrganizationPatCredential,
  GITHUB_CREDENTIAL_ERROR_CODES,
} from "@lcsp/contracts/github-integration";
import { CredentialLease } from "../../application/security/credential-lease.js";
import {
  AzureDevOpsRestProviderError,
  AzureDevOpsRestRepositoryProvider,
} from "./azure-devops-rest-repository.provider.js";

const REPOSITORY_ID = "12345678-1234-4234-8234-123456789abc";
const SHA_BRANCH = "a".repeat(40);
const SHA_TAG = "b".repeat(40);
const PAT = "azure-pat-secret-value";
const SECRET = encodeAzureDevOpsOrganizationPatCredential({
  organization: "fabrikam",
  pat: PAT,
});

function lease() {
  return new CredentialLease(SECRET, {
    internalCredentialId: "credential-1",
    credentialVersion: 4,
    repositoryFullName: "fabrikam/Product Suite/Compiler",
    expiresAt: new Date(Date.now() + 60_000),
  });
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.toString() : input.url;
}

function repo(overrides: Record<string, unknown> = {}) {
  return {
    id: REPOSITORY_ID,
    name: "Compiler",
    project: {
      name: "Product Suite",
      id: "87654321-4321-4321-8321-cba987654321",
    },
    defaultBranch: "refs/heads/main",
    remoteUrl: "https://dev.azure.com/fabrikam/Product%20Suite/_git/Compiler",
    ...overrides,
  };
}

describe("AzureDevOpsRestRepositoryProvider", () => {
  it("validates only the typed organization PAT and binds identity to its organization scope", async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValue(json({ value: [] }));
    const provider = new AzureDevOpsRestRepositoryProvider({
      timeoutMs: 1000,
      maxArchiveBytes: 4096,
      fetchImpl,
    });
    const credential = lease();
    try {
      await expect(
        provider.validateIdentity(credential),
      ).resolves.toMatchObject({
        id: "azure-organization:fabrikam",
        login: "fabrikam",
      });
      const request = fetchImpl.mock.calls[0];
      expect(requestUrl(request[0])).toContain(
        "https://dev.azure.com/fabrikam/_apis/git/repositories",
      );
      expect(new Headers(request[1]?.headers).get("authorization")).toBe(
        `Basic ${Buffer.from(`:${PAT}`).toString("base64")}`,
      );
    } finally {
      credential.dispose();
    }
  });

  it("follows only bounded Azure continuation pages for repository discovery", async () => {
    const second = repo({
      id: "23456789-1234-4234-8234-123456789abc",
      name: "Compiler Next",
      remoteUrl:
        "https://dev.azure.com/fabrikam/Product%20Suite/_git/Compiler%20Next",
    });
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ value: [repo()] }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-ms-continuationtoken": "next-page",
          },
        }),
      )
      .mockResolvedValueOnce(json({ value: [second] }));
    const provider = new AzureDevOpsRestRepositoryProvider({
      timeoutMs: 1000,
      maxArchiveBytes: 4096,
      fetchImpl,
    });
    const credential = lease();
    try {
      const repositories = await provider.listAccessibleRepositories(
        credential,
        {
          perPage: 1,
          maxPages: 2,
          maxRepositories: 10,
        },
      );
      expect(repositories.map((item) => item.id)).toEqual([
        REPOSITORY_ID,
        second.id,
      ]);
      expect(
        new URL(requestUrl(fetchImpl.mock.calls[1][0])).searchParams.get(
          "continuationToken",
        ),
      ).toBe("next-page");
    } finally {
      credential.dispose();
    }
  });

  it.each([
    ["refs/heads/main", SHA_BRANCH],
    ["refs/tags/v1", SHA_TAG],
    [SHA_BRANCH, SHA_BRANCH],
  ])(
    "resolves %s to an immutable commit in the matched organization/project/repository",
    async (revision, expectedSha) => {
      const fetchImpl = jest.fn<typeof fetch>().mockImplementation((input) => {
        const url = requestUrl(input);
        if (url.includes("/refs?"))
          return Promise.resolve(
            json({
              value: [
                { name: "refs/heads/main", objectId: SHA_BRANCH },
                {
                  name: "refs/tags/v1",
                  objectId: "c".repeat(40),
                  peeledObjectId: SHA_TAG,
                },
              ],
            }),
          );
        if (url.includes("/commits/"))
          return Promise.resolve(
            json({
              commitId: expectedSha,
              committer: { date: "2026-01-02T03:04:05Z" },
            }),
          );
        return Promise.resolve(json({ value: [repo()] }));
      });
      const provider = new AzureDevOpsRestRepositoryProvider({
        timeoutMs: 1000,
        maxArchiveBytes: 4096,
        fetchImpl,
      });
      const credential = lease();
      try {
        await expect(
          provider.resolveCommit(
            credential,
            "fabrikam/Product Suite/Compiler",
            revision,
            REPOSITORY_ID,
          ),
        ).resolves.toMatchObject({
          sha: expectedSha,
          repositoryFullName: "fabrikam/Product Suite/Compiler",
        });
      } finally {
        credential.dispose();
      }
    },
  );

  it("rejects cross-organization and repository GUID mismatches", async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValue(json({ value: [repo()] }));
    const provider = new AzureDevOpsRestRepositoryProvider({
      timeoutMs: 1000,
      maxArchiveBytes: 4096,
      fetchImpl,
    });
    const credential = lease();
    try {
      await expect(
        provider.validateRepositoryAccess(
          credential,
          "other/Product Suite/Compiler",
        ),
      ).rejects.toMatchObject({
        category: GITHUB_CREDENTIAL_ERROR_CODES.repositoryAccessDenied,
      });
      await expect(
        provider.resolveCommit(
          credential,
          "fabrikam/Product Suite/Compiler",
          "refs/heads/main",
          "87654321-4321-4321-8321-cba987654321",
        ),
      ).rejects.toBeInstanceOf(AzureDevOpsRestProviderError);
    } finally {
      credential.dispose();
    }
  });

  it("rejects an ambiguous branch and tag with the same short revision name", async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ value: [repo()] }))
      .mockResolvedValueOnce(
        json({
          value: [
            { name: "refs/heads/v1", objectId: SHA_BRANCH },
            { name: "refs/tags/v1", objectId: SHA_TAG },
          ],
        }),
      );
    const provider = new AzureDevOpsRestRepositoryProvider({
      timeoutMs: 1000,
      maxArchiveBytes: 4096,
      fetchImpl,
    });
    const credential = lease();
    try {
      await expect(
        provider.resolveCommit(
          credential,
          "fabrikam/Product Suite/Compiler",
          "v1",
        ),
      ).rejects.toMatchObject({
        category: GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
      });
    } finally {
      credential.dispose();
    }
  });
});
