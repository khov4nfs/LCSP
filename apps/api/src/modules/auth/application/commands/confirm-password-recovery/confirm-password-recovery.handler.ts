import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  USER_ACCESS_STATUSES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
} from "@lcsp/contracts/auth";

import { Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { problemException } from "../../../../../platform/problems/problem-factory.ts";
import {
  fingerprintToken,
  hashSecret,
} from "../../../infrastructure/security/security.utils.ts";
import type { ConfirmRecoverySuccess } from "../../contracts/auth/recovery.contract.ts";
import {
  AUTH_RECOVERY_REQUEST_REPOSITORY,
  AUTH_SESSION_REPOSITORY,
  AUTH_USER_REPOSITORY,
  type RecoveryRequestRepository,
  type SessionRepository,
  type UserRepository,
} from "../../ports/persistence/index.ts";
import { AuthSupportService } from "../../services/auth/auth-support.service.ts";
import { ConfirmPasswordRecoveryCommand } from "./confirm-password-recovery.command.ts";

@CommandHandler(ConfirmPasswordRecoveryCommand)
export class ConfirmPasswordRecoveryHandler implements ICommandHandler<ConfirmPasswordRecoveryCommand> {
  constructor(
    private readonly support: AuthSupportService,
    @Inject(AUTH_RECOVERY_REQUEST_REPOSITORY)
    private readonly recoveryRequests: RecoveryRequestRepository,
    @Inject(AUTH_USER_REPOSITORY)
    private readonly users: UserRepository,
    @Inject(AUTH_SESSION_REPOSITORY)
    private readonly sessions: SessionRepository,
  ) {}

  async execute(
    command: ConfirmPasswordRecoveryCommand,
  ): Promise<ConfirmRecoverySuccess> {
    const { payload, requestMeta } = command;
    const { recoveryRequests, users, sessions } = this;
    const correlationId =
      requestMeta.correlationId ?? this.support.createCorrelationId();

    if (
      typeof payload.token !== "string" ||
      payload.token.trim().length === 0 ||
      typeof payload.new_password !== "string" ||
      payload.new_password.length === 0
    ) {
      throw problemException(AUTH_ERROR_CODES.validationFailed, correlationId);
    }

    const now = this.support.now();
    const recoveryRequest = await recoveryRequests.findByFingerprint(
      fingerprintToken(payload.token),
    );
    if (!recoveryRequest || !recoveryRequest.isValid(now)) {
      await this.support.recordAudit({
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.recoveryConfirmFailed,
        actor_id: recoveryRequest?.userId ?? null,
        decision: AUDIT_DECISIONS.deny,
        reason_code: AUTH_ERROR_CODES.recoveryInvalid,
        correlationId: correlationId,
      });
      throw problemException(AUTH_ERROR_CODES.recoveryInvalid, correlationId);
    }

    const user = await users.findById(recoveryRequest.userId);
    if (!user || user.accessStatus !== USER_ACCESS_STATUSES.active) {
      throw problemException(AUTH_ERROR_CODES.recoveryInvalid, correlationId);
    }

    user.passwordHash = hashSecret(payload.new_password);
    user.clearFailedLogins();
    await users.save(user);

    recoveryRequest.consume(now);
    await recoveryRequests.save(recoveryRequest);

    await sessions.revokeAllForUser(user.id, now);

    await this.support.recordAudit({
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.recoveryConfirmed,
      actor_id: user.id,
      decision: AUDIT_DECISIONS.allow,
      correlationId: correlationId,
    });

    return { ok: true, correlationId: correlationId };
  }
}
