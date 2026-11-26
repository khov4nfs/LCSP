import { describe, expect, it, jest } from "@jest/globals";
import {
  BadGatewayException,
  ConflictException,
  HttpException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Readable } from "node:stream";
import {
  RepositoryScanJobStatus,
  RepositoryAuthenticationMode,
} from "@prisma/client";

import {
  CREDENTIAL_PROVIDERS,
  GITHUB_ARCHIVE_REDIRECT_VALIDATION_STATUSES,
  GITHUB_CREDENTIAL_ERROR_CODES,
  REPOSITORY_CONNECTION_STATUSES,
  REPOSITORY_SCAN_JOB_STATUSES,
  REPOSITORY_SCAN_TRIGGER_SOURCES,
  REPOSITORY_SNAPSHOT_STATUSES,
  type GitHubArchiveRedirectValidationStatus,
} from "@lcsp/contracts/github-integration";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { CredentialLease } from "../../../application/security/credential-lease.js";
import type { CredentialAuthorizationResolverPort } from "../../../application/ports/security/credential-authorization-resolver.port.js";
import type { GitHubArchiveTransportPort } from "../../../application/ports/github-archive-transport.port.js";
import { GitHubArchiveTransportError } from "../../../infrastructure/github/github-secure-archive-http.transport.js";
import { CredentialResolutionError } from "../../../infrastructure/persistence/prisma-credential-authorization.resolver.js";
import { RepositoryProviderUnavailableError } from "../../../infrastructure/repository-provider.registry.js";
import type {
  SnapshotArchiveCache,
  SnapshotArchiveCacheCaptureInput,
  SnapshotArchiveCacheHit,
  SnapshotArchiveCacheLookup,
} from "../../../infrastructure/github/snapshot-archive-cache.js";
import { StreamSnapshotArchiveHandler } from "./stream-snapshot-archive.handler.js";
import { StreamSnapshotArchiveQuery } from "./stream-snapshot-archive.query.js";

type ScanJobFixture = {
  id: string;
  assessmentId: string;
  snapshotId: string;
  status: RepositoryScanJobStatus;
  triggerSource: string;
  idempotencyKey: string;
};

describe("StreamSnapshotArchiveHandler", () => {
  const snapshot = {
    id: "snapshot-1",
    connectionId: "connection-1",
    assessmentId: "assessment-1",
    repositoryId: "repository-1",
    repositoryFullName: "acme/example-repo",
    commitSha: "a".repeat(40),
    status: REPOSITORY_SNAPSHOT_STATUSES.ready,
  };

  const scanJob: ScanJobFixture = {
    id: "scan-job-1",
    assessmentId: "assessment-1",
    snapshotId: "snapshot-1",
    status: REPOSITORY_SCAN_JOB_STATUSES.queued,
    triggerSource: REPOSITORY_SCAN_TRIGGER_SOURCES.manual,
    idempotencyKey: "manual:scan-job-1",
  };

  const connection: {
    id: string;
    userId: string;
    provider: string;
    installationId: null;
    status: typeof REPOSITORY_CONNECTION_STATUSES.active;
    authenticationMode: RepositoryAuthenticationMode;
    providerCredentialId: string;
    repositoryId: string;
    repositoryFullName: string;
  } = {
    id: "connection-1",
    userId: "user-1",
    provider: CREDENTIAL_PROVIDERS.github,
    installationId: null,
    status: REPOSITORY_CONNECTION_STATUSES.active,
    authenticationMode: RepositoryAuthenticationMode.GITHUB_CLI_CREDENTIAL,
    providerCredentialId: "credential-1",
    repositoryId: "repository-1",
    repositoryFullName: "acme/example-repo",
  };

  function buildHandler(options?: {
    scanJob?: ScanJobFixture | null;
    snapshot?: typeof snapshot | null;
    connection?: typeof connection | null;
    azureConnection?: boolean;
    archive?: {
      contentType: string;
      redirectValidation: GitHubArchiveRedirectValidationStatus;
      validatedHost: string;
      archiveRoot?: string | null;
      treeManifest?: {
        version: 1;
        commitSha: string;
        treeId: string;
        fileCount: number;
        pathSha256: string;
      };
      stream: Readable;
    };
    archiveError?: Error;
    cacheHit?: SnapshotArchiveCacheHit | null;
    authorizationError?: Error;
    claimCount?: number;
    hydration?: boolean;
    assessmentAuthorized?: boolean;
    providerEnabled?: boolean;
  }) {
    const hasOption = <K extends keyof NonNullable<typeof options>>(
      key: K,
    ): boolean =>
      Boolean(options && Object.prototype.hasOwnProperty.call(options, key));

    const claimScanJobMock = jest
      .fn<() => Promise<{ count: number }>>()
      .mockResolvedValue({ count: options?.claimCount ?? 1 });
    const prisma = {
      assessment: {
        findFirst: jest.fn(() =>
          Promise.resolve(
            options?.assessmentAuthorized === false
              ? null
              : { id: "assessment-1" },
          ),
        ),
      },
      repositoryScanJob: {
        findUnique: jest
          .fn<() => Promise<ScanJobFixture | null | undefined>>()
          .mockResolvedValue(hasOption("scanJob") ? options?.scanJob : scanJob),
        updateMany: claimScanJobMock,
      },
      repositorySnapshot: {
        findUnique: jest
          .fn<() => Promise<typeof snapshot | null | undefined>>()
          .mockResolvedValue(
            hasOption("snapshot") ? options?.snapshot : snapshot,
          ),
      },
      repositoryConnection: {
        findUnique: jest
          .fn<() => Promise<typeof connection | null | undefined>>()
          .mockResolvedValue(
            hasOption("connection")
              ? options?.connection
              : options?.azureConnection
                ? {
                    ...connection,
                    provider: CREDENTIAL_PROVIDERS.azureDevOps,
                    authenticationMode:
                      RepositoryAuthenticationMode.AZURE_DEVOPS_CLI_CREDENTIAL,
                  }
                : connection,
          ),
      },
    } as unknown as PrismaService;

    const lease = new CredentialLease("archive-test-secret", {
      internalCredentialId: "credential-1",
      credentialVersion: 1,
      repositoryFullName: "acme/example-repo",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const disposeLease = jest.spyOn(lease, "dispose");
    const resolveForConnection = jest
      .fn<CredentialAuthorizationResolverPort["resolveForConnection"]>()
      .mockImplementation(() =>
        options?.authorizationError
          ? Promise.reject(options.authorizationError)
          : Promise.resolve(lease),
      );
    const markInvalid = jest
      .fn<CredentialAuthorizationResolverPort["markInvalid"]>()
      .mockResolvedValue();
    const credentialResolver = {
      resolveForConnection,
      markInvalid,
    } as unknown as CredentialAuthorizationResolverPort;

    const downloadRepositoryArchiveMock = jest
      .fn<GitHubArchiveTransportPort["downloadArchive"]>()
      .mockImplementation(() => {
        if (options?.archiveError) return Promise.reject(options.archiveError);
        return Promise.resolve(
          options?.archive ?? {
            contentType: "application/gzip",
            redirectValidation:
              GITHUB_ARCHIVE_REDIRECT_VALIDATION_STATUSES.verified,
            validatedHost: "codeload.github.com",
            archiveRoot: null,
            stream: Readable.from([Buffer.from("archive")]),
          },
        );
      });

    const cacheGetMock = jest
      .fn<
        (
          lookup: SnapshotArchiveCacheLookup,
        ) => Promise<SnapshotArchiveCacheHit | null>
      >()
      .mockResolvedValue(options?.cacheHit ?? null);
    const cacheCaptureMock = jest
      .fn<
        (input: SnapshotArchiveCacheCaptureInput) => Promise<{
          stream: NodeJS.ReadableStream;
          completion: Promise<void>;
        }>
      >()
      .mockImplementation((input) =>
        Promise.resolve({
          stream: input.source,
          completion: Promise.resolve(),
        }),
      );
    const snapshotArchiveCache = {
      get: cacheGetMock,
      capture: cacheCaptureMock,
    } as unknown as SnapshotArchiveCache;
    const hydrationLifecycle = {
      isHydrationTicket: (ticket: ScanJobFixture) =>
        options?.hydration === true ||
        ticket.idempotencyKey.startsWith("runtime-hydration:"),
      claim: jest
        .fn<(...args: unknown[]) => Promise<void>>()
        .mockResolvedValue(undefined),
      finalizeDelivery: jest
        .fn<(...args: unknown[]) => Promise<void>>()
        .mockResolvedValue(undefined),
    };

    return {
      handler: new StreamSnapshotArchiveHandler(
        prisma,
        snapshotArchiveCache,
        credentialResolver,
        hydrationLifecycle as never,
        {
          get: () => ({ downloadArchive: downloadRepositoryArchiveMock }),
        },
        {
          get: (provider: string) => {
            if (
              provider !== CREDENTIAL_PROVIDERS.github &&
              !options?.providerEnabled
            ) {
              throw new RepositoryProviderUnavailableError();
            }
            return {};
          },
        } as never,
      ),
      downloadRepositoryArchiveMock,
      resolveForConnection,
      cacheGetMock,
      cacheCaptureMock,
      claimScanJobMock,
      hydrationLifecycle,
      disposeLease,
      authorizationLease: lease,
    };
  }
  it("streams the pinned repository archive when scope is valid", async () => {
    const { handler, cacheCaptureMock } = buildHandler();

    const result = await handler.execute(
      new StreamSnapshotArchiveQuery("snapshot-1", "scan-job-1", "corr-1"),
    );

    expect(result.snapshotId).toBe("snapshot-1");
    expect(result.commitSha).toBe("a".repeat(40));
    expect(result.contentType).toBe("application/gzip");
    expect(cacheCaptureMock).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshotId: "snapshot-1",
        commitSha: "a".repeat(40),
      }),
    );
  });

  it("fails closed when a Bitbucket archive has unknown root semantics", async () => {
    const stream = Readable.from([Buffer.from("ambiguous-source")]);
    const { handler, cacheCaptureMock } = buildHandler({
      providerEnabled: true,
      connection: {
        ...connection,
        provider: CREDENTIAL_PROVIDERS.bitbucket,
        authenticationMode:
          RepositoryAuthenticationMode.BITBUCKET_CLI_CREDENTIAL,
      } as unknown as typeof connection,
      archive: {
        contentType: "application/zip",
        redirectValidation:
          GITHUB_ARCHIVE_REDIRECT_VALIDATION_STATUSES.verified,
        validatedHost: "api.bitbucket.org",
        stream,
      },
    });

    await expect(
      handler.execute(
        new StreamSnapshotArchiveQuery("snapshot-1", "scan-job-1", "corr-root"),
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        problem: expect.objectContaining({
          code: GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
        }),
      }),
    });
    expect(stream.destroyed).toBe(true);
    expect(cacheCaptureMock).not.toHaveBeenCalled();
  });

  it("fails closed on an Azure cache hit with unknown root metadata", async () => {
    const stream = Readable.from([Buffer.from("ambiguous-cached-source")]);
    const { handler, downloadRepositoryArchiveMock } = buildHandler({
      providerEnabled: true,
      connection: {
        ...connection,
        provider: CREDENTIAL_PROVIDERS.azureDevOps,
        authenticationMode:
          RepositoryAuthenticationMode.AZURE_DEVOPS_CLI_CREDENTIAL,
      } as unknown as typeof connection,
      cacheHit: {
        contentType: "application/zip",
        resolvedUrl:
          "https://dev.azure.com/org/project/_apis/git/repositories/id/items",
        stream,
      },
    });

    await expect(
      handler.execute(
        new StreamSnapshotArchiveQuery(
          "snapshot-1",
          "scan-job-1",
          "corr-cache-root",
        ),
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        problem: expect.objectContaining({
          code: GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
        }),
      }),
    });
    expect(stream.destroyed).toBe(true);
    expect(downloadRepositoryArchiveMock).not.toHaveBeenCalled();
  });

  it("preserves an explicitly verified rootless Azure archive on a cache hit", async () => {
    const stream = Readable.from([Buffer.from("verified-rootless-source")]);
    const { handler, downloadRepositoryArchiveMock } = buildHandler({
      providerEnabled: true,
      connection: {
        ...connection,
        provider: CREDENTIAL_PROVIDERS.azureDevOps,
        authenticationMode:
          RepositoryAuthenticationMode.AZURE_DEVOPS_CLI_CREDENTIAL,
      } as unknown as typeof connection,
      cacheHit: {
        contentType: "application/zip",
        resolvedUrl:
          "https://dev.azure.com/org/project/_apis/git/repositories/id/items",
        archiveRoot: null,
        stream,
      },
    });

    const result = await handler.execute(
      new StreamSnapshotArchiveQuery(
        "snapshot-1",
        "scan-job-1",
        "corr-rootless-cache",
      ),
    );

    expect(result.stream).toBe(stream);
    expect(result.archiveRoot).toBeNull();
    expect(downloadRepositoryArchiveMock).not.toHaveBeenCalled();
  });

  it("reuses a valid ephemeral archive for the same pinned snapshot", async () => {
    const cacheHit: SnapshotArchiveCacheHit = {
      contentType: "application/gzip",
      resolvedUrl: "https://codeload.github.com/acme/example-repo/tar.gz/a",
      archiveRoot: "trusted-wrapper",
      stream: Readable.from([Buffer.from("cached-archive")]),
    };
    const {
      handler,
      downloadRepositoryArchiveMock,
      cacheGetMock,
      resolveForConnection,
      disposeLease,
    } = buildHandler({ cacheHit });

    const result = await handler.execute(
      new StreamSnapshotArchiveQuery("snapshot-1", "scan-job-1", "corr-cache"),
    );

    expect(result.stream).toBe(cacheHit.stream);
    expect(result.archiveRoot).toBe("trusted-wrapper");
    expect(cacheGetMock).toHaveBeenCalledWith({
      snapshotId: "snapshot-1",
      commitSha: "a".repeat(40),
    });
    expect(downloadRepositoryArchiveMock).not.toHaveBeenCalled();
    expect(resolveForConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        assessmentId: "assessment-1",
      }),
      "connection-1",
      "acme/example-repo",
    );
    expect(resolveForConnection.mock.invocationCallOrder[0]).toBeLessThan(
      cacheGetMock.mock.invocationCallOrder[0],
    );
    expect(disposeLease).toHaveBeenCalledTimes(1);
  });

  it("allows an unknown Azure root only when a commit-bound tree manifest is present", async () => {
    const treeManifest = {
      version: 1 as const,
      commitSha: "a".repeat(40),
      treeId: "b".repeat(40),
      fileCount: 1,
      pathSha256: "c".repeat(64),
    };
    const { handler, cacheCaptureMock } = buildHandler({
      azureConnection: true,
      providerEnabled: true,
      archive: {
        contentType: "application/zip",
        redirectValidation:
          GITHUB_ARCHIVE_REDIRECT_VALIDATION_STATUSES.verified,
        validatedHost: "dev.azure.com",
        treeManifest,
        stream: Readable.from([Buffer.from("zip")]),
      },
    });

    const result = await handler.execute(
      new StreamSnapshotArchiveQuery("snapshot-1", "scan-job-1", "corr-tree"),
    );

    expect(result.archiveRoot).toBeUndefined();
    expect(result.archiveRootStatus).toBe("UNKNOWN");
    expect(result.treeManifest).toEqual(treeManifest);
    expect(cacheCaptureMock).toHaveBeenCalledWith(
      expect.objectContaining({ treeManifest }),
    );
  });

  it("rejects a revoked credential before looking up a cached archive", async () => {
    const cacheHit: SnapshotArchiveCacheHit = {
      contentType: "application/gzip",
      resolvedUrl: "https://codeload.github.com/acme/example-repo/tar.gz/a",
      archiveRoot: null,
      stream: Readable.from([Buffer.from("must-not-deliver")]),
    };
    const { handler, cacheGetMock, downloadRepositoryArchiveMock } =
      buildHandler({
        cacheHit,
        authorizationError: new CredentialResolutionError(
          GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid,
        ),
      });

    let rejection: unknown;
    try {
      await handler.execute(
        new StreamSnapshotArchiveQuery(
          "snapshot-1",
          "scan-job-1",
          "corr-revoked",
        ),
      );
    } catch (error: unknown) {
      rejection = error;
    }

    expect(rejection).toBeInstanceOf(HttpException);
    expect((rejection as HttpException).getStatus()).toBe(401);
    expect(cacheGetMock).not.toHaveBeenCalled();
    expect(downloadRepositoryArchiveMock).not.toHaveBeenCalled();
  });

  it.each([
    GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid,
    GITHUB_CREDENTIAL_ERROR_CODES.credentialExpired,
  ])("rejects %s before a cache miss can retrieve source", async (code) => {
    const { handler, cacheGetMock, downloadRepositoryArchiveMock } =
      buildHandler({
        authorizationError: new CredentialResolutionError(code),
      });

    await expect(
      handler.execute(
        new StreamSnapshotArchiveQuery(
          "snapshot-1",
          "scan-job-1",
          "corr-stale-authorization",
        ),
      ),
    ).rejects.toBeInstanceOf(HttpException);

    expect(cacheGetMock).not.toHaveBeenCalled();
    expect(downloadRepositoryArchiveMock).not.toHaveBeenCalled();
  });

  it("allows an archive delivery already authorized before disconnect to finish", async () => {
    const cacheHit: SnapshotArchiveCacheHit = {
      contentType: "application/gzip",
      resolvedUrl: "https://codeload.github.com/acme/example-repo/tar.gz/a",
      archiveRoot: "trusted-root",
      stream: Readable.from([Buffer.from("authorized-before-revoke")]),
    };
    const {
      handler,
      resolveForConnection,
      cacheGetMock,
      authorizationLease,
      disposeLease,
    } = buildHandler({ cacheHit });
    let authorizationLinearized = false;
    let revocationCommitted = false;
    resolveForConnection.mockImplementation(() => {
      authorizationLinearized = true;
      return Promise.resolve(authorizationLease);
    });
    cacheGetMock.mockImplementation(() => {
      expect(authorizationLinearized).toBe(true);
      revocationCommitted = true;
      return Promise.resolve(cacheHit);
    });

    const result = await handler.execute(
      new StreamSnapshotArchiveQuery("snapshot-1", "scan-job-1", "corr-race"),
    );

    expect(revocationCommitted).toBe(true);
    expect(result.stream).toBe(cacheHit.stream);
    expect(disposeLease).toHaveBeenCalledTimes(1);
  });

  it("rejects a scan job whose assessment differs from the pinned snapshot", async () => {
    const { handler, resolveForConnection, cacheGetMock } = buildHandler({
      snapshot: { ...snapshot, assessmentId: "assessment-other" },
    });

    await expect(
      handler.execute(
        new StreamSnapshotArchiveQuery(
          "snapshot-1",
          "scan-job-1",
          "corr-binding",
        ),
      ),
    ).rejects.toBeDefined();

    expect(resolveForConnection).not.toHaveBeenCalled();
    expect(cacheGetMock).not.toHaveBeenCalled();
  });

  it("rejects a source request when the assessment owner no longer matches the connection", async () => {
    const { handler, resolveForConnection, cacheGetMock } = buildHandler({
      assessmentAuthorized: false,
    });

    await expect(
      handler.execute(
        new StreamSnapshotArchiveQuery(
          "snapshot-1",
          "scan-job-1",
          "corr-owner",
        ),
      ),
    ).rejects.toBeDefined();

    expect(resolveForConnection).not.toHaveBeenCalled();
    expect(cacheGetMock).not.toHaveBeenCalled();
  });

  it("blocks a disabled provider before authorization, cache lookup, or archive retrieval", async () => {
    const {
      handler,
      resolveForConnection,
      cacheGetMock,
      downloadRepositoryArchiveMock,
    } = buildHandler({
      connection: {
        ...connection,
        provider: CREDENTIAL_PROVIDERS.bitbucket,
        authenticationMode:
          RepositoryAuthenticationMode.BITBUCKET_CLI_CREDENTIAL,
      } as unknown as typeof connection,
    });

    await expect(
      handler.execute(
        new StreamSnapshotArchiveQuery(
          "snapshot-1",
          "scan-job-1",
          "corr-disabled",
        ),
      ),
    ).rejects.toBeDefined();

    expect(resolveForConnection).not.toHaveBeenCalled();
    expect(cacheGetMock).not.toHaveBeenCalled();
    expect(downloadRepositoryArchiveMock).not.toHaveBeenCalled();
  });

  it("claims a runtime-hydration ticket but leaves success finalization to HTTP delivery", async () => {
    const hydrationTicket = {
      ...scanJob,
      status: REPOSITORY_SCAN_JOB_STATUSES.queued,
      triggerSource: REPOSITORY_SCAN_TRIGGER_SOURCES.trusted,
      idempotencyKey: "runtime-hydration:assessment-1:snapshot-1",
    };
    const { handler, hydrationLifecycle } = buildHandler({
      scanJob: hydrationTicket,
    });

    const result = await handler.execute(
      new StreamSnapshotArchiveQuery(
        "snapshot-1",
        hydrationTicket.id,
        "corr-hydration",
      ),
    );

    expect(hydrationLifecycle.claim).toHaveBeenCalledWith(
      hydrationTicket.id,
      hydrationTicket.assessmentId,
      "snapshot-1",
      REPOSITORY_SCAN_JOB_STATUSES.queued,
    );
    expect(result.hydrationDeliveryTicketId).toBe(hydrationTicket.id);
    expect(hydrationLifecycle.finalizeDelivery).not.toHaveBeenCalled();
  });

  it("reuses successful hydration tickets for future pinned archive reads", async () => {
    const hydrationTicket = {
      ...scanJob,
      status: REPOSITORY_SCAN_JOB_STATUSES.completed,
      triggerSource: REPOSITORY_SCAN_TRIGGER_SOURCES.trusted,
      idempotencyKey: "runtime-hydration:assessment-1:snapshot-1",
    };
    const { handler, hydrationLifecycle } = buildHandler({
      scanJob: hydrationTicket,
    });

    const result = await handler.execute(
      new StreamSnapshotArchiveQuery(
        "snapshot-1",
        hydrationTicket.id,
        "corr-reuse",
      ),
    );

    expect(result.hydrationDeliveryTicketId).toBeUndefined();
    expect(hydrationLifecycle.claim).not.toHaveBeenCalled();
  });

  it("allows a failed hydration ticket to be retried", async () => {
    const hydrationTicket = {
      ...scanJob,
      status: REPOSITORY_SCAN_JOB_STATUSES.failed,
      triggerSource: REPOSITORY_SCAN_TRIGGER_SOURCES.trusted,
      idempotencyKey: "runtime-hydration:assessment-1:snapshot-1",
    };
    const { handler, hydrationLifecycle } = buildHandler({
      scanJob: hydrationTicket,
    });

    const result = await handler.execute(
      new StreamSnapshotArchiveQuery(
        "snapshot-1",
        hydrationTicket.id,
        "corr-retry",
      ),
    );

    expect(hydrationLifecycle.claim).toHaveBeenCalledWith(
      hydrationTicket.id,
      hydrationTicket.assessmentId,
      "snapshot-1",
      REPOSITORY_SCAN_JOB_STATUSES.failed,
    );
    expect(result.hydrationDeliveryTicketId).toBe(hydrationTicket.id);
  });

  it("terminalizes a claimed hydration attempt when archive acquisition fails", async () => {
    const hydrationTicket = {
      ...scanJob,
      triggerSource: REPOSITORY_SCAN_TRIGGER_SOURCES.trusted,
      idempotencyKey: "runtime-hydration:assessment-1:snapshot-1",
    };
    const { handler, hydrationLifecycle } = buildHandler({
      scanJob: hydrationTicket,
      archiveError: new Error("provider failure"),
    });

    await expect(
      handler.execute(
        new StreamSnapshotArchiveQuery(
          "snapshot-1",
          hydrationTicket.id,
          "corr-failed",
        ),
      ),
    ).rejects.toBeInstanceOf(HttpException);
    expect(hydrationLifecycle.finalizeDelivery).toHaveBeenCalledWith({
      ticketId: hydrationTicket.id,
      snapshotId: "snapshot-1",
      outcome: REPOSITORY_SCAN_JOB_STATUSES.failed,
    });
  });

  it("rejects snapshot and scan job mismatch", async () => {
    const { handler } = buildHandler({
      scanJob: { ...scanJob, snapshotId: "snapshot-other" },
    });

    await expect(
      handler.execute(
        new StreamSnapshotArchiveQuery("snapshot-1", "scan-job-1", "corr-1"),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("claims a queued scan job before streaming its archive", async () => {
    const { handler, claimScanJobMock } = buildHandler();

    await expect(
      handler.execute(
        new StreamSnapshotArchiveQuery("snapshot-1", "scan-job-1", "corr-1"),
      ),
    ).resolves.toMatchObject({ snapshotId: "snapshot-1" });
    expect(claimScanJobMock).toHaveBeenCalledTimes(1);
  });

  it("allows a completed scan to reuse its immutable pinned archive without reclaiming", async () => {
    const { handler, claimScanJobMock } = buildHandler({
      scanJob: {
        ...scanJob,
        status: RepositoryScanJobStatus.COMPLETED,
      },
    });

    await expect(
      handler.execute(
        new StreamSnapshotArchiveQuery(
          "snapshot-1",
          "scan-job-1",
          "corr-completed",
        ),
      ),
    ).resolves.toMatchObject({
      snapshotId: "snapshot-1",
      commitSha: "a".repeat(40),
    });
    expect(claimScanJobMock).not.toHaveBeenCalled();
  });

  it("rejects a queued scan job claimed by another worker", async () => {
    const { handler } = buildHandler({ claimCount: 0 });

    await expect(
      handler.execute(
        new StreamSnapshotArchiveQuery("snapshot-1", "scan-job-1", "corr-1"),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("rejects missing snapshot scope", async () => {
    const { handler } = buildHandler({ snapshot: null });

    await expect(
      handler.execute(
        new StreamSnapshotArchiveQuery("snapshot-1", "scan-job-1", "corr-1"),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([undefined, "UNKNOWN_MODE"])(
    "fails closed for an unsupported archive authentication mode %s",
    async (mode) => {
      const fixture = buildHandler({
        connection: {
          ...connection,
          authenticationMode: mode,
        } as typeof connection,
      });
      await expect(
        fixture.handler.execute(
          new StreamSnapshotArchiveQuery(
            "snapshot-1",
            "scan-job-1",
            "corr-mode",
          ),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(fixture.downloadRepositoryArchiveMock).not.toHaveBeenCalled();
    },
  );

  it("maps archive retrieval failure to bad gateway", async () => {
    const loggerError = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    const { handler, disposeLease } = buildHandler({
      archiveError: new GitHubArchiveTransportError(
        GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
        404,
      ),
    });

    await expect(
      handler.execute(
        new StreamSnapshotArchiveQuery("snapshot-1", "scan-job-1", "corr-1"),
      ),
    ).rejects.toBeInstanceOf(BadGatewayException);

    expect(loggerError).toHaveBeenCalledWith(
      "Repository snapshot archive retrieval failed: PROVIDER_RESPONSE_INVALID",
      undefined,
      expect.objectContaining({
        correlationId: "corr-1",
        providerStatus: 404,
        repositoryFullName: "acme/example-repo",
        scanJobId: "scan-job-1",
        snapshotId: "snapshot-1",
      }),
    );
    expect(disposeLease).toHaveBeenCalledTimes(1);
    loggerError.mockRestore();
  });

  it("disposes the credential lease when archive delivery is cancelled", async () => {
    const { handler, disposeLease } = buildHandler({
      archiveError: new GitHubArchiveTransportError(
        GITHUB_CREDENTIAL_ERROR_CODES.operationCancelled,
      ),
    });

    await expect(
      handler.execute(
        new StreamSnapshotArchiveQuery(
          "snapshot-1",
          "scan-job-1",
          "corr-cancelled",
        ),
      ),
    ).rejects.toMatchObject({ status: 499 });
    expect(disposeLease).toHaveBeenCalledTimes(1);
  });

  it("preserves GitHub 429 so the worker can apply rate-limit backoff", async () => {
    const loggerError = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    const { handler } = buildHandler({
      archiveError: new GitHubArchiveTransportError(
        GITHUB_CREDENTIAL_ERROR_CODES.providerRateLimited,
        429,
      ),
    });

    let thrown: unknown;
    try {
      await handler.execute(
        new StreamSnapshotArchiveQuery("snapshot-1", "scan-job-1", "corr-429"),
      );
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(HttpException);
    expect((thrown as HttpException).getStatus()).toBe(429);
    loggerError.mockRestore();
  });
});
