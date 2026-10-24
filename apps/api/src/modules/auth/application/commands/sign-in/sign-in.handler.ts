import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  USER_ACCESS_STATUSES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
} from "@lcsp/contracts/auth";

import { Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import {
  hashSecret,
  verifySecret,
} from "../../../../../platform/security/crypto.utils.js";
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

/**
 * Handles user sign-in via primary email and password.
 *
 * Enforces:
 * 1. Constant-time secret comparison against decoy hash on missing email to prevent enumeration timing attacks.
 * 2. Account temporary lockout checks with retry metadata.
 * 3. Constant-time password hash verification with incremental failed-attempt lock escalation.
 * 4. Active access status check (rejects suspended accounts).
 * 5. Email verification prerequisite check.
 * 6. Session issuance with MFA status discovery.
 * 7. Comprehensive audit logging for succeeded and failed authentication attempts.
 */
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

  /**
   * Executes sign-in authentication flow.
   *
   * @param command - Contains sign-in payload (email, password) and request metadata.
   * @returns Session token, safe user projection, and MFA requirement flags.
   */
  async execute(command: SignInCommand): Promise<SignInSuccess> {
    const { payload, requestMeta } = command;
    const { users, sessions, mfaEnrollments } = this;
    const correlationId =
      requestMeta.correlationId ?? this.support.createCorrelationId();

    const email = payload.email;
    const password = payload.password;
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
      const current = await users.recordFailedLoginAttempt(
        user.id,
        user.passwordHash,
        this.support.now(),
        this.support.failedLoginLimit,
        this.support.lockWindowMs,
      );
      const lockUntil = current?.lockUntil ?? null;
      await this.support.recordAudit({
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.loginFailed,
        actor_id: user.id,
        decision: AUDIT_DECISIONS.deny,
        reason_code: lockUntil
          ? AUTH_ERROR_CODES.temporaryLock
          : AUTH_ERROR_CODES.invalidCredentials,
        correlationId: correlationId,
      });
      throw problemException(
        lockUntil
          ? AUTH_ERROR_CODES.temporaryLock
          : AUTH_ERROR_CODES.invalidCredentials,
        correlationId,
        lockUntil
          ? temporaryLockProblemOverrides(lockUntil, this.support.now())
          : undefined,
      );
    }

    if (user.accessStatus !== USER_ACCESS_STATUSES.active) {
      throw problemException(AUTH_ERROR_CODES.accountSuspended, correlationId);
    }

    const currentUser = await users.clearFailedLoginsIfCredentialsCurrent(
      user.id,
      user.passwordHash,
      this.support.now(),
    );
    if (!currentUser) {
      await this.support.recordAudit({
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.loginFailed,
        actor_id: user.id,
        decision: AUDIT_DECISIONS.deny,
        reason_code: AUTH_ERROR_CODES.invalidCredentials,
        correlationId,
      });
      throw problemException(
        AUTH_ERROR_CODES.invalidCredentials,
        correlationId,
      );
    }

    if (!currentUser.emailVerified) {
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
      currentUser,
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
      currentUser.id,
    );
    const mfaRequired = this.support.isMfaRequired(currentUser, mfaEnrollment);

    return {
      ok: true,
      correlationId: correlationId,
      session_token: sessionState.token,
      user: this.support.safeUserProjection(currentUser),
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
