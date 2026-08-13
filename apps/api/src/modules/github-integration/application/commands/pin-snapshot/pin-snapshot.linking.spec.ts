import {
  GITHUB_REPOSITORY_PERMISSION_LEVELS,
  REPOSITORY_CONNECTION_STATUSES,
} from "@lcsp/contracts/github-integration";
import { SUBJECT_ROLES } from "@lcsp/contracts/pbac";
import { describe, expect, it, jest } from "@jest/globals";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { RepositoryConnection } from "../../../domain/entities/repository-connection.entity.js";
import type { GitHubAppClient } from "../../../infrastructure/github/github-app.client.js";
import type { RepositoryConnectionRepository } from "../../ports/persistence/repository-connection.repository.js";
import type { RepositorySnapshotRepository } from "../../ports/persistence/repository-snapshot.repository.js";
import { PinSnapshotCommand } from "./pin-snapshot.command.js";
import { PinSnapshotHandler } from "./pin-snapshot.handler.js";

describe("PinSnapshotHandler repository reuse", () => {
  it("keeps the repository reusable and links the assessment through its snapshot", async () => {
    const repositoryConnection = RepositoryConnection.rehydrate({
      id: "connection-1",
      assessmentId: null,
      organizationId: "org-1",
      userId: "manager-1",
      installationId: "installation-1",
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
      save: jest
        .fn<RepositoryConnectionRepository["save"]>()
        .mockResolvedValue(undefined),
    } as RepositoryConnectionRepository;

    const saveWithCreatedEvent = jest
      .fn<RepositorySnapshotRepository["saveWithCreatedEvent"]>()
      .mockResolvedValue(undefined);
    const snapshotRepository = {
      saveWithCreatedEvent,
    } as RepositorySnapshotRepository;

    const resolveCommit = jest
      .fn<GitHubAppClient["resolveCommit"]>()
      .mockResolvedValue({
        sha: "a".repeat(40),
        repositoryFullName: "acme/example-repo",
        htmlUrl: `https://github.com/acme/example-repo/commit/${"a".repeat(40)}`,
        authorDate: "2026-08-09T00:00:00.000Z",
        committerDate: "2026-08-09T00:00:01.000Z",
      });
    const githubAppClient = { resolveCommit } as unknown as GitHubAppClient;

    const prisma = {
      assessment: {
        findUnique: jest
          .fn<
            () => Promise<{
              id: string;
              organizationId: string;
              ownerId: string;
            } | null>
          >()
          .mockResolvedValue({
            id: "assessment-1",
            organizationId: "org-1",
            ownerId: "manager-1",
          }),
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
      githubAppClient,
      prisma,
      auditWriter,
    );

    await handler.execute(
      new PinSnapshotCommand(
        "assessment-1",
        "org-1",
        "manager-1",
        SUBJECT_ROLES.manager,
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
