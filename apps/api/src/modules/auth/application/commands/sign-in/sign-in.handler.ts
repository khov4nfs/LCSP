import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  USER_ACCESS_STATUSES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
} from "@lcsp/contracts/auth";

import { Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { authFailure } from "../../errors/auth-application.error.ts";
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
   * Business purpose: Authenticate a registered customer or administrator and establish a safe session.
   *
   * Business rules:
   * - Invalid credentials must not reveal whether the primary email exists.
   * - Login lockout, active-account status and email verification must be respected before session issuance.
   * - MFA enrollment is reported without bypassing a required second factor.
   *
   * Execution flow:
   * 1. Find the normalized primary email and verify the password without account enumeration.
   * 2. Apply lockout and account eligibility checks; record unsuccessful attempts and their audit trail.
   * 3. Create an active session, record success, then project the user's safe MFA status.
   *
   * Failure cases:
   * - Missing or incorrect credentials return INVALID_CREDENTIALS; lockout returns TEMPORARY_LOCKED.
   * - Suspended or unverified accounts are denied using their stable Auth problem codes.
   *
   * Side effects:
   * - Updates failed-login counters, creates an authenticated session and records security audit events.
   *
   * @param command - Sign-in input and correlation metadata.
   * @returns The issued session token and safe user/MFA projection.
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
      throw authFailure(AUTH_ERROR_CODES.invalidCredentials, correlationId);
    }

    if (user.isLocked(this.support.now())) {
      await this.support.recordAudit({
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.loginFailed,
        actor_id: user.id,
        decision: AUDIT_DECISIONS.deny,
        reason_code: AUTH_ERROR_CODES.temporaryLock,
        correlationId: correlationId,
      });
      throw authFailure(
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
      throw authFailure(
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
      throw authFailure(AUTH_ERROR_CODES.accountSuspended, correlationId);
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
      throw authFailure(AUTH_ERROR_CODES.invalidCredentials, correlationId);
    }

    if (!currentUser.emailVerified) {
      await this.support.recordAudit({
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.loginFailed,
        actor_id: user.id,
        decision: AUDIT_DECISIONS.deny,
        reason_code: AUTH_ERROR_CODES.emailVerificationRequired,
        correlationId: correlationId,
      });
      throw authFailure(
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
