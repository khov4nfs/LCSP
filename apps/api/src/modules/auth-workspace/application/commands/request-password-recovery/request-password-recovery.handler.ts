import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_BACKUP_EMAIL_POLICIES,
  AUTH_ERROR_CODES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
  createProblemResult,
} from "@lcsp/contracts/auth";

import { RecoveryRequest } from "../../../domain/models/auth-workspace.models.ts";
import {
  fingerprintToken,
  hashSecret,
  issueOpaqueToken,
} from "../../../infrastructure/security/security.utils.ts";
import type { AuthProblemResult } from "../../contracts/auth-workspace/common.contract.ts";
import type { RequestRecoverySuccess } from "../../contracts/auth-workspace/recovery.contract.ts";
import type { RecoveryNotifier } from "../../ports/notification/recovery-notifier.ts";
import type { AuthWorkspaceRepositories } from "../../ports/persistence/auth-workspace-repositories.ts";
import { AuthWorkspaceSupportService } from "../../services/auth-workspace/auth-workspace-support.service.ts";
import { RequestPasswordRecoveryCommand } from "./request-password-recovery.command.ts";

const RECOVERY_TOKEN_TTL_MS = 30 * 60_000;

export class RequestPasswordRecoveryHandler {
  constructor(
    private readonly support: AuthWorkspaceSupportService,
    private readonly repositories: AuthWorkspaceRepositories,
    private readonly notifier: RecoveryNotifier,
  ) {}

  async execute(
    command: RequestPasswordRecoveryCommand,
  ): Promise<AuthProblemResult | RequestRecoverySuccess> {
    const { payload, requestMeta } = command;
    const { repositories } = this;
    const correlationId =
      requestMeta.correlationId ?? this.support.createCorrelationId();

    if (
      typeof payload.email !== "string" ||
      payload.email.trim().length === 0
    ) {
      return createProblemResult(
        AUTH_ERROR_CODES.validationFailed,
        correlationId,
      );
    }

    const email = payload.email.trim().toLowerCase();
    const user = await repositories.users.findByPrimaryEmail(email);

    if (!user) {
      // Do the same shape of work as the found-user path so response
      // latency doesn't reveal whether the email is registered.
      hashSecret("decoy-recovery-lookup-for-constant-time-compare");
      await this.support.recordAudit(repositories, {
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.recoveryRequested,
        actor_id: null,
        decision: AUDIT_DECISIONS.allow,
        correlationId: correlationId,
      });
      return { ok: true, correlationId: correlationId };
    }

    const now = this.support.now();
    const token = issueOpaqueToken();
    const recoveryRequest = new RecoveryRequest({
      userId: user.id,
      tokenHash: hashSecret(token),
      expiresAt: now + RECOVERY_TOKEN_TTL_MS,
    });
    await repositories.recoveryRequests.save(
      recoveryRequest,
      fingerprintToken(token),
    );

    await this.notifier.notify({
      userId: user.id,
      email: this.resolveRecoveryDestination(user),
      token,
      correlationId,
      appOrigin: requestMeta.app_origin,
    });

    await this.support.recordAudit(repositories, {
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.recoveryRequested,
      actor_id: user.id,
      decision: AUDIT_DECISIONS.allow,
      correlationId: correlationId,
    });

    return { ok: true, correlationId: correlationId };
  }

  private resolveRecoveryDestination(user: {
    recoveryEmail: string | null;
    email: { toString(): string };
    backupEmailPolicy: string;
  }) {
    if (
      user.backupEmailPolicy === AUTH_BACKUP_EMAIL_POLICIES.recoveryEmail &&
      user.recoveryEmail
    ) {
      return user.recoveryEmail;
    }

    return user.email.toString();
  }
}
