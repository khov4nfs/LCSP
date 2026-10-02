import { describe, expect, it, jest } from "@jest/globals";
import {
  RepositoryAuthenticationMode,
  RepositoryConnectionStatus,
} from "@prisma/client";
import { REPOSITORY_AUTHENTICATION_MODES } from "@lcsp/contracts/github-integration";

import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { PrismaRepositoryConnectionRepository } from "./prisma-github-integration.repository.js";

describe("PrismaRepositoryConnectionRepository authentication mode", () => {
  it("rehydrates legacy GitHub App rows so callers can fail them explicitly", async () => {
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
    expect(connection?.authenticationMode).toBe(
      REPOSITORY_AUTHENTICATION_MODES.githubApp,
    );
  });
});
