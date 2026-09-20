import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
} from "@lcsp/contracts/auth";

import { Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { problemException } from "../../../../../platform/problems/problem-factory.js";
import type { DisableMfaSuccess } from "../../contracts/auth/mfa.contract.ts";
import {
  AUTH_MFA_ENROLLMENT_REPOSITORY,
  AUTH_MFA_RECOVERY_CODE_REPOSITORY,
  AUTH_SESSION_REPOSITORY,
  AUTH_USER_REPOSITORY,
  type MfaEnrollmentRepository,
  type MfaRecoveryCodeRepository,
  type SessionRepository,
  type UserRepository,
} from "../../ports/persistence/index.ts";
import { AuthSupportService } from "../../services/auth/auth-support.service.ts";
import { DisableMfaCommand } from "./disable-mfa.command.ts";

@CommandHandler(DisableMfaCommand)
export class DisableMfaHandler implements ICommandHandler<DisableMfaCommand> {
  constructor(
    private readonly support: AuthSupportService,
    @Inject(AUTH_SESSION_REPOSITORY)
    private readonly sessions: SessionRepository,
    @Inject(AUTH_MFA_ENROLLMENT_REPOSITORY)
    private readonly mfaEnrollments: MfaEnrollmentRepository,
    @Inject(AUTH_MFA_RECOVERY_CODE_REPOSITORY)
    private readonly mfaRecoveryCodes: MfaRecoveryCodeRepository,
    @Inject(AUTH_USER_REPOSITORY)
    private readonly users: UserRepository,
  ) {}

  async execute(command: DisableMfaCommand): Promise<DisableMfaSuccess> {
    const { userId, sessionId, requestMeta } = command;
    const correlationId =
      requestMeta?.correlationId ?? this.support.createCorrelationId();

    if (!userId || !sessionId) {
      throw problemException(AUTH_ERROR_CODES.sessionInvalid, correlationId);
    }

    const session = await this.sessions.findById(sessionId);
    if (
      !session ||
      !session.isActive(this.support.now()) ||
      session.userId !== userId
    ) {
      throw problemException(AUTH_ERROR_CODES.sessionInvalid, correlationId);
    }

    if (!session.isMfaVerified()) {
      throw problemException(AUTH_ERROR_CODES.mfaRequired, correlationId);
    }

    const enrollment = await this.mfaEnrollments.findByUserId(userId);
    if (!enrollment) {
      return { ok: true, correlationId: correlationId };
    }

    const user = await this.users.findById(userId);
    if (!user) {
      throw problemException(AUTH_ERROR_CODES.sessionInvalid, correlationId);
    }

    const now = this.support.now();
    await this.mfaEnrollments.deleteByUserId(userId);
    await this.mfaRecoveryCodes.revokeActiveForUser(userId, now);
    user.mfaRequired = false;
    await this.users.save(user);

    session.mfaVerifiedAt = null;
    await this.sessions.save(session);

    await this.support.recordAudit({
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaDisabled,
      actor_id: userId,
      decision: AUDIT_DECISIONS.allow,
      correlationId: correlationId,
      session_id: sessionId ?? null,
    });

    return { ok: true, correlationId: correlationId };
  }
}
