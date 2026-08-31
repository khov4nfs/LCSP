import { describe, expect, it, jest } from "@jest/globals";
import { Readable } from "node:stream";
import { RepositoryAuthenticationMode } from "@prisma/client";

import {
  GITHUB_ARCHIVE_REDIRECT_VALIDATION_STATUSES,
  GITHUB_ARCHIVE_TRANSPORT_ERROR_CODES,
  GITHUB_CREDENTIAL_ERROR_CODES,
  CREDENTIAL_PROVIDERS,
  REPOSITORY_CONNECTION_STATUSES,
  REPOSITORY_SCAN_JOB_STATUSES,
  REPOSITORY_SNAPSHOT_STATUSES,
} from "@lcsp/contracts/github-integration";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { CredentialLease } from "../../../application/security/credential-lease.js";
import type { CredentialAuthorizationResolverPort } from "../../../application/ports/security/credential-authorization-resolver.port.js";
import type { GitHubArchiveTransportPort } from "../../../application/ports/github-archive-transport.port.js";
import { GitHubArchiveTransportError } from "../../../infrastructure/github/github-secure-archive-http.transport.js";
import type { SnapshotArchiveCache } from "../../../infrastructure/github/snapshot-archive-cache.js";
import { StreamSnapshotArchiveHandler } from "./stream-snapshot-archive.handler.js";
import { StreamSnapshotArchiveQuery } from "./stream-snapshot-archive.query.js";

const SHA = "a".repeat(40);
const SECRET = "github_pat_PHASE5B_HANDLER_SECRET";

describe("StreamSnapshotArchiveHandler CLI archive routing", () => {
  function fixture(
    options: {
      cacheHit?: boolean;
      enabled?: boolean;
      transportError?: GitHubArchiveTransportError;
    } = {},
  ) {
    const prisma = {
      repositoryScanJob: {
        findUnique: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          id: "job-1",
          snapshotId: "snapshot-1",
          status: REPOSITORY_SCAN_JOB_STATUSES.running,
        }),
        updateMany: jest.fn(),
      },
      repositorySnapshot: {
        findUnique: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          id: "snapshot-1",
          connectionId: "connection-1",
          assessmentId: "assessment-1",
          repositoryId: "repo-1",
          repositoryFullName: "acme/repo",
          commitSha: SHA,
          status: REPOSITORY_SNAPSHOT_STATUSES.ready,
        }),
      },
      repositoryConnection: {
        findUnique: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          id: "connection-1",
          userId: "user-1",
          provider: CREDENTIAL_PROVIDERS.github,
          installationId: null,
          status: REPOSITORY_CONNECTION_STATUSES.active,
          authenticationMode:
            RepositoryAuthenticationMode.GITHUB_CLI_CREDENTIAL,
          providerCredentialId: "credential-1",
          repositoryId: "repo-1",
          repositoryFullName: "acme/repo",
        }),
      },
    } as unknown as PrismaService;
    const lease = new CredentialLease(SECRET, {
      internalCredentialId: "credential-1",
      credentialVersion: 7,
      repositoryFullName: "acme/repo",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const dispose = jest.spyOn(lease, "dispose");
    const resolveForConnection = jest
      .fn<CredentialAuthorizationResolverPort["resolveForConnection"]>()
      .mockResolvedValue(lease);
    const markInvalid = jest
      .fn<CredentialAuthorizationResolverPort["markInvalid"]>()
      .mockResolvedValue();
    const downloadArchive = jest
      .fn<GitHubArchiveTransportPort["downloadArchive"]>()
      .mockImplementation(() => {
        if (options.transportError) throw options.transportError;
        return Promise.resolve({
          stream: Readable.from([Buffer.from("archive")]),
          contentType: "application/gzip",
          redirectValidation:
            GITHUB_ARCHIVE_REDIRECT_VALIDATION_STATUSES.verified,
          validatedHost: "codeload.github.com",
        });
      });
    const cache = {
      get: jest.fn<() => Promise<unknown>>().mockResolvedValue(
        options.cacheHit
          ? {
              stream: Readable.from([Buffer.from("cached")]),
              contentType: "application/gzip",
              resolvedUrl: "https://codeload.github.com/",
            }
          : null,
      ),
      capture: jest
        .fn()
        .mockImplementation((input: { source: NodeJS.ReadableStream }) =>
          Promise.resolve({
            stream: input.source,
            completion: Promise.resolve(),
          }),
        ),
    } as unknown as SnapshotArchiveCache;
    const appDownload = jest.fn();
    const handler = new StreamSnapshotArchiveHandler(
      prisma,
      { downloadRepositoryArchive: appDownload } as never,
      cache,
      { resolveForConnection, markInvalid } as never,
      { downloadArchive },
      {
        get: jest.fn(() => ({
          archiveRetrievalEnabled: options.enabled ?? true,
        })),
      } as never,
    );
    return {
      handler,
      resolveForConnection,
      markInvalid,
      downloadArchive,
      appDownload,
      dispose,
    };
  }

  it("routes a CLI cache miss only through resolver and secure HTTP transport", async () => {
    const f = fixture();
    const result = await f.handler.execute(
      new StreamSnapshotArchiveQuery("snapshot-1", "job-1", "corr-1"),
    );
    expect(f.appDownload).not.toHaveBeenCalled();
    expect(f.resolveForConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        assessmentId: "assessment-1",
      }),
      "connection-1",
      "acme/repo",
    );
    expect(f.downloadArchive).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryFullName: "acme/repo",
        commitSha: SHA,
      }),
    );
    expect(result.resolvedUrl).toBe("https://codeload.github.com/");
    expect(f.dispose).toHaveBeenCalledTimes(1);
  });

  it("serves a verified cache hit while disabled without resolving a credential", async () => {
    const f = fixture({ cacheHit: true, enabled: false });
    await f.handler.execute(
      new StreamSnapshotArchiveQuery("snapshot-1", "job-1", "corr-cache"),
    );
    expect(f.resolveForConnection).not.toHaveBeenCalled();
    expect(f.downloadArchive).not.toHaveBeenCalled();
  });

  it("fails a CLI cache miss closed when the archive gate is disabled", async () => {
    const f = fixture({ enabled: false });
    await expect(
      f.handler.execute(
        new StreamSnapshotArchiveQuery("snapshot-1", "job-1", "corr-disabled"),
      ),
    ).rejects.toBeDefined();
    expect(f.resolveForConnection).not.toHaveBeenCalled();
    expect(f.downloadArchive).not.toHaveBeenCalled();
  });

  it("invalidates only the lease version for an authoritative 401", async () => {
    const f = fixture({
      transportError: new GitHubArchiveTransportError(
        GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid,
        401,
      ),
    });
    await expect(
      f.handler.execute(
        new StreamSnapshotArchiveQuery("snapshot-1", "job-1", "corr-401"),
      ),
    ).rejects.toBeDefined();
    expect(f.markInvalid).toHaveBeenCalledWith(
      "connection-1",
      7,
      GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid,
    );
    expect(f.dispose).toHaveBeenCalledTimes(1);
  });

  it("does not invalidate on redirect validation failure", async () => {
    const f = fixture({
      transportError: new GitHubArchiveTransportError(
        GITHUB_ARCHIVE_TRANSPORT_ERROR_CODES.redirectValidationFailed,
      ),
    });
    await expect(
      f.handler.execute(
        new StreamSnapshotArchiveQuery("snapshot-1", "job-1", "corr-redirect"),
      ),
    ).rejects.toBeDefined();
    expect(f.markInvalid).not.toHaveBeenCalled();
    expect(f.dispose).toHaveBeenCalledTimes(1);
  });

  it.each([
    GITHUB_CREDENTIAL_ERROR_CODES.providerTimeout,
    GITHUB_CREDENTIAL_ERROR_CODES.providerRateLimited,
    GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
  ])("does not invalidate a credential for %s", async (code) => {
    const f = fixture({
      transportError: new GitHubArchiveTransportError(code),
    });
    await expect(
      f.handler.execute(
        new StreamSnapshotArchiveQuery("snapshot-1", "job-1", "corr-transient"),
      ),
    ).rejects.toBeDefined();
    expect(f.markInvalid).not.toHaveBeenCalled();
    expect(f.dispose).toHaveBeenCalledTimes(1);
  });
});
