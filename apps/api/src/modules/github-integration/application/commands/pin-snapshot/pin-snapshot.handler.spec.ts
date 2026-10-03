import { describe, expect, it, jest } from "@jest/globals";
import {
  GITHUB_CREDENTIAL_ERROR_CODES,
  GITHUB_INTEGRATION_ERROR_CODES,
  GITHUB_INTEGRATION_EVENT_TYPES,
  GITHUB_REPOSITORY_PERMISSION_LEVELS,
  REPOSITORY_SNAPSHOT_STATUSES,
  REPOSITORY_AUTHENTICATION_MODES,
} from "@lcsp/contracts/github-integration";
import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";

import { REPOSITORY_CONNECTION_STATUSES } from "@lcsp/contracts/github-integration";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  ASSESSMENT_STATUS_CODES,
  type AssessmentStatusCode,
} from "@lcsp/contracts/assessment";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { RepositoryConnection } from "../../../domain/entities/repository-connection.entity.js";
import { GitHubCliProviderError } from "../../../infrastructure/github/github-cli-repository.provider.js";
import type { RepositoryConnectionRepository } from "../../ports/persistence/repository-connection.repository.js";
import type { RepositorySnapshotRepository } from "../../ports/persistence/repository-snapshot.repository.js";
import type { CredentialAuthorizationResolverPort } from "../../ports/security/credential-authorization-resolver.port.js";
import type { GitHubRepositoryProviderPort } from "../../ports/github-repository-provider.port.js";
import { CredentialLease } from "../../security/credential-lease.js";
import { PinSnapshotCommand } from "./pin-snapshot.command.js";
import { PinSnapshotHandler } from "./pin-snapshot.handler.js";

function connection(overrides?: {
  assessmentId?: string | null;
  status?:
    | typeof REPOSITORY_CONNECTION_STATUSES.active
    | typeof REPOSITORY_CONNECTION_STATUSES.revoked;
}) {
  return RepositoryConnection.rehydrate({
    id: "connection-1",
    assessmentId: overrides?.assessmentId ?? "assessment-1",
    userId: "manager-1",
    installationId: null,
    authenticationMode: REPOSITORY_AUTHENTICATION_MODES.githubCliCredential,
    providerCredentialId: "credential-1",
    credentialVersion: 1,
    credentialAuthorizationStatus: "ACTIVE",
    repositoryId: "repo-1",
    repositoryName: "example-repo",
    repositoryFullName: "acme/example-repo",
    defaultBranch: "main",
    permissions: { contents: GITHUB_REPOSITORY_PERMISSION_LEVELS.read },
    status: overrides?.status ?? REPOSITORY_CONNECTION_STATUSES.active,
    connectedAt: new Date("2026-07-18T00:00:00.000Z"),
    revokedAt: null,
  });
}

function command(overrides?: Partial<PinSnapshotCommand>) {
  return new PinSnapshotCommand(
    overrides?.assessmentId ?? "assessment-1",
    overrides?.actorId ?? "manager-1",
    overrides?.subjectRole ?? AUTH_USER_ROLES.customer,
    overrides?.scope,
    overrides?.connectionId ?? "connection-1",
    overrides?.branch,
    overrides?.ref,
    overrides?.commitSha,
    overrides?.correlationId ?? "corr-1",
  );
}

function buildHandler(options?: {
  connection?: RepositoryConnection | null;
  assessment?: {
    id: string;
    ownerId: string;
    status: AssessmentStatusCode;
  } | null;
  resolveError?: Error;
  resolvedRepositoryFullName?: string;
}) {
  const findById = jest
    .fn<RepositoryConnectionRepository["findById"]>()
    .mockResolvedValue(
      options?.connection === undefined ? connection() : options.connection,
    );
  const connectionRepository = {
    findById,
    linkToAssessment: jest
      .fn<RepositoryConnectionRepository["linkToAssessment"]>()
      .mockResolvedValue(true),
  } as RepositoryConnectionRepository;

  const saveWithCreatedEvent = jest
    .fn<RepositorySnapshotRepository["saveWithCreatedEvent"]>()
    .mockResolvedValue(undefined);
  const snapshotRepository = {
    saveWithCreatedEvent,
  } as RepositorySnapshotRepository;

  const lease = new CredentialLease("github_pat_test_lease_secret", {
    internalCredentialId: "credential-1",
    credentialVersion: 1,
    repositoryFullName: "acme/example-repo",
    expiresAt: new Date(Date.now() + 60_000),
  });
  const resolveCommit = jest
    .fn<GitHubRepositoryProviderPort["resolveCommit"]>()
    .mockImplementation(() => {
      if (options?.resolveError) return Promise.reject(options.resolveError);
      return Promise.resolve({
        sha: "a".repeat(40),
        repositoryFullName:
          options?.resolvedRepositoryFullName ?? "acme/example-repo",
        htmlUrl: `https://github.com/acme/example-repo/commit/${"a".repeat(40)}`,
        authorDate: "2026-07-18T00:00:00.000Z",
        committerDate: "2026-07-18T00:00:01.000Z",
      });
    });
  const credentialResolver = {
    resolveForConnection: jest.fn(() => Promise.resolve(lease)),
    markInvalid: jest.fn(() => Promise.resolve()),
  } as unknown as CredentialAuthorizationResolverPort;
  const githubRepositoryProvider = {
    resolveCommit,
  } as unknown as GitHubRepositoryProviderPort;

  const findUnique = jest
    .fn<
      () => Promise<{
        id: string;
        ownerId: string;
        status: AssessmentStatusCode;
      } | null>
    >()
    .mockResolvedValue(
      options?.assessment === undefined
        ? {
            id: "assessment-1",
            ownerId: "manager-1",
            status: ASSESSMENT_STATUS_CODES.wizardInProgress,
          }
        : options.assessment,
    );
  const prisma = {
    assessment: {
      findUnique,
      updateMany: jest
        .fn<PrismaService["assessment"]["updateMany"]>()
        .mockResolvedValue({ count: 1 }),
    },
  } as unknown as PrismaService;

  const write = jest
    .fn<AuditWriterService["write"]>()
    .mockResolvedValue(undefined);
  const auditWriter = { write } as unknown as AuditWriterService;

  return {
    handler: new PinSnapshotHandler(
      connectionRepository,
      snapshotRepository,
      credentialResolver,
      githubRepositoryProvider,
      prisma,
      auditWriter,
    ),
    findById,
    saveWithCreatedEvent,
    resolveCommit,
    write,
    lease,
  };
}

describe("PinSnapshotHandler", () => {
  it("pins a branch to an immutable SHA and emits safe snapshot metadata", async () => {
    const { handler, resolveCommit, saveWithCreatedEvent, write, lease } =
      buildHandler();

    const result = await handler.execute(command({ branch: "main" }));

    expect(resolveCommit).toHaveBeenCalledWith(
      lease,
      "acme/example-repo",
      "main",
    );
    expect(result).toMatchObject({
      repository_full_name: "acme/example-repo",
      commit_sha: "a".repeat(40),
      branch: "main",
      status: REPOSITORY_SNAPSHOT_STATUSES.ready,
      correlationId: "corr-1",
    });
    expect(saveWithCreatedEvent).toHaveBeenCalledTimes(1);
    const [snapshot, event] = saveWithCreatedEvent.mock.calls[0];
    expect(snapshot.providerMetadata).toEqual({
      authorDate: "2026-07-18T00:00:00.000Z",
      committerDate: "2026-07-18T00:00:01.000Z",
      htmlUrl: `https://github.com/acme/example-repo/commit/${"a".repeat(40)}`,
      requestedRevision: "main",
    });
    expect(snapshot.providerMetadata).not.toHaveProperty("source");
    expect(event).toMatchObject({
      eventType: GITHUB_INTEGRATION_EVENT_TYPES.snapshotCreated,
      payload: {
        assessmentId: "assessment-1",
        commitSha: "a".repeat(40),
        connectionId: "connection-1",
        correlationId: "corr-1",
      },
    });
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: GITHUB_INTEGRATION_EVENT_TYPES.snapshotCreatedAudit,
        decision: AUDIT_DECISIONS.allow,
      }),
    );
  });

  it("uses an explicit commit SHA instead of a supplied branch", async () => {
    const { handler, resolveCommit } = buildHandler();
    const sha = "b".repeat(40);

    await handler.execute(command({ branch: "main", commitSha: sha }));

    expect(resolveCommit).toHaveBeenCalledWith(
      expect.anything(),
      "acme/example-repo",
      sha,
    );
  });

  it("rejects a malformed explicit commit SHA before calling GitHub", async () => {
    const { handler, resolveCommit, saveWithCreatedEvent } = buildHandler();

    await expect(
      handler.execute(command({ commitSha: "not-a-commit-sha" })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(resolveCommit).not.toHaveBeenCalled();
    expect(saveWithCreatedEvent).not.toHaveBeenCalled();
  });

  it("hides missing and revoked connections", async () => {
    for (const invalidConnection of [
      null,
      connection({ status: REPOSITORY_CONNECTION_STATUSES.revoked }),
    ]) {
      const { handler, resolveCommit, saveWithCreatedEvent } = buildHandler({
        connection: invalidConnection,
      });

      await expect(handler.execute(command())).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(resolveCommit).not.toHaveBeenCalled();
      expect(saveWithCreatedEvent).not.toHaveBeenCalled();
    }
  });

  it("blocks an admin even when scope does not match the assessment", async () => {
    const { handler, resolveCommit } = buildHandler();

    await expect(
      handler.execute(
        command({
          actorId: "system-admin-1",
          subjectRole: AUTH_USER_ROLES.admin,
          scope: "assessment-2",
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(resolveCommit).not.toHaveBeenCalled();
  });

  it("blocks an admin even when scope matches the assessment", async () => {
    const { handler, resolveCommit, saveWithCreatedEvent } = buildHandler();

    await expect(
      handler.execute(
        command({
          actorId: "system-admin-1",
          subjectRole: AUTH_USER_ROLES.admin,
          scope: "assessment-1",
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(resolveCommit).not.toHaveBeenCalled();
    expect(saveWithCreatedEvent).not.toHaveBeenCalled();
  });

  it("audits an unresolvable ref without creating a snapshot event", async () => {
    const { handler, saveWithCreatedEvent, write } = buildHandler({
      resolveError: new GitHubCliProviderError(
        GITHUB_CREDENTIAL_ERROR_CODES.repositoryUnavailable,
      ),
    });

    try {
      await handler.execute(command({ ref: "refs/heads/missing" }));
      throw new Error("expected rejection");
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toMatchObject({
        ok: false,
        problem: {
          code: GITHUB_CREDENTIAL_ERROR_CODES.repositoryUnavailable,
          correlationId: "corr-1",
        },
      });
    }
    expect(saveWithCreatedEvent).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: GITHUB_INTEGRATION_EVENT_TYPES.snapshotPinFailedAudit,
        decision: AUDIT_DECISIONS.deny,
        payload: expect.not.objectContaining({ source: expect.anything() }),
      }),
    );
  });

  it("reports an inaccessible repository as a credential access failure", async () => {
    const { handler, saveWithCreatedEvent, write } = buildHandler({
      resolveError: new GitHubCliProviderError(
        GITHUB_CREDENTIAL_ERROR_CODES.repositoryAccessDenied,
      ),
    });

    try {
      await handler.execute(command({ branch: "main" }));
      throw new Error("expected rejection");
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toMatchObject({
        ok: false,
        problem: {
          code: GITHUB_CREDENTIAL_ERROR_CODES.repositoryAccessDenied,
          correlationId: "corr-1",
        },
      });
    }

    expect(saveWithCreatedEvent).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          reasonCode: GITHUB_CREDENTIAL_ERROR_CODES.repositoryAccessDenied,
        }),
      }),
    );
  });

  it("rejects provider metadata that resolves outside the connected repository", async () => {
    const { handler, saveWithCreatedEvent } = buildHandler({
      resolvedRepositoryFullName: "other/repository",
    });

    try {
      await handler.execute(command({ branch: "main" }));
      throw new Error("expected rejection");
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toMatchObject({
        ok: false,
        problem: {
          code: GITHUB_INTEGRATION_ERROR_CODES.refOutOfScope,
          correlationId: "corr-1",
        },
      });
    }
    expect(saveWithCreatedEvent).not.toHaveBeenCalled();
  });
});
