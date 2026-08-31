import { describe, expect, it, jest } from "@jest/globals";
import {
  RepositoryAuthenticationMode,
  RepositoryConnectionStatus,
} from "@prisma/client";

import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { RepositoryConnection } from "../../domain/entities/repository-connection.entity.js";
import { PrismaRepositoryConnectionRepository } from "./prisma-github-integration.repository.js";

describe("PrismaRepositoryConnectionRepository authentication mode", () => {
  it("continues saving App connections with installation identity", async () => {
    const upsert = jest.fn<(input: unknown) => Promise<object>>(() =>
      Promise.resolve({}),
    );
    const repository = new PrismaRepositoryConnectionRepository({
      repositoryConnection: { upsert },
    } as unknown as PrismaService);
    const connection = RepositoryConnection.create({
      assessmentId: null,
      userId: "manager-1",
      installationId: "installation-1",
      repositoryId: "100",
      repositoryName: "repo",
      repositoryFullName: "owner/repo",
      defaultBranch: "main",
      permissions: { contents: "read" },
    });
    await repository.save(connection);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          installationId: "installation-1",
          authenticationMode: RepositoryAuthenticationMode.GITHUB_APP,
        }),
      }),
    );
  });

  it("rehydrates backfilled App rows without changing installation behavior", async () => {
    const findUnique = jest.fn(() =>
      Promise.resolve({
        id: "connection-1",
        assessmentId: null,
        userId: "manager-1",
        installationId: "installation-1",
        authenticationMode: RepositoryAuthenticationMode.GITHUB_APP,
        repositoryId: "100",
        repositoryName: "repo",
        repositoryFullName: "owner/repo",
        defaultBranch: "main",
        permissions: { contents: "read" },
        status: RepositoryConnectionStatus.ACTIVE,
        connectedAt: new Date(0),
        revokedAt: null,
      }),
    );
    const repository = new PrismaRepositoryConnectionRepository({
      repositoryConnection: { findUnique },
    } as unknown as PrismaService);
    const connection = await repository.findById("connection-1");
    expect(connection?.installationId).toBe("installation-1");
  });
});
