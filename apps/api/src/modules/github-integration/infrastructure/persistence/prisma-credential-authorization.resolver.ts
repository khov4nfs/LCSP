import { Inject, Injectable } from "@nestjs/common";
import {
  CredentialProvider,
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

/** Persistence-backed authorization resolver used by snapshot pinning and archive retrieval. */
@Injectable()
export class PrismaCredentialAuthorizationResolver implements CredentialAuthorizationResolverPort {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CREDENTIAL_STORE) private readonly store: CredentialStorePort,
  ) {}

  /**
   * Business purpose: Issue a short-lived credential lease only for the repository connection's current authorized identity.
   * Business rules: Owner, provider, repository, assessment, connection status, credential status, expiry, and exact credential version must all match persisted authorization.
   * Execution flow: Load the bound connection and credential, reject any stale or mismatched binding, check known expiration, then decrypt the owned secret into a bounded lease.
   * Failure cases: Unauthorized, revoked, expired, cross-provider, cross-owner, cross-repository, and version-mismatched bindings fail before secret access; storage errors become providerClientUnavailable.
   * Side effects: Reads encrypted credential material and returns a disposable in-memory lease; it does not contact the provider or change persisted state.
   */
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
      connection.provider !== credential.provider ||
      connection.repositoryFullName !== expectedRepositoryFullName ||
      connection.providerCredentialId === null ||
      connection.credentialAuthorizationStatus !==
        CredentialAuthorizationStatus.ACTIVE ||
      connection.credentialVersion !== credential.currentVersion ||
      (connection.assessmentId !== null &&
        connection.assessmentId !== context.assessmentId) ||
      credential.ownerUserId !== context.userId ||
      !hasValidProviderIdentity(
        credential.provider,
        credential.providerAccountId,
        credential.providerAccountExternalId,
      ) ||
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

/**
 * Business purpose: Ensure a persisted credential binding contains the provider's exact account identity representation.
 * Business rules: Numeric providers require only the legacy numeric key; Bitbucket and Azure require only a non-empty external identity.
 * Execution flow: Validate the provider-specific column pair before encrypted credential access.
 * Failure cases: Missing or mixed identities return false and the caller rejects authorization.
 * Side effects: Pure persistence-boundary validation.
 */
function hasValidProviderIdentity(
  provider: CredentialProvider,
  numericId: bigint | null,
  externalId: string | null,
): boolean {
  if (
    provider === CredentialProvider.BITBUCKET ||
    provider === CredentialProvider.AZURE_DEVOPS
  ) {
    if (numericId !== null || typeof externalId !== "string") return false;
    return provider === CredentialProvider.BITBUCKET
      ? /^(?:\{[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/iu.test(
          externalId,
        )
      : /^azure-organization:[a-z0-9][a-z0-9-]{0,63}$/iu.test(externalId);
  }
  return numericId !== null && externalId === null;
}

function isConnectionConsumption(
  operation: CredentialOperationContext["operation"],
): boolean {
  return (
    operation === GITHUB_CREDENTIAL_OPERATIONS.pinSnapshot ||
    operation === GITHUB_CREDENTIAL_OPERATIONS.retrieveArchive
  );
}
