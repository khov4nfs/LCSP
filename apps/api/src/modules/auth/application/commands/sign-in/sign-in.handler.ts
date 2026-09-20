import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  USER_ACCESS_STATUSES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
} from "@lcsp/contracts/auth";

import { Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { problemException } from "../../../../../platform/problems/problem-factory.js";
import {
  hashSecret,
  verifySecret,
} from "../../../infrastructure/security/security.utils.ts";
import type { SignInSuccess } from "../../contracts/auth/sign-in.contract.ts";
import {
  AUTH_MFA_ENROLLMENT_REPOSITORY,
  AUTH_SESSION_REPOSITORY,
  AUTH_USER_REPOSITORY,
  type MfaEnrollmentRepository,
  type SessionRepository,
  type UserRepository,
} from "../../ports/persistence/index.ts";
import { AuthSupportService } from "../../services/auth/auth-support.service.ts";
import { SignInCommand } from "./sign-in.command.ts";

const DECOY_PASSWORD_HASH = hashSecret(
  "decoy-password-for-constant-time-compare",
);

@CommandHandler(SignInCommand)
export class SignInHandler implements ICommandHandler<SignInCommand> {
  constructor(
    private readonly support: AuthSupportService,
    @Inject(AUTH_USER_REPOSITORY)
    private readonly users: UserRepository,
    @Inject(AUTH_SESSION_REPOSITORY)
    private readonly sessions: SessionRepository,
    @Inject(AUTH_MFA_ENROLLMENT_REPOSITORY)
    private readonly mfaEnrollments: MfaEnrollmentRepository,
  ) {}

  async execute(command: SignInCommand): Promise<SignInSuccess> {
    const { payload, requestMeta } = command;
    const { users, sessions, mfaEnrollments } = this;
    const correlationId =
      requestMeta.correlationId ?? this.support.createCorrelationId();
    this.support.validateCredentialPayload(payload, correlationId);

    const email = payload.email as string;
    const password = payload.password as string;
    const user = await users.findByPrimaryEmail(email.toLowerCase());
    if (!user) {
      // Run the same scrypt-based comparison as the found-user path so the
      // response latency doesn't reveal whether the email is registered.
      verifySecret(password, DECOY_PASSWORD_HASH);
      await this.support.recordAudit({
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.loginFailed,
        actor_id: null,
        decision: AUDIT_DECISIONS.deny,
        reason_code: AUTH_ERROR_CODES.invalidCredentials,
        correlationId: correlationId,
      });
      throw problemException(
        AUTH_ERROR_CODES.invalidCredentials,
        correlationId,
      );
    }

    if (user.isLocked(this.support.now())) {
      await this.support.recordAudit({
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.loginFailed,
        actor_id: user.id,
        decision: AUDIT_DECISIONS.deny,
        reason_code: AUTH_ERROR_CODES.temporaryLock,
        correlationId: correlationId,
      });
      throw problemException(
        AUTH_ERROR_CODES.temporaryLock,
        correlationId,
        temporaryLockProblemOverrides(user.lockUntil, this.support.now()),
      );
    }

    if (!verifySecret(password, user.passwordHash)) {
      user.recordFailedLogin(
        this.support.now(),
        this.support.failedLoginLimit,
        this.support.lockWindowMs,
      );
      await users.save(user);
      await this.support.recordAudit({
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.loginFailed,
        actor_id: user.id,
        decision: AUDIT_DECISIONS.deny,
        reason_code: user.lockUntil
          ? AUTH_ERROR_CODES.temporaryLock
          : AUTH_ERROR_CODES.invalidCredentials,
        correlationId: correlationId,
      });
      throw problemException(
        user.lockUntil
          ? AUTH_ERROR_CODES.temporaryLock
          : AUTH_ERROR_CODES.invalidCredentials,
        correlationId,
        user.lockUntil
          ? temporaryLockProblemOverrides(user.lockUntil, this.support.now())
          : undefined,
      );
    }

    if (user.accessStatus !== USER_ACCESS_STATUSES.active) {
      throw problemException(AUTH_ERROR_CODES.accountSuspended, correlationId);
    }

    user.clearFailedLogins();
    await users.save(user);

    if (!user.emailVerified) {
      await this.support.recordAudit({
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.loginFailed,
        actor_id: user.id,
        decision: AUDIT_DECISIONS.deny,
        reason_code: AUTH_ERROR_CODES.emailVerificationRequired,
        correlationId: correlationId,
      });
      throw problemException(
        AUTH_ERROR_CODES.emailVerificationRequired,
        correlationId,
      );
    }

    const sessionState = await this.support.createSession(
      sessions,
      user,
      correlationId,
    );
    await this.support.recordAudit({
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.loginSucceeded,
      actor_id: user.id,
      decision: AUDIT_DECISIONS.allow,
      correlationId: correlationId,
    });

    const mfaEnrollment = await this.support.findMfaEnrollment(
      mfaEnrollments,
      user.id,
    );
    const mfaRequired = this.support.isMfaRequired(user, mfaEnrollment);

    return {
      ok: true,
      correlationId: correlationId,
      session_token: sessionState.token,
      user: this.support.safeUserProjection(user),
      mfa_enrolled: this.support.isMfaEnrolled(mfaEnrollment),
      ...(mfaRequired ? { mfa_required: true } : {}),
    };
  }
}

function temporaryLockProblemOverrides(lockUntil: number | null, now: number) {
  if (lockUntil === null) {
    return undefined;
  }

  return {
    meta: {
      lockedUntil: new Date(lockUntil).toISOString(),
      retryAfterSeconds: Math.max(0, Math.ceil((lockUntil - now) / 1000)),
    },
  };
}
