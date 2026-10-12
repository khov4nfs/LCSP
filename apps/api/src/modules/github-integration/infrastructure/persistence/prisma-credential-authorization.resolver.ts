import { Inject, Injectable } from "@nestjs/common";
import {
  CredentialAuthorizationStatus,
  ProviderCredentialStatus,
  RepositoryAuthenticationMode,
  RepositoryConnectionStatus,
} from "@prisma/client";
import {
  GITHUB_CREDENTIAL_ERROR_CODES,
  GITHUB_CREDENTIAL_OPERATIONS,
  type GitHubCredentialErrorCode,
} from "@lcsp/contracts/github-integration";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import type {
  CredentialAuthorizationResolverPort,
  CredentialOperationContext,
  CredentialRevocationPlan,
  RotationAuthority,
} from "../../application/ports/security/credential-authorization-resolver.port.js";
import {
  CREDENTIAL_STORE,
  type CredentialStorePort,
  type CredentialLocator,
} from "../../application/ports/security/credential-store.port.js";
import { CredentialLease } from "../../application/security/credential-lease.js";

export class CredentialResolutionError extends Error {
  readonly code: GitHubCredentialErrorCode;
  constructor(code: GitHubCredentialErrorCode) {
    super(code);
    this.name = "CredentialResolutionError";
    this.code = code;
  }
}

/** Persistence-backed resolver. It is registered only as an internal foundation and is not used by production handlers. */
@Injectable()
export class PrismaCredentialAuthorizationResolver implements CredentialAuthorizationResolverPort {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CREDENTIAL_STORE) private readonly store: CredentialStorePort,
  ) {}

  async resolveForConnection(
    context: CredentialOperationContext,
    connectionId: string,
    expectedRepositoryFullName: string,
  ): Promise<CredentialLease> {
    const connection = await this.prisma.repositoryConnection.findFirst({
      where: {
        id: connectionId,
        userId: context.userId,
        status: RepositoryConnectionStatus.ACTIVE,
        authenticationMode: {
          in: [
            RepositoryAuthenticationMode.GITHUB_CLI_CREDENTIAL,
            RepositoryAuthenticationMode.GITLAB_CLI_CREDENTIAL,
            RepositoryAuthenticationMode.BITBUCKET_CLI_CREDENTIAL,
            RepositoryAuthenticationMode.AZURE_DEVOPS_CLI_CREDENTIAL,
          ],
        },
      },
      include: { providerCredential: true },
    });
    const credential = connection?.providerCredential;
    const now = new Date();
    if (
      !connection ||
      !credential ||
      connection.repositoryFullName !== expectedRepositoryFullName ||
      connection.providerCredentialId === null ||
      connection.credentialAuthorizationStatus !==
        CredentialAuthorizationStatus.ACTIVE ||
      connection.credentialVersion !== credential.currentVersion ||
      (connection.assessmentId !== null &&
        connection.assessmentId !== context.assessmentId) ||
      credential.ownerUserId !== context.userId ||
      (!isConnectionConsumption(context.operation) &&
        context.actorId !== null &&
        credential.ownerUserId !== context.actorId)
    ) {
      throw new CredentialResolutionError(
        GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid,
      );
    }
    if (
      credential.status === ProviderCredentialStatus.EXPIRED ||
      (credential.declaredExpiresAt !== null &&
        credential.declaredExpiresAt <= now)
    ) {
      throw new CredentialResolutionError(
        GITHUB_CREDENTIAL_ERROR_CODES.credentialExpired,
      );
    }
    if (credential.status !== ProviderCredentialStatus.ACTIVE) {
      throw new CredentialResolutionError(
        GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid,
      );
    }
    try {
      const plaintext = await this.store.read(
        credential.id as CredentialLocator,
      );
      const credentialExpiry =
        credential.declaredExpiresAt?.getTime() ?? now.getTime() + 300_000;
      return new CredentialLease(plaintext, {
        internalCredentialId: credential.id,
        credentialVersion: credential.currentVersion,
        repositoryFullName: connection.repositoryFullName,
        expiresAt: new Date(
          Math.min(credentialExpiry, now.getTime() + 300_000),
        ),
      });
    } catch {
      throw new CredentialResolutionError(
        GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
      );
    }
  }

  async markInvalid(
    connectionId: string,
    credentialVersion: number,
    safeReason: GitHubCredentialErrorCode,
  ): Promise<void> {
    const connection = await this.prisma.repositoryConnection.findFirst({
      where: {
        id: connectionId,
        authenticationMode: {
          in: [
            RepositoryAuthenticationMode.GITHUB_CLI_CREDENTIAL,
            RepositoryAuthenticationMode.GITLAB_CLI_CREDENTIAL,
            RepositoryAuthenticationMode.BITBUCKET_CLI_CREDENTIAL,
            RepositoryAuthenticationMode.AZURE_DEVOPS_CLI_CREDENTIAL,
          ],
        },
      },
      include: { providerCredential: true },
    });
    const credential = connection?.providerCredential;
    if (
      !connection ||
      !credential ||
      connection.credentialVersion !== credentialVersion
    )
      return;
    await this.prisma.providerCredential.updateMany({
      where: {
        id: credential.id,
        ownerUserId: credential.ownerUserId,
        currentVersion: credentialVersion,
      },
      data: {
        status: ProviderCredentialStatus.INVALID,
        invalidatedAt: new Date(),
        lastFailureCode: safeReason,
      },
    });
  }

  async assertRotationAuthority(
    context: CredentialOperationContext,
    connectionId: string,
  ): Promise<RotationAuthority> {
    const row = await this.authorizedBinding(context, connectionId);
    return {
      connectionId,
      userId: context.userId,
      repositoryFullNames: [row.repositoryFullName],
      expectedCredentialVersion: row.credentialVersion!,
    };
  }

  async revokeForConnection(
    context: CredentialOperationContext,
    connectionId: string,
  ): Promise<CredentialRevocationPlan> {
    const row = await this.authorizedBinding(context, connectionId);
    await this.prisma.repositoryConnection.updateMany({
      where: {
        id: connectionId,
        credentialAuthorizationStatus: CredentialAuthorizationStatus.ACTIVE,
      },
      data: {
        credentialAuthorizationStatus: CredentialAuthorizationStatus.REVOKING,
      },
    });
    return {
      connectionId,
      userId: context.userId,
      repositoryFullNames: [row.repositoryFullName],
      expectedCredentialVersion: row.credentialVersion!,
      affectedConnectionIds: [connectionId],
    };
  }

  private async authorizedBinding(
    context: CredentialOperationContext,
    connectionId: string,
  ) {
    const row = await this.prisma.repositoryConnection.findFirst({
      where: {
        id: connectionId,
        userId: context.userId,
        authenticationMode: {
          in: [
            RepositoryAuthenticationMode.GITHUB_CLI_CREDENTIAL,
            RepositoryAuthenticationMode.GITLAB_CLI_CREDENTIAL,
            RepositoryAuthenticationMode.BITBUCKET_CLI_CREDENTIAL,
            RepositoryAuthenticationMode.AZURE_DEVOPS_CLI_CREDENTIAL,
          ],
        },
        credentialAuthorizationStatus: CredentialAuthorizationStatus.ACTIVE,
        providerCredential: {
          ownerUserId: context.userId,
        },
      },
      select: {
        id: true,
        repositoryFullName: true,
        credentialVersion: true,
      },
    });
    if (!row || row.credentialVersion === null)
      throw new CredentialResolutionError(
        GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid,
      );
    return row;
  }
}

function isConnectionConsumption(
  operation: CredentialOperationContext["operation"],
): boolean {
  return (
    operation === GITHUB_CREDENTIAL_OPERATIONS.pinSnapshot ||
    operation === GITHUB_CREDENTIAL_OPERATIONS.retrieveArchive
  );
}
