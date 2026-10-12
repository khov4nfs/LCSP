import { describe, expect, it, jest } from "@jest/globals";
import { Readable } from "node:stream";

import {
  GITHUB_ARCHIVE_REDIRECT_VALIDATION_STATUSES,
  GITHUB_ARCHIVE_TRANSPORT_ERROR_CODES,
  GITHUB_CREDENTIAL_ERROR_CODES,
} from "@lcsp/contracts/github-integration";

import { CredentialLease } from "../../application/security/credential-lease.js";
import {
  GitHubSecureArchiveHttpTransport,
  type GitHubArchiveFetch,
} from "./github-secure-archive-http.transport.js";

const SECRET = "github_pat_RECOGNIZABLE_PHASE5B_SECRET";
const SIGNED_MARKER = "SIGNED_PRIVATE_ARCHIVE_MARKER";
const SHA = "a".repeat(40);

describe("GitHubSecureArchiveHttpTransport", () => {
  function lease(): CredentialLease {
    return new CredentialLease(SECRET, {
      internalCredentialId: "credential-1",
      credentialVersion: 1,
      repositoryFullName: "acme/repo",
      expiresAt: new Date(Date.now() + 60_000),
    });
  }

  function transport(
    fetchImplementation: GitHubArchiveFetch,
    maxArchiveBytes = 1024,
    timeoutMs = 1_000,
  ) {
    return new GitHubSecureArchiveHttpTransport(
      { timeoutMs, maxArchiveBytes },
      fetchImplementation,
    );
  }

  it("validates the redirect and forwards Authorization only to api.github.com", async () => {
    const calls: Array<{ authorization?: string }> = [];
    const fakeFetch = jest.fn<GitHubArchiveFetch>((_input, init) => {
      const headers = new Headers(init?.headers);
      calls.push({
        authorization: headers.get("authorization") ?? undefined,
      });
      return Promise.resolve(
        calls.length === 1
          ? new Response(null, {
              status: 302,
              headers: {
                location: `https://codeload.github.com/acme/repo/tar.gz/${SHA}?token=${SIGNED_MARKER}`,
              },
            })
          : new Response(Buffer.from("archive"), {
              status: 200,
              headers: { "content-type": "application/x-gzip" },
            }),
      );
    });

    const result = await transport(fakeFetch).downloadArchive({
      credentialLease: lease(),
      repositoryFullName: "acme/repo",
      commitSha: SHA,
    });

    expect(result.redirectValidation).toBe(
      GITHUB_ARCHIVE_REDIRECT_VALIDATION_STATUSES.verified,
    );
    expect(result.validatedHost).toBe("codeload.github.com");
    expect(calls[0]?.authorization).toBe(`Bearer ${SECRET}`);
    expect(calls[1]?.authorization).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(JSON.stringify(result)).not.toContain(SIGNED_MARKER);
  });

  it.each([
    "https://codeload.github.com.attacker.example/archive",
    "http://codeload.github.com/archive",
    "https://[invalid",
  ])("rejects unsafe redirect %s without exposing it", async (location) => {
    const fakeFetch = jest
      .fn<GitHubArchiveFetch>()
      .mockResolvedValue(
        new Response(null, { status: 302, headers: { location } }),
      );
    const operation = transport(fakeFetch).downloadArchive({
      credentialLease: lease(),
      repositoryFullName: "acme/repo",
      commitSha: SHA,
    });
    await expect(operation).rejects.toMatchObject({
      code: GITHUB_ARCHIVE_TRANSPORT_ERROR_CODES.redirectValidationFailed,
    });
    await operation.catch((error: unknown) => {
      expect(String(error)).not.toContain(location);
      expect(String(error)).not.toContain(SECRET);
    });
  });

  it("rejects a redirect without Location", async () => {
    const fakeFetch = jest
      .fn<GitHubArchiveFetch>()
      .mockResolvedValue(new Response(null, { status: 302 }));
    await expect(
      transport(fakeFetch).downloadArchive({
        credentialLease: lease(),
        repositoryFullName: "acme/repo",
        commitSha: SHA,
      }),
    ).rejects.toMatchObject({
      code: GITHUB_ARCHIVE_TRANSPORT_ERROR_CODES.redirectValidationFailed,
    });
  });

  it("validates every redirect and enforces the redirect limit", async () => {
    const fakeFetch = jest.fn<GitHubArchiveFetch>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://github.com/acme/repo/archive" },
      }),
    );
    await expect(
      transport(fakeFetch).downloadArchive({
        credentialLease: lease(),
        repositoryFullName: "acme/repo",
        commitSha: SHA,
      }),
    ).rejects.toMatchObject({
      code: GITHUB_ARCHIVE_TRANSPORT_ERROR_CODES.tooManyRedirects,
    });
    expect(fakeFetch).toHaveBeenCalledTimes(4);
  });

  it("maps an authoritative 401 without exposing response data", async () => {
    const fakeFetch = jest
      .fn<GitHubArchiveFetch>()
      .mockResolvedValue(new Response(`token=${SECRET}`, { status: 401 }));
    const operation = transport(fakeFetch).downloadArchive({
      credentialLease: lease(),
      repositoryFullName: "acme/repo",
      commitSha: SHA,
    });
    await expect(operation).rejects.toMatchObject({
      code: GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid,
    });
    await operation.catch((error: unknown) =>
      expect(String(error)).not.toContain(SECRET),
    );
  });

  it("enforces streamed archive byte limits without buffering", async () => {
    const fakeFetch = jest
      .fn<GitHubArchiveFetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: {
            location: "https://codeload.github.com/acme/repo/archive",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          Readable.toWeb(Readable.from([Buffer.alloc(4), Buffer.alloc(4)])),
          {
            status: 200,
            headers: { "content-type": "application/gzip" },
          },
        ),
      );
    const result = await transport(fakeFetch, 6).downloadArchive({
      credentialLease: lease(),
      repositoryFullName: "acme/repo",
      commitSha: SHA,
    });
    await expect(consume(result.stream)).rejects.toMatchObject({
      code: GITHUB_ARCHIVE_TRANSPORT_ERROR_CODES.archiveTooLarge,
    });
  });

  it("maps cancellation separately from credential validity", async () => {
    const controller = new AbortController();
    const fakeFetch = jest.fn<GitHubArchiveFetch>((_input, init) => {
      controller.abort();
      void init;
      return Promise.reject(new Error("aborted"));
    });
    await expect(
      transport(fakeFetch).downloadArchive({
        credentialLease: lease(),
        repositoryFullName: "acme/repo",
        commitSha: SHA,
        abortSignal: controller.signal,
      }),
    ).rejects.toMatchObject({
      code: GITHUB_CREDENTIAL_ERROR_CODES.operationCancelled,
    });
  });

  it("applies a bounded timeout without exposing request details", async () => {
    const fakeFetch = jest.fn<GitHubArchiveFetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            {
              once: true,
            },
          );
        }),
    );
    await expect(
      transport(fakeFetch, 1024, 5).downloadArchive({
        credentialLease: lease(),
        repositoryFullName: "acme/repo",
        commitSha: SHA,
      }),
    ).rejects.toMatchObject({
      code: GITHUB_CREDENTIAL_ERROR_CODES.providerTimeout,
    });
  });
});

async function consume(stream: NodeJS.ReadableStream): Promise<void> {
  for await (const chunk of stream) {
    void chunk;
    // Consume incrementally so the byte-limit transform observes each chunk.
  }
}
