import {
  GITHUB_REPOSITORY_PERMISSION_LEVELS,
  REPOSITORY_CONNECTION_STATUSES,
  REPOSITORY_AUTHENTICATION_MODES,
} from "@lcsp/contracts/github-integration";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  ASSESSMENT_STATUS_CODES,
  type AssessmentStatusCode,
} from "@lcsp/contracts/assessment";
import { describe, expect, it, jest } from "@jest/globals";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { RepositoryConnection } from "../../../domain/entities/repository-connection.entity.js";
import type { RepositoryConnectionRepository } from "../../ports/persistence/repository-connection.repository.js";
import type { RepositorySnapshotRepository } from "../../ports/persistence/repository-snapshot.repository.js";
import type { CredentialAuthorizationResolverPort } from "../../ports/security/credential-authorization-resolver.port.js";
import type { GitHubRepositoryProviderPort } from "../../ports/github-repository-provider.port.js";
import { CredentialLease } from "../../security/credential-lease.js";
import { PinSnapshotCommand } from "./pin-snapshot.command.js";
import { PinSnapshotHandler } from "./pin-snapshot.handler.js";

describe("PinSnapshotHandler repository reuse", () => {
  it("keeps the repository reusable and links the assessment through its snapshot", async () => {
    const repositoryConnection = RepositoryConnection.rehydrate({
      id: "connection-1",
      assessmentId: null,
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
      status: REPOSITORY_CONNECTION_STATUSES.active,
      connectedAt: new Date("2026-08-09T00:00:00.000Z"),
      revokedAt: null,
    });

    const findById = jest
      .fn<RepositoryConnectionRepository["findById"]>()
      .mockResolvedValue(repositoryConnection);
    const linkToAssessment = jest
      .fn<RepositoryConnectionRepository["linkToAssessment"]>()
      .mockResolvedValue(true);
    const connectionRepository = {
      findById,
      linkToAssessment,
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
      .mockResolvedValue({
        sha: "a".repeat(40),
        repositoryFullName: "acme/example-repo",
        htmlUrl: `https://github.com/acme/example-repo/commit/${"a".repeat(40)}`,
        authorDate: "2026-08-09T00:00:00.000Z",
        committerDate: "2026-08-09T00:00:01.000Z",
      });

    const prisma = {
      assessment: {
        findUnique: jest
          .fn<
            () => Promise<{
              id: string;
              ownerId: string;
              status: AssessmentStatusCode;
            } | null>
          >()
          .mockResolvedValue({
            id: "assessment-1",
            ownerId: "manager-1",
            status: ASSESSMENT_STATUS_CODES.wizardInProgress,
          }),
        updateMany: jest
          .fn<PrismaService["assessment"]["updateMany"]>()
          .mockResolvedValue({ count: 1 }),
      },
    } as unknown as PrismaService;

    const auditWriter = {
      write: jest
        .fn<AuditWriterService["write"]>()
        .mockResolvedValue(undefined),
    } as unknown as AuditWriterService;

    const handler = new PinSnapshotHandler(
      connectionRepository,
      snapshotRepository,
      {
        resolveForConnection: jest.fn(() => Promise.resolve(lease)),
        markInvalid: jest.fn(() => Promise.resolve()),
      } as unknown as CredentialAuthorizationResolverPort,
      { resolveCommit } as unknown as GitHubRepositoryProviderPort,
      prisma,
      auditWriter,
    );

    await handler.execute(
      new PinSnapshotCommand(
        "assessment-1",
        "manager-1",
        AUTH_USER_ROLES.customer,
        undefined,
        "connection-1",
        "main",
        undefined,
        undefined,
        "corr-1",
      ),
    );

    expect(linkToAssessment).not.toHaveBeenCalled();
    expect(saveWithCreatedEvent).toHaveBeenCalledTimes(1);
    const snapshot = saveWithCreatedEvent.mock.calls[0]?.[0];
    expect(snapshot?.assessmentId).toBe("assessment-1");
    expect(snapshot?.connectionId).toBe("connection-1");
  });
});
