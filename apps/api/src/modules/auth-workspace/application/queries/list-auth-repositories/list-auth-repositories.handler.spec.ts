import { describe, expect, it, jest } from "@jest/globals";
import { RepositoryAuthenticationMode } from "@prisma/client";
import {
  REPOSITORY_AUTHENTICATION_MODES,
  REPOSITORY_CONNECTION_STATUSES,
} from "@lcsp/contracts/github-integration";

import { ListAuthRepositoriesHandler } from "./list-auth-repositories.handler.js";
import { ListAuthRepositoriesQuery } from "./list-auth-repositories.query.js";

describe("ListAuthRepositoriesHandler authentication coexistence", () => {
  it("returns App and CLI connections without exposing credential internals", async () => {
    const base = {
      userId: "manager",
      repositoryName: "repo",
      repositoryFullName: "owner/repo",
      defaultBranch: "main",
      status: REPOSITORY_CONNECTION_STATUSES.active,
      connectedAt: new Date("2026-08-25T00:00:00.000Z"),
      revokedAt: null,
      assessmentId: null,
    };
    const prisma = {
      repositoryConnection: {
        findMany: jest.fn(() =>
          Promise.resolve([
            {
              ...base,
              id: "app",
              installationId: "installation",
              authenticationMode: RepositoryAuthenticationMode.GITHUB_APP,
            },
            {
              ...base,
              id: "cli",
              installationId: null,
              authenticationMode:
                RepositoryAuthenticationMode.GITHUB_CLI_CREDENTIAL,
            },
          ]),
        ),
      },
      assessment: { findMany: jest.fn(() => Promise.resolve([])) },
    };
    const result = await new ListAuthRepositoriesHandler(
      prisma as never,
    ).execute(
      new ListAuthRepositoriesQuery({
        userId: "manager",
      } as never),
    );

    expect(result.repositories).toEqual([
      expect.objectContaining({
        id: "app",
        authentication_mode: REPOSITORY_AUTHENTICATION_MODES.githubApp,
        installation_id: "installation",
      }),
      expect.objectContaining({
        id: "cli",
        authentication_mode:
          REPOSITORY_AUTHENTICATION_MODES.githubCliCredential,
        installation_id: null,
      }),
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /credentialAuthorization|secretLocator|providerCredential/u,
    );
  });
});
