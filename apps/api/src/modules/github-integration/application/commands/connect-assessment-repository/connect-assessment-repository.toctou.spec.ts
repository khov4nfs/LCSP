import { describe, expect, it, jest } from "@jest/globals";
import {
  AssessmentStatus,
  RepositoryAuthenticationMode,
  RepositoryConnectionStatus,
} from "@prisma/client";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  CREDENTIAL_PROVIDERS,
  CREDENTIAL_AUTHORIZATION_STATUSES,
} from "@lcsp/contracts/github-integration";

import { CredentialLease } from "../../security/credential-lease.js";
import { ConnectAssessmentRepositoryCommand } from "./connect-assessment-repository.command.js";
import { ConnectAssessmentRepositoryHandler } from "./connect-assessment-repository.handler.js";

describe("ConnectAssessmentRepositoryHandler credential snapshot", () => {
  it("persists the same credential version used by provider validation after rotation", async () => {
    const lease = new CredentialLease("synthetic-secret", {
      internalCredentialId: "credential-1",
      credentialVersion: 1,
      repositoryFullName: "acme/example-repo",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const resolveActiveCredential = jest.fn(() => ({
      metadata: {
        id: "credential-1",
        provider: CREDENTIAL_PROVIDERS.github,
        providerAccountId: "account-1",
        providerLogin: "acme-user",
        currentVersion: 1,
      },
      lease,
    }));
    const findMetadata = jest.fn(() => {
      throw new Error("a second active credential lookup is not allowed");
    });
    const validationVersions: number[] = [];
    const provider = {
      validateRepositoryAccess: jest.fn((receivedLease: CredentialLease) => {
        validationVersions.push(receivedLease.credentialVersion);
        // A rotation may happen after resolution; the returned snapshot remains v1.
        return {
          id: "repo-1",
          name: "example-repo",
          fullName: "acme/example-repo",
          defaultBranch: "main",
          private: true,
        };
      }),
    };
    const persisted: Record<string, unknown>[] = [];
    const unitOfWork = {
      execute: async (work: (tx: unknown) => Promise<unknown>) =>
        work({
          database: {
            repositoryConnection: {
              create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
                persisted.push(data);
                return data;
              }),
            },
          },
        }),
    };
    const prisma = {
      assessment: {
        findFirst: jest.fn(() => ({
          id: "assessment-1",
          status: AssessmentStatus.WIZARD_SUBMITTED,
        })),
      },
      repositoryConnection: {
        findFirst: jest.fn(() => null),
      },
    };
    const config = { get: () => ({ enabled: true }) };
    const handler = new ConnectAssessmentRepositoryHandler(
      prisma as never,
      config as never,
      unitOfWork as never,
      { resolveActiveCredential, findMetadata } as never,
      { get: () => provider } as never,
    );

    // Rotate the underlying credential after the single snapshot has resolved.
    let currentVersion = 1;
    resolveActiveCredential.mockImplementationOnce(() => {
      const snapshot = {
        metadata: {
          id: "credential-1",
          provider: CREDENTIAL_PROVIDERS.github,
          providerAccountId: "account-1",
          providerLogin: "acme-user",
          currentVersion: currentVersion,
        },
        lease,
      };
      currentVersion = 2;
      return snapshot;
    });

    await handler.execute(
      new ConnectAssessmentRepositoryCommand(
        "assessment-1",
        "user-1",
        AUTH_USER_ROLES.customer,
        "https://github.com/acme/example-repo",
        "correlation-1",
      ),
    );

    expect(resolveActiveCredential).toHaveBeenCalledTimes(1);
    expect(findMetadata).not.toHaveBeenCalled();
    expect(validationVersions).toEqual([1]);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toEqual(
      expect.objectContaining({
        providerCredentialId: "credential-1",
        credentialVersion: 1,
        credentialAuthorizationStatus: CREDENTIAL_AUTHORIZATION_STATUSES.active,
        authenticationMode: RepositoryAuthenticationMode.GITHUB_CLI_CREDENTIAL,
        status: RepositoryConnectionStatus.ACTIVE,
      }),
    );
    expect(persisted[0]?.credentialVersion).toBe(validationVersions[0]);
    lease.dispose();
  });
});
