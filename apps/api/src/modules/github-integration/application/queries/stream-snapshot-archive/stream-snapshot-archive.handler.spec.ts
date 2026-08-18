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
  REPOSITORY_CONNECTION_STATUSES,
  REPOSITORY_SCAN_JOB_STATUSES,
  REPOSITORY_SNAPSHOT_STATUSES,
} from "@lcsp/contracts/github-integration";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import {
  GitHubAppClientError,
  type GitHubAppClient,
} from "../../../infrastructure/github/github-app.client.js";
import type {
  SnapshotArchiveCache,
  SnapshotArchiveCacheHit,
} from "../../../infrastructure/github/snapshot-archive-cache.js";
import { StreamSnapshotArchiveHandler } from "./stream-snapshot-archive.handler.js";
import { StreamSnapshotArchiveQuery } from "./stream-snapshot-archive.query.js";

describe("StreamSnapshotArchiveHandler", () => {
  const snapshot = {
    id: "snapshot-1",
    organizationId: "org-1",
    connectionId: "connection-1",
    repositoryFullName: "acme/example-repo",
    commitSha: "a".repeat(40),
    status: REPOSITORY_SNAPSHOT_STATUSES.ready,
  };

  const scanJob = {
    id: "scan-job-1",
    snapshotId: "snapshot-1",
    organizationId: "org-1",
    status: REPOSITORY_SCAN_JOB_STATUSES.queued,
  };

  const connection = {
    id: "connection-1",
    installationId: "installation-1",
    organizationId: "org-1",
    status: REPOSITORY_CONNECTION_STATUSES.active,
  };

  function buildHandler(options?: {
    scanJob?: typeof scanJob | null;
    snapshot?: typeof snapshot | null;
    connection?: typeof connection | null;
    archive?: {
      contentType: string;
      resolvedUrl: string;
      stream: NodeJS.ReadableStream;
    };
    archiveError?: Error;
    cacheHit?: SnapshotArchiveCacheHit | null;
    claimCount?: number;
  }) {
    const hasOption = <K extends keyof NonNullable<typeof options>>(
      key: K,
    ): boolean =>
      Boolean(options && Object.prototype.hasOwnProperty.call(options, key));

    const prisma = {
      repositoryScanJob: {
        findUnique: jest
          .fn<() => Promise<typeof scanJob | null | undefined>>()
          .mockResolvedValue(hasOption("scanJob") ? options?.scanJob : scanJob),
        updateMany: jest
          .fn<() => Promise<{ count: number }>>()
          .mockResolvedValue({ count: options?.claimCount ?? 1 }),
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
            hasOption("connection") ? options?.connection : connection,
          ),
      },
    } as unknown as PrismaService;

    const downloadRepositoryArchiveMock = jest.fn().mockImplementation(() => {
      if (options?.archiveError) throw options.archiveError;
      return (
        options?.archive ?? {
          contentType: "application/gzip",
          resolvedUrl: "https://codeload.github.com/acme/example-repo/tar.gz/a",
          stream: Readable.from([Buffer.from("archive")]),
        }
      );
    });
    const githubAppClient = {
      downloadRepositoryArchive: downloadRepositoryArchiveMock,
    } as unknown as GitHubAppClient;

    const cacheGetMock = jest
      .fn<() => Promise<SnapshotArchiveCacheHit | null>>()
      .mockResolvedValue(options?.cacheHit ?? null);
    const cacheCaptureMock = jest
      .fn<
        (input: { source: NodeJS.ReadableStream }) => Promise<{
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

    return {
      handler: new StreamSnapshotArchiveHandler(
        prisma,
        githubAppClient,
        snapshotArchiveCache,
      ),
      downloadRepositoryArchiveMock,
      cacheGetMock,
      cacheCaptureMock,
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

  it("reuses a valid ephemeral archive for the same pinned snapshot", async () => {
    const cacheHit: SnapshotArchiveCacheHit = {
      contentType: "application/gzip",
      resolvedUrl: "https://codeload.github.com/acme/example-repo/tar.gz/a",
      stream: Readable.from([Buffer.from("cached-archive")]),
    };
    const { handler, downloadRepositoryArchiveMock, cacheGetMock } =
      buildHandler({
        cacheHit,
      });

    const result = await handler.execute(
      new StreamSnapshotArchiveQuery("snapshot-1", "scan-job-1", "corr-cache"),
    );

    expect(result.stream).toBe(cacheHit.stream);
    expect(cacheGetMock).toHaveBeenCalledWith({
      snapshotId: "snapshot-1",
      commitSha: "a".repeat(40),
    });
    expect(downloadRepositoryArchiveMock).not.toHaveBeenCalled();
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
    const { handler } = buildHandler();

    await expect(
      handler.execute(
        new StreamSnapshotArchiveQuery("snapshot-1", "scan-job-1", "corr-1"),
      ),
    ).resolves.toMatchObject({ snapshotId: "snapshot-1" });
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

  it("maps archive retrieval failure to bad gateway", async () => {
    const loggerError = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    const { handler } = buildHandler({
      archiveError: new GitHubAppClientError(
        "github_repository_archive_failed",
        404,
      ),
    });

    await expect(
      handler.execute(
        new StreamSnapshotArchiveQuery("snapshot-1", "scan-job-1", "corr-1"),
      ),
    ).rejects.toBeInstanceOf(BadGatewayException);

    expect(loggerError).toHaveBeenCalledWith(
      "GitHub snapshot archive retrieval failed: github_repository_archive_failed",
      undefined,
      expect.objectContaining({
        correlationId: "corr-1",
        githubStatus: 404,
        repositoryFullName: "acme/example-repo",
        scanJobId: "scan-job-1",
        snapshotId: "snapshot-1",
      }),
    );
    loggerError.mockRestore();
  });

  it("preserves GitHub 429 so the worker can apply rate-limit backoff", async () => {
    const loggerError = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    const { handler } = buildHandler({
      archiveError: new GitHubAppClientError(
        "github_repository_archive_failed",
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
