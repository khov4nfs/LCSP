import { HttpStatus } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  CREDENTIAL_AUTHORIZATION_STATUSES,
  CREDENTIAL_PROVIDERS,
  GITHUB_INTEGRATION_ERROR_CODES,
  GITHUB_INTEGRATION_EVENT_TYPES,
  PROVIDER_CREDENTIAL_STATUSES,
  type CredentialProvider,
} from "@lcsp/contracts/github-integration";

import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { PrismaCredentialPersistenceUnitOfWork } from "../../../infrastructure/persistence/prisma-credential-persistence.unit-of-work.js";
import type { CredentialLocator } from "../../ports/security/credential-store.port.js";
import { DisconnectProviderCredentialCommand } from "./disconnect-provider-credential.command.js";

export type DisconnectProviderCredentialResult = {
  provider: CredentialProvider;
  configured: false;
  status: typeof PROVIDER_CREDENTIAL_STATUSES.revoked | null;
};

@CommandHandler(DisconnectProviderCredentialCommand)
export class DisconnectProviderCredentialHandler implements ICommandHandler<DisconnectProviderCredentialCommand> {
  constructor(
    private readonly unitOfWork: PrismaCredentialPersistenceUnitOfWork,
    private readonly auditWriter: AuditWriterService,
  ) {}

  /**
   * Business purpose: Let a customer permanently disconnect their own provider credential.
   * Business rules:
   * - Only customers act, and only on credentials owned by the calling account; recent
   *   reauthentication is enforced by the route guard before this handler runs.
   * - The encrypted secret is destroyed, the credential becomes inactive and REVOKED, and every
   *   repository connection bound to it loses authorization so it can no longer be consumed.
   * - Disconnecting an already-disconnected provider is idempotent and reports no credential.
   * Execution flow:
   * 1. Validate the provider, then in one transaction find the owner's current credential.
   * 2. Mark revocation requested, destroy the secret, mark REVOKED and revoke bound connections.
   * 3. Record an audit event that never carries credential material.
   * Failure cases:
   * - Invalid providers return 400; any persistence failure rolls back and nothing is reported.
   * Side effects:
   * - Destroys stored secret material, updates credential/connection state and writes audit.
   */
  async execute(
    command: DisconnectProviderCredentialCommand,
  ): Promise<DisconnectProviderCredentialResult> {
    if (command.subjectRole !== AUTH_USER_ROLES.customer) {
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.cliConnectDisabled,
        command.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }
    const provider = Object.values(CREDENTIAL_PROVIDERS).find(
      (value) => value === command.provider,
    );
    if (!provider) {
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.credentialRequestInvalid,
        command.correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
    }

    const revokedId = await this.unitOfWork.execute(async (transaction) => {
      const current =
        await transaction.providerCredentials.findActiveByOwnerProvider(
          command.userId,
          provider,
        );
      if (!current) return null;
      const now = new Date();
      await transaction.providerCredentials.updateLifecycle(
        current.id,
        command.userId,
        PROVIDER_CREDENTIAL_STATUSES.revoking,
      );
      await transaction.credentialStore.destroy(
        current.id as CredentialLocator,
      );
      await transaction.database.repositoryConnection.updateMany({
        where: {
          providerCredentialId: current.id,
          userId: command.userId,
        },
        data: {
          credentialAuthorizationStatus:
            CREDENTIAL_AUTHORIZATION_STATUSES.revoked,
          credentialRevokedAt: now,
        },
      });
      const revoked = await transaction.providerCredentials.markRevoked(
        current.id,
        command.userId,
        now,
      );
      if (!revoked) throw new Error("provider_credential_revoke_conflict");
      return current.id;
    });

    if (revokedId !== null) {
      await this.auditWriter.write({
        eventType:
          GITHUB_INTEGRATION_EVENT_TYPES.providerCredentialDisconnected,
        actorId: command.userId,
        resourceType: AUDIT_RESOURCE_TYPES.authAccount,
        resourceId: command.userId,
        correlationId: command.correlationId,
        sessionId: command.sessionId,
        decision: AUDIT_DECISIONS.allow,
        payload: { provider },
      });
    }

    return {
      provider,
      configured: false,
      status: revokedId === null ? null : PROVIDER_CREDENTIAL_STATUSES.revoked,
    };
  }
}
