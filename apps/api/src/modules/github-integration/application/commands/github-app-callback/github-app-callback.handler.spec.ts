import {
  GITHUB_INTEGRATION_ERROR_CODES,
  GITHUB_INTEGRATION_EVENT_TYPES,
  GITHUB_REPOSITORY_PERMISSION_LEVELS,
  REPOSITORY_CONNECTION_STATUSES,
} from "@lcsp/contracts/github-integration";
import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import { describe, it, expect, jest } from "@jest/globals";
import { BadRequestException } from "@nestjs/common";

import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { GitHubAppInstallState } from "../../../domain/entities/github-app-install-state.entity.js";
import type { GitHubAppClient } from "../../../infrastructure/github/github-app.client.js";
import type { GitHubAppInstallStateRepository } from "../../ports/persistence/github-app-install-state.repository.js";
import type { RepositoryConnectionRepository } from "../../ports/persistence/repository-connection.repository.js";
import { GitHubAppCallbackCommand } from "./github-app-callback.command.js";
import { GitHubAppCallbackHandler } from "./github-app-callback.handler.js";

const RAW_ACCESS_TOKEN = "ghs_should_never_be_stored_or_returned";

function buildInstallState(overrides?: {
  expiresAt?: Date;
}): GitHubAppInstallState {
  return GitHubAppInstallState.rehydrate({
    id: "install-state-1",
    state: "state-token-1",
    assessmentId: null,
    organizationId: "org-1",
    userId: "user-1",
    redirectUri: "http://localhost:3000/api/github/app/callback",
    expiresAt: overrides?.expiresAt ?? new Date(Date.now() + 60_000),
    createdAt: new Date(),
  });
}

function buildHandler(options?: {
  installState?: GitHubAppInstallState | null;
  permissions?: Record<string, string>;
  repositories?: Array<{
    id: string;
    name: string;
    fullName: string;
    defaultBranch: string;
  }>;
  exchangeError?: boolean;
  metadataError?: boolean;
}) {
  const repositories = options?.repositories ?? [
    {
      id: "repo-1",
      name: "example-repo",
      fullName: "acme/example-repo",
      defaultBranch: "main",
    },
  ];
  const findByState = jest
    .fn<GitHubAppInstallStateRepository["findByState"]>()
    .mockResolvedValue(
      options?.installState === undefined
        ? buildInstallState()
        : options.installState,
    );
  const deleteById = jest
    .fn<GitHubAppInstallStateRepository["deleteById"]>()
    .mockResolvedValue(undefined);
  const installStateRepository: GitHubAppInstallStateRepository = {
    save: jest
      .fn<GitHubAppInstallStateRepository["save"]>()
      .mockResolvedValue(undefined),
    findByState,
    deleteById,
  };

  const save = jest
    .fn<RepositoryConnectionRepository["save"]>()
    .mockResolvedValue(undefined);
  const repositoryConnectionRepository: RepositoryConnectionRepository = {
    save,
    findById: jest
      .fn<RepositoryConnectionRepository["findById"]>()
      .mockResolvedValue(null),
  };

  const exchangeCodeForAccessToken = jest
    .fn<GitHubAppClient["exchangeCodeForAccessToken"]>()
    .mockImplementation(() =>
      options?.exchangeError
        ? Promise.reject(new Error("token_exchange_failed"))
        : Promise.resolve(RAW_ACCESS_TOKEN),
    );
  const fetchInstallationMetadata = jest
    .fn<GitHubAppClient["fetchInstallationMetadata"]>()
    .mockImplementation(() =>
      options?.metadataError
        ? Promise.reject(new Error("metadata_fetch_failed"))
        : Promise.resolve({
            permissions: options?.permissions ?? {
              contents: GITHUB_REPOSITORY_PERMISSION_LEVELS.read,
            },
            repositories,
            repository: repositories[0],
          }),
    );
  const githubAppClient = {
    exchangeCodeForAccessToken,
    fetchInstallationMetadata,
  } as unknown as GitHubAppClient;

  const write = jest
    .fn<AuditWriterService["write"]>()
    .mockResolvedValue(undefined);
  const auditWriter = { write } as unknown as AuditWriterService;

  const handler = new GitHubAppCallbackHandler(
    installStateRepository,
    repositoryConnectionRepository,
    githubAppClient,
    auditWriter,
  );

  return {
    handler,
    findByState,
    deleteById,
    save,
    exchangeCodeForAccessToken,
    fetchInstallationMetadata,
    write,
  };
}

describe("GitHubAppCallbackHandler", () => {
  // T01
  it("creates a RepositoryConnection for a valid state and installation", async () => {
    const { handler, save } = buildHandler();

    const result = await handler.execute(
      new GitHubAppCallbackCommand(
        "installation-1",
        "code-1",
        "state-token-1",
        "corr-1",
      ),
    );

    expect(result.repository_full_name).toBe("acme/example-repo");
    expect(result.default_branch).toBe("main");
    expect(result.status).toBe(REPOSITORY_CONNECTION_STATUSES.active);
    expect(result.correlation_id).toBe("corr-1");
    expect(save).toHaveBeenCalledTimes(1);
  });

  // T02
  it("throws BadRequestException with GITHUB_STATE_INVALID when state is not found", async () => {
    const { handler, save, write } = buildHandler({ installState: null });

    try {
      await handler.execute(
        new GitHubAppCallbackCommand(
          "installation-1",
          "code-1",
          "unknown-state",
          "corr-1",
        ),
      );
      throw new Error("expected rejection");
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toMatchObject({
        ok: false,
        problem: {
          code: GITHUB_INTEGRATION_ERROR_CODES.githubStateInvalid,
          correlationId: "corr-1",
        },
      });
    }
    expect(save).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: GITHUB_INTEGRATION_EVENT_TYPES.appConnectionRejected,
        decision: AUDIT_DECISIONS.deny,
        reasonCode: GITHUB_INTEGRATION_ERROR_CODES.githubStateInvalid,
      }),
    );
  });

  // T03
  it("throws BadRequestException with GITHUB_STATE_INVALID when state is expired", async () => {
    const { handler, deleteById, save } = buildHandler({
      installState: buildInstallState({
        expiresAt: new Date(Date.now() - 1000),
      }),
    });

    try {
      await handler.execute(
        new GitHubAppCallbackCommand(
          "installation-1",
          "code-1",
          "state-token-1",
          "corr-1",
        ),
      );
      throw new Error("expected rejection");
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toMatchObject({
        ok: false,
        problem: {
          code: GITHUB_INTEGRATION_ERROR_CODES.githubStateInvalid,
          correlationId: "corr-1",
        },
      });
    }
    expect(deleteById).toHaveBeenCalledWith("install-state-1");
    expect(save).not.toHaveBeenCalled();
  });

  // T04
  it("throws BadRequestException with GITHUB_CALLBACK_INVALID when token exchange fails", async () => {
    const { handler, save } = buildHandler({ exchangeError: true });

    try {
      await handler.execute(
        new GitHubAppCallbackCommand(
          "installation-1",
          "bad-code",
          "state-token-1",
          "corr-1",
        ),
      );
      throw new Error("expected rejection");
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toMatchObject({
        ok: false,
        problem: {
          code: GITHUB_INTEGRATION_ERROR_CODES.githubCallbackInvalid,
          correlationId: "corr-1",
        },
      });
    }
    expect(save).not.toHaveBeenCalled();
  });

  // T05
  it("throws BadRequestException with PERMISSIONS_INSUFFICIENT when installation has write permissions", async () => {
    const { handler, save, write } = buildHandler({
      permissions: { contents: "write" },
    });

    try {
      await handler.execute(
        new GitHubAppCallbackCommand(
          "installation-1",
          "code-1",
          "state-token-1",
          "corr-1",
        ),
      );
      throw new Error("expected rejection");
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toMatchObject({
        ok: false,
        problem: {
          code: GITHUB_INTEGRATION_ERROR_CODES.permissionsInsufficient,
          correlationId: "corr-1",
        },
      });
    }
    expect(save).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: GITHUB_INTEGRATION_EVENT_TYPES.appConnectionRejected,
        reasonCode: GITHUB_INTEGRATION_ERROR_CODES.permissionsInsufficient,
      }),
    );
  });

  it("accepts read-only contents plus implicit metadata permission", async () => {
    const { handler } = buildHandler({
      permissions: {
        contents: GITHUB_REPOSITORY_PERMISSION_LEVELS.read,
        metadata: GITHUB_REPOSITORY_PERMISSION_LEVELS.read,
      },
    });

    const result = await handler.execute(
      new GitHubAppCallbackCommand(
        "installation-1",
        "code-1",
        "state-token-1",
        "corr-1",
      ),
    );

    expect(result.repository_full_name).toBe("acme/example-repo");
  });

  it("throws BadRequestException with PERMISSIONS_INSUFFICIENT when installation includes non-implicit extra permissions", async () => {
    const { handler, save } = buildHandler({
      permissions: {
        contents: GITHUB_REPOSITORY_PERMISSION_LEVELS.read,
        pull_requests: "WRITE",
      },
    });

    try {
      await handler.execute(
        new GitHubAppCallbackCommand(
          "installation-1",
          "code-1",
          "state-token-1",
          "corr-1",
        ),
      );
      throw new Error("expected rejection");
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toMatchObject({
        ok: false,
        problem: {
          code: GITHUB_INTEGRATION_ERROR_CODES.permissionsInsufficient,
          correlationId: "corr-1",
        },
      });
    }
    expect(save).not.toHaveBeenCalled();
  });

  it("passes selected repository_id to metadata lookup", async () => {
    const { handler, fetchInstallationMetadata } = buildHandler({
      repositories: [
        {
          id: "repo-2",
          name: "chosen-repo",
          fullName: "acme/chosen-repo",
          defaultBranch: "trunk",
        },
      ],
    });

    const result = await handler.execute(
      new GitHubAppCallbackCommand(
        "installation-1",
        "code-1",
        "state-token-1",
        "corr-1",
        "repo-2",
      ),
    );

    expect(fetchInstallationMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ repositoryId: "repo-2" }),
    );
    expect(result.repository_full_name).toBe("acme/chosen-repo");
  });

  it("creates connections for every repository returned by a multi-repository installation", async () => {
    const { handler, save } = buildHandler({
      repositories: [
        {
          id: "repo-1",
          name: "first-repo",
          fullName: "acme/first-repo",
          defaultBranch: "main",
        },
        {
          id: "repo-2",
          name: "second-repo",
          fullName: "acme/second-repo",
          defaultBranch: "trunk",
        },
      ],
    });

    const result = await handler.execute(
      new GitHubAppCallbackCommand(
        "installation-1",
        "code-1",
        "state-token-1",
        "corr-1",
      ),
    );

    expect(result.repository_full_name).toBe("acme/first-repo");
    expect(save).toHaveBeenCalledTimes(2);
    expect(
      save.mock.calls.map(([connection]) => connection.repositoryFullName),
    ).toEqual(["acme/first-repo", "acme/second-repo"]);
  });

  // T08
  it("deletes the GitHubAppInstallState after a successful callback (one-time use)", async () => {
    const { handler, deleteById } = buildHandler();

    await handler.execute(
      new GitHubAppCallbackCommand(
        "installation-1",
        "code-1",
        "state-token-1",
        "corr-1",
      ),
    );

    expect(deleteById).toHaveBeenCalledWith("install-state-1");
  });

  // T06 / T09
  it("never stores or returns the raw access token, and the audit event has no token", async () => {
    const { handler, save, write } = buildHandler();

    const result = await handler.execute(
      new GitHubAppCallbackCommand(
        "installation-1",
        "code-1",
        "state-token-1",
        "corr-1",
      ),
    );

    expect(JSON.stringify(result)).not.toMatch(RAW_ACCESS_TOKEN);
    const savedConnection = save.mock.calls[0][0];
    expect(JSON.stringify(savedConnection)).not.toMatch(RAW_ACCESS_TOKEN);

    expect(write).toHaveBeenCalledTimes(1);
    const event = write.mock.calls[0][0];
    expect(event.eventType).toBe(GITHUB_INTEGRATION_EVENT_TYPES.appConnected);
    expect(JSON.stringify(event.payload)).not.toMatch(RAW_ACCESS_TOKEN);
  });
});
