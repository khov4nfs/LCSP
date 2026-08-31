import { describe, expect, it, jest } from "@jest/globals";
import { HttpException, HttpStatus } from "@nestjs/common";
import {
  GITHUB_CREDENTIAL_ERROR_CODES,
  GITHUB_REPOSITORY_PERMISSION_LEVELS,
  REPOSITORY_AUTHENTICATION_MODES,
  REPOSITORY_CONNECTION_STATUSES,
} from "@lcsp/contracts/github-integration";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { RepositoryConnection } from "../../../domain/entities/repository-connection.entity.js";
import type { GitHubAppClient } from "../../../infrastructure/github/github-app.client.js";
import { GitHubCliProviderError } from "../../../infrastructure/github/github-cli-repository.provider.js";
import type { GitHubRepositoryProviderPort } from "../../ports/github-repository-provider.port.js";
import type { RepositoryConnectionRepository } from "../../ports/persistence/repository-connection.repository.js";
import type { RepositorySnapshotRepository } from "../../ports/persistence/repository-snapshot.repository.js";
import type { CredentialAuthorizationResolverPort } from "../../ports/security/credential-authorization-resolver.port.js";
import { CredentialLease } from "../../security/credential-lease.js";
import { PinSnapshotCommand } from "./pin-snapshot.command.js";
import { PinSnapshotHandler } from "./pin-snapshot.handler.js";

const SECRET = "github_pat_PHASE4_RECOGNIZABLE_SECRET";

function cliConnection(assessmentId: string | null = "assessment-1") {
  return RepositoryConnection.rehydrate({
    id: "connection-1",
    assessmentId,
    userId: "manager-1",
    installationId: null,
    authenticationMode: REPOSITORY_AUTHENTICATION_MODES.githubCliCredential,
    providerCredentialId: "credential-1",
    credentialVersion: 7,
    credentialAuthorizationStatus: "ACTIVE",
    repositoryId: "repo-1",
    repositoryName: "repo",
    repositoryFullName: "owner/repo",
    defaultBranch: "main",
    permissions: { contents: GITHUB_REPOSITORY_PERMISSION_LEVELS.read },
    status: REPOSITORY_CONNECTION_STATUSES.active,
    connectedAt: new Date(),
    revokedAt: null,
  });
}

function command(overrides: Partial<PinSnapshotCommand> = {}) {
  return new PinSnapshotCommand(
    overrides.assessmentId ?? "assessment-1",
    overrides.actorId ?? "manager-1",
    overrides.subjectRole ?? AUTH_USER_ROLES.customer,
    overrides.scope,
    overrides.connectionId ?? "connection-1",
    overrides.branch,
    overrides.ref,
    overrides.commitSha,
    overrides.correlationId ?? "corr-1",
  );
}

function build(
  options: {
    connection?: RepositoryConnection;
    enabled?: boolean;
    providerError?: Error;
  } = {},
) {
  const lease = new CredentialLease(SECRET, {
    internalCredentialId: "credential-1",
    credentialVersion: 7,
    repositoryFullName: "owner/repo",
    expiresAt: new Date(Date.now() + 60_000),
  });
  const resolveForConnection = jest
    .fn<CredentialAuthorizationResolverPort["resolveForConnection"]>()
    .mockResolvedValue(lease);
  const markInvalid = jest
    .fn<CredentialAuthorizationResolverPort["markInvalid"]>()
    .mockResolvedValue(undefined);
  const resolver = {
    resolveForConnection,
    markInvalid,
  } as unknown as CredentialAuthorizationResolverPort;
  const cliResolve = jest
    .fn<GitHubRepositoryProviderPort["resolveCommit"]>()
    .mockImplementation(() =>
      options.providerError
        ? Promise.reject(options.providerError)
        : Promise.resolve({
            sha: "a".repeat(40),
            repositoryFullName: "owner/repo",
            htmlUrl: `https://github.com/owner/repo/commit/${"a".repeat(40)}`,
            authorDate: "2026-08-24T00:00:00.000Z",
            committerDate: "2026-08-24T00:00:01.000Z",
          }),
    );
  const provider = {
    resolveCommit: cliResolve,
  } as unknown as GitHubRepositoryProviderPort;
  const appResolve = jest.fn<GitHubAppClient["resolveCommit"]>();
  const app = { resolveCommit: appResolve } as unknown as GitHubAppClient;
  const save = jest
    .fn<RepositorySnapshotRepository["saveWithCreatedEvent"]>()
    .mockResolvedValue(undefined);
  const snapshots = {
    saveWithCreatedEvent: save,
  } as RepositorySnapshotRepository;
  const connections = {
    findById: jest
      .fn<RepositoryConnectionRepository["findById"]>()
      .mockResolvedValue(options.connection ?? cliConnection()),
    save: jest.fn(),
    linkToAssessment: jest.fn(),
  } as unknown as RepositoryConnectionRepository;
  const prisma = {
    assessment: {
      findUnique: jest.fn(() =>
        Promise.resolve({
          id: "assessment-1",
          ownerId: "manager-1",
        }),
      ),
    },
  } as unknown as PrismaService;
  const audit = {
    write: jest.fn(() => Promise.resolve()),
  } as unknown as AuditWriterService;
  const handler = new PinSnapshotHandler(
    connections,
    snapshots,
    app,
    resolver,
    provider,
    {
      get: jest.fn(() => ({ snapshotPinningEnabled: options.enabled ?? true })),
    } as never,
    prisma,
    audit,
  );
  return {
    handler,
    lease,
    resolveForConnection,
    markInvalid,
    cliResolve,
    appResolve,
    save,
  };
}

describe("PinSnapshotHandler CLI routing", () => {
  it("uses only resolver and CLI provider and preserves snapshot provenance", async () => {
    const fixture = build();
    const result = await fixture.handler.execute(
      command({ ref: "refs/heads/main" }),
    );
    expect(fixture.appResolve).not.toHaveBeenCalled();
    expect(fixture.resolveForConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "manager-1",
        assessmentId: "assessment-1",
      }),
      "connection-1",
      "owner/repo",
    );
    expect(fixture.cliResolve).toHaveBeenCalledWith(
      fixture.lease,
      "owner/repo",
      "refs/heads/main",
    );
    expect(result.commit_sha).toBe("a".repeat(40));
    const snapshot = fixture.save.mock.calls[0]?.[0];
    expect(snapshot?.repositoryId).toBe("repo-1");
    expect(JSON.stringify(snapshot)).not.toContain(SECRET);
    expect(() => fixture.lease.withSecret((value) => value)).toThrow();
  });

  it("denies an admin because snapshot pinning remains customer-owner scoped", async () => {
    const fixture = build();
    await expect(
      fixture.handler.execute(
        command({
          actorId: "admin-1",
          subjectRole: AUTH_USER_ROLES.admin,
          scope: "assessment-1",
        }),
      ),
    ).rejects.toBeInstanceOf(HttpException);
    expect(fixture.resolveForConnection).not.toHaveBeenCalled();
  });

  it("denies an unscoped Developer before resolving a credential", async () => {
    const fixture = build();
    await expect(
      fixture.handler.execute(
        command({
          actorId: "developer-1",
          subjectRole: AUTH_USER_ROLES.admin,
          scope: "assessment-2",
        }),
      ),
    ).rejects.toBeInstanceOf(HttpException);
    expect(fixture.resolveForConnection).not.toHaveBeenCalled();
  });

  it("denies a bound connection assessment mismatch before resolving", async () => {
    const fixture = build({ connection: cliConnection("assessment-2") });
    await expect(fixture.handler.execute(command())).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(fixture.resolveForConnection).not.toHaveBeenCalled();
  });

  it.each([
    ["cross-user connection", cliConnection(), "other-user"],
    ["inactive connection", cliConnection(), "manager-1"],
  ])("denies %s before credential resolution", async (_label, row, userId) => {
    if (_label === "inactive connection") {
      Object.defineProperty(row, "status", {
        get: () => REPOSITORY_CONNECTION_STATUSES.revoked,
      });
    } else {
      Object.defineProperty(row, "userId", {
        get: () => userId,
      });
    }
    const fixture = build({ connection: row });
    await expect(fixture.handler.execute(command())).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(fixture.resolveForConnection).not.toHaveBeenCalled();
  });

  it("denies a Manager who does not own the assessment before loading a secret", async () => {
    const fixture = build();
    await expect(
      fixture.handler.execute(command({ actorId: "different-manager" })),
    ).rejects.toBeInstanceOf(HttpException);
    expect(fixture.resolveForConnection).not.toHaveBeenCalled();
  });

  it("fails safely when CLI pinning is disabled", async () => {
    const fixture = build({ enabled: false });
    const error = await fixture.handler
      .execute(command())
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(
      HttpStatus.SERVICE_UNAVAILABLE,
    );
    expect(fixture.resolveForConnection).not.toHaveBeenCalled();
  });

  it("marks only the lease version invalid for an authoritative credential failure", async () => {
    const fixture = build({
      providerError: new GitHubCliProviderError(
        GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid,
      ),
    });
    await expect(fixture.handler.execute(command())).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(fixture.markInvalid).toHaveBeenCalledWith(
      "connection-1",
      7,
      GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid,
    );
    expect(() => fixture.lease.withSecret((value) => value)).toThrow();
  });

  it("does not invalidate credentials for timeout and does not fall back", async () => {
    const fixture = build({
      providerError: new GitHubCliProviderError(
        GITHUB_CREDENTIAL_ERROR_CODES.providerTimeout,
      ),
    });
    await expect(fixture.handler.execute(command())).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(fixture.markInvalid).not.toHaveBeenCalled();
    expect(fixture.appResolve).not.toHaveBeenCalled();
  });

  it("fails closed for an inconsistent CLI authentication shape", async () => {
    const invalid = RepositoryConnection.rehydrate({
      id: "bad",
      assessmentId: "assessment-1",
      userId: "manager-1",
      installationId: "unexpected-installation",
      authenticationMode: REPOSITORY_AUTHENTICATION_MODES.githubCliCredential,
      repositoryId: "repo-1",
      repositoryName: "repo",
      repositoryFullName: "owner/repo",
      defaultBranch: "main",
      permissions: {},
      status: REPOSITORY_CONNECTION_STATUSES.active,
      connectedAt: new Date(),
      revokedAt: null,
    });
    const fixture = build({ connection: invalid });
    await expect(fixture.handler.execute(command())).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(fixture.resolveForConnection).not.toHaveBeenCalled();
  });

  it("fails closed for an unknown persisted authentication mode", async () => {
    const invalid = RepositoryConnection.rehydrate({
      id: "unknown",
      assessmentId: "assessment-1",
      userId: "manager-1",
      installationId: null,
      authenticationMode: "UNKNOWN_MODE" as never,
      repositoryId: "repo-1",
      repositoryName: "repo",
      repositoryFullName: "owner/repo",
      defaultBranch: "main",
      permissions: {},
      status: REPOSITORY_CONNECTION_STATUSES.active,
      connectedAt: new Date(),
      revokedAt: null,
    });
    const fixture = build({ connection: invalid });
    await expect(fixture.handler.execute(command())).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(fixture.resolveForConnection).not.toHaveBeenCalled();
    expect(fixture.appResolve).not.toHaveBeenCalled();
  });
});
