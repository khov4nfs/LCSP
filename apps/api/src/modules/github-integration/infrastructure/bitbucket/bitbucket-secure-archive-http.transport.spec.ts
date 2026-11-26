import { describe, expect, it, jest } from "@jest/globals";
import {
  GITHUB_CREDENTIAL_ERROR_CODES,
  encodeBitbucketApiTokenCredential,
} from "@lcsp/contracts/github-integration";

import { CredentialLease } from "../../application/security/credential-lease.js";
import { BitbucketSecureArchiveHttpTransport } from "./bitbucket-secure-archive-http.transport.js";

const REPOSITORY_ID = "{12345678-1234-1234-1234-123456789abc}";
const SHA = "a".repeat(40);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
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

function repositoryResponse(): Response {
  return new Response(
    JSON.stringify({ uuid: REPOSITORY_ID, full_name: "workspace/repository" }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

async function readStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) chunks.push(chunk);
  return Buffer.concat(chunks);
}

describe("BitbucketSecureArchiveHttpTransport", () => {
  it("verifies repository UUID and downloads the exact pinned ZIP with Basic auth", async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(repositoryResponse())
      .mockResolvedValueOnce(
        new Response(ZIP, {
          status: 200,
          headers: {
            "content-type": "application/zip",
            "content-disposition":
              'attachment; filename="workspace-repository-aaaaaaaaaaaa.zip"',
          },
        }),
      );
    const transport = new BitbucketSecureArchiveHttpTransport(
      { timeoutMs: 1000, maxArchiveBytes: 1024 },
      fetchImpl,
    );
    const credentialLease = lease();
    try {
      const result = await transport.downloadArchive({
        credentialLease,
        repositoryId: REPOSITORY_ID,
        repositoryFullName: "workspace/repository",
        commitSha: SHA,
      });
      expect(await readStream(result.stream)).toEqual(ZIP);
      expect(result.contentType).toBe("application/zip");
      expect(result.archiveRoot).toBe("workspace-repository-aaaaaaaaaaaa");
    } finally {
      credentialLease.dispose();
    }

    expect(fetchImpl.mock.calls[0][0] as string).toBe(
      "https://api.bitbucket.org/2.0/repositories/workspace/repository",
    );
    expect(fetchImpl.mock.calls[1][0] as string).toBe(
      `https://bitbucket.org/workspace/repository/get/${SHA}.zip`,
    );
    for (const [, options] of fetchImpl.mock.calls) {
      expect((options?.headers as Record<string, string>).Authorization).toBe(
        `Basic ${Buffer.from("user@example.com:atlassian-api-token-test-value").toString("base64")}`,
      );
      expect(options?.redirect).toBe("manual");
    }
  });

  it("does not forward Basic credentials after a trusted redirect", async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(repositoryResponse())
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: {
            location: `https://bitbucket.org/workspace/repository/get/${SHA}.zip?download=1`,
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(ZIP, {
          status: 200,
          headers: {
            "content-type": "application/zip",
            "content-disposition":
              'attachment; filename="workspace-repository-aaaaaaaaaaaa.zip"',
          },
        }),
      );
    const transport = new BitbucketSecureArchiveHttpTransport(
      { timeoutMs: 1000, maxArchiveBytes: 1024 },
      fetchImpl,
    );
    const credentialLease = lease();
    try {
      const result = await transport.downloadArchive({
        credentialLease,
        repositoryId: REPOSITORY_ID,
        repositoryFullName: "workspace/repository",
        commitSha: SHA,
      });
      expect(await readStream(result.stream)).toEqual(ZIP);
    } finally {
      credentialLease.dispose();
    }
    expect(
      (fetchImpl.mock.calls[1][1]?.headers as Record<string, string>)
        .Authorization,
    ).toBeDefined();
    expect(fetchImpl.mock.calls[2][1]?.headers).toEqual({});
  });

  it.each([
    ["HTML login response", "text/html", Buffer.from("<html>login</html>")],
    ["JSON error response", "application/json", Buffer.from('{"error":true}')],
  ])(
    "rejects %s instead of treating HTTP 200 as a valid archive",
    async (_label, contentType, body) => {
      const fetchImpl = jest
        .fn<typeof fetch>()
        .mockResolvedValueOnce(repositoryResponse())
        .mockResolvedValueOnce(
          new Response(body, {
            status: 200,
            headers: { "content-type": contentType },
          }),
        );
      const transport = new BitbucketSecureArchiveHttpTransport(
        { timeoutMs: 1000, maxArchiveBytes: 1024 },
        fetchImpl,
      );
      const credentialLease = lease();
      try {
        await expect(
          transport.downloadArchive({
            credentialLease,
            repositoryId: REPOSITORY_ID,
            repositoryFullName: "workspace/repository",
            commitSha: SHA,
          }),
        ).rejects.toMatchObject({
          code: GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
        });
      } finally {
        credentialLease.dispose();
      }
    },
  );

  it.each([
    ["missing filename", { "content-type": "application/zip" }],
    [
      "mismatched pinned commit",
      {
        "content-type": "application/zip",
        "content-disposition":
          'attachment; filename="workspace-repository-bbbbbbbbbbbb.zip"',
      },
    ],
    [
      "path-like filename",
      {
        "content-type": "application/zip",
        "content-disposition":
          'attachment; filename="../workspace-repository-aaaaaaaaaaaa.zip"',
      },
    ],
    [
      "conflicting extended filename",
      {
        "content-type": "application/zip",
        "content-disposition":
          "attachment; filename=\"workspace-repository-aaaaaaaaaaaa.zip\"; filename*=UTF-8''other.zip",
      },
    ],
  ])(
    "rejects %s as untrusted archive-root metadata",
    async (_label, headers) => {
      const fetchImpl = jest
        .fn<typeof fetch>()
        .mockResolvedValueOnce(repositoryResponse())
        .mockResolvedValueOnce(new Response(ZIP, { status: 200, headers }));
      const transport = new BitbucketSecureArchiveHttpTransport(
        { timeoutMs: 1000, maxArchiveBytes: 1024 },
        fetchImpl,
      );
      const credentialLease = lease();
      try {
        await expect(
          transport.downloadArchive({
            credentialLease,
            repositoryId: REPOSITORY_ID,
            repositoryFullName: "workspace/repository",
            commitSha: SHA,
          }),
        ).rejects.toMatchObject({
          code: GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
        });
      } finally {
        credentialLease.dispose();
      }
    },
  );

  it("rejects untrusted redirect hosts without making a second request", async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(repositoryResponse())
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: `https://attacker.example/${SHA}.zip` },
        }),
      );
    const transport = new BitbucketSecureArchiveHttpTransport(
      { timeoutMs: 1000, maxArchiveBytes: 1024 },
      fetchImpl,
    );
    const credentialLease = lease();
    try {
      await expect(
        transport.downloadArchive({
          credentialLease,
          repositoryId: REPOSITORY_ID,
          repositoryFullName: "workspace/repository",
          commitSha: SHA,
        }),
      ).rejects.toMatchObject({
        code: GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
      });
    } finally {
      credentialLease.dispose();
    }
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
