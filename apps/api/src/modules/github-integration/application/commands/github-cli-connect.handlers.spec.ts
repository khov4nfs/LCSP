/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, jest } from "@jest/globals";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  CREDENTIAL_PROVIDERS,
  GITHUB_INTEGRATION_EVENT_TYPES,
} from "@lcsp/contracts/github-integration";

import { DiscoverGitHubRepositoriesHandler } from "./discover-github-repositories/discover-github-repositories.handler.js";
import { DiscoverGitHubRepositoriesCommand } from "./discover-github-repositories/discover-github-repositories.command.js";
import { ConnectGitHubCliRepositoryHandler } from "./connect-github-cli-repository/connect-github-cli-repository.handler.js";
import { ConnectGitHubCliRepositoryCommand } from "./connect-github-cli-repository/connect-github-cli-repository.command.js";
import type { GitHubRepositoryProviderPort } from "../ports/github-repository-provider.port.js";
import type { CredentialStorageContext } from "../ports/security/credential-store.port.js";

const FAKE_PAT = "github_pat_FAKE_PHASE3_SECRET_123456789";
const identity = {
  id: "123",
  login: "manager",
  htmlUrl: "https://github.com/manager",
};
const repository = {
  id: "456",
  name: "repo",
  fullName: "owner/repo",
  defaultBranch: "main",
  private: true,
};

function provider(): jest.Mocked<GitHubRepositoryProviderPort> {
  return {
    validateIdentity: jest.fn(() => Promise.resolve(identity)),
    listAccessibleRepositories: jest.fn(() => Promise.resolve([repository])),
    validateRepositoryAccess: jest.fn(() => Promise.resolve(repository)),
    resolveCommit: jest.fn(() =>
      Promise.resolve({
        sha: "a".repeat(40),
        repositoryFullName: repository.fullName,
        htmlUrl: "https://github.com/owner/repo/commit/a",
        authorDate: null,
        committerDate: null,
      }),
    ),
    downloadArchive: jest.fn(),
  };
}

const config = { get: jest.fn(() => ({ enabled: true })) };
const auditWrite = jest.fn<(event: unknown) => Promise<void>>();
auditWrite.mockResolvedValue(undefined);
const audit = { write: auditWrite };

describe("GitHub CLI Manager lifecycle handlers", () => {
  it("loads the CLI audit event values from the runtime contracts build", () => {
    expect(
      GITHUB_INTEGRATION_EVENT_TYPES.cliRepositoryDiscoverySucceeded,
    ).toEqual(expect.any(String));
    expect(GITHUB_INTEGRATION_EVENT_TYPES.cliRepositoryConnected).toEqual(
      expect.any(String),
    );
  });

  it("discovers repositories without persisting or exposing the PAT", async () => {
    const github = provider();
    const handler = new DiscoverGitHubRepositoriesHandler(
      github,
      config as never,
      audit as never,
    );
    const result = await handler.execute(
      new DiscoverGitHubRepositoriesCommand(
        "user",
        AUTH_USER_ROLES.customer,
        "session",
        FAKE_PAT,
        50,
        undefined,
        "corr",
      ),
    );
    expect(result.repositories).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain(FAKE_PAT);
    expect(JSON.stringify(audit.write.mock.calls)).not.toContain(FAKE_PAT);
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType:
          GITHUB_INTEGRATION_EVENT_TYPES.cliRepositoryDiscoverySucceeded,
      }),
    );
  });

  it("does not misclassify an audit failure as a provider response", async () => {
    const auditFailure = new Error("safe-test-audit-failure");
    const handler = new DiscoverGitHubRepositoriesHandler(
      provider(),
      config as never,
      { write: jest.fn(() => Promise.reject(auditFailure)) } as never,
    );

    await expect(
      handler.execute(
        new DiscoverGitHubRepositoriesCommand(
          "user",
          AUTH_USER_ROLES.customer,
          "session",
          FAKE_PAT,
          1,
          undefined,
          "corr",
        ),
      ),
    ).rejects.toBe(auditFailure);
  });

  it("proves source read before atomically writing all four records", async () => {
    const github = provider();
    const createCredential = jest.fn(() => Promise.resolve());
    const store = jest.fn<
      (secret: string, context: CredentialStorageContext) => Promise<string>
    >(() => Promise.resolve("opaque-locator"));
    const createAuthorization = jest.fn(() => Promise.resolve());
    const createConnection = jest.fn<
      (input: { data: Record<string, unknown> }) => Promise<object>
    >(() => Promise.resolve({}));
    const unitOfWork = {
      execute: jest.fn((work: (tx: unknown) => Promise<unknown>) =>
        work({
          providerCredentials: { create: createCredential },
          credentialStore: { store },
          authorizations: { create: createAuthorization },
          database: { repositoryConnection: { create: createConnection } },
        }),
      ),
    };
    const prisma = {
      assessment: {
        findFirst: jest.fn(() => Promise.resolve({ id: "assessment" })),
      },
      repositoryConnection: { findFirst: jest.fn(() => Promise.resolve(null)) },
    };
    const handler = new ConnectGitHubCliRepositoryHandler(
      github,
      config as never,
      prisma as never,
      unitOfWork as never,
      audit as never,
    );
    const result = await handler.execute(
      new ConnectGitHubCliRepositoryCommand(
        "user",
        AUTH_USER_ROLES.customer,
        "session",
        FAKE_PAT,
        undefined,
        "assessment",
        undefined,
        "corr",
        CREDENTIAL_PROVIDERS.github,
        "https://github.com/owner/repo.git/",
      ),
    );
    expect(github.resolveCommit.mock.calls).toContainEqual([
      expect.anything(),
      "owner/repo",
      "main",
    ]);
    expect(createCredential).toHaveBeenCalledTimes(1);
    expect(store).toHaveBeenCalledWith(
      FAKE_PAT,
      expect.objectContaining({ ownerUserId: "user" }),
    );
    expect(createAuthorization).not.toHaveBeenCalled();
    expect(createConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          installationId: null,
          providerCredentialId: expect.any(String),
          credentialVersion: 1,
          credentialAuthorizationStatus: "ACTIVE",
          credentialAuthorizedByUserId: "user",
        }),
      }),
    );
    expect(JSON.stringify(result)).not.toContain(FAKE_PAT);
    expect(JSON.stringify(audit.write.mock.calls)).not.toContain(FAKE_PAT);
  });

  it("rejects a provider/URL mismatch before provider access", async () => {
    const github = provider();
    const handler = new ConnectGitHubCliRepositoryHandler(
      github,
      config as never,
      { assessment: { findFirst: jest.fn() } } as never,
      { execute: jest.fn() } as never,
      audit as never,
    );

    await expect(
      handler.execute(
        new ConnectGitHubCliRepositoryCommand(
          "user",
          AUTH_USER_ROLES.customer,
          "session",
          FAKE_PAT,
          undefined,
          undefined,
          undefined,
          "corr",
          `${CREDENTIAL_PROVIDERS.github}_UNSUPPORTED`,
          "https://gitlab.com/owner/repo",
        ),
      ),
    ).rejects.toThrow();
    expect(github.validateIdentity).not.toHaveBeenCalled();
  });

  it("does not enter persistence when source-read validation fails", async () => {
    const github = provider();
    github.resolveCommit.mockRejectedValueOnce(new Error("provider failed"));
    const execute = jest.fn();
    const handler = new ConnectGitHubCliRepositoryHandler(
      github,
      config as never,
      {
        assessment: { findFirst: jest.fn() },
        repositoryConnection: { findFirst: jest.fn() },
      } as never,
      { execute } as never,
      audit as never,
    );
    await expect(
      handler.execute(
        new ConnectGitHubCliRepositoryCommand(
          "user",
          AUTH_USER_ROLES.customer,
          "session",
          FAKE_PAT,
          "owner/repo",
          undefined,
          undefined,
          "corr",
        ),
      ),
    ).rejects.not.toThrow(FAKE_PAT);
    expect(execute).not.toHaveBeenCalled();
  });
});
