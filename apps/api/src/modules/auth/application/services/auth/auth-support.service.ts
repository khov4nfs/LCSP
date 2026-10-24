import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  USER_ACCESS_STATUSES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
} from "@lcsp/contracts/auth";
import { Injectable } from "@nestjs/common";
import {
  AUTH_FAILURE_REASONS,
  authFailure,
} from "../../errors/auth-application.error.ts";

import type {
  AuditEvent,
  MfaEnrollment,
  Session,
  User,
} from "../../../domain/models/auth.models.ts";
import { Session as SessionEntity } from "../../../domain/models/auth.models.ts";
import {
  createCorrelationId,
  fingerprintToken,
  hashSecret,
  issueOpaqueToken,
} from "../../../../../platform/security/crypto.utils.js";
import type { SafeUserProjection } from "../../contracts/auth/common.contract.ts";
import type {
  MfaEnrollmentRepository,
  SessionRepository,
  UserRepository,
} from "../../ports/persistence/index.ts";
import { AuthAuditService } from "./auth-audit.service.ts";

const FAILED_LOGIN_LIMIT = 3;
const LOCK_WINDOW_MS = 5 * 60_000;
const SESSION_TTL_MS = 8 * 60 * 60_000;

@Injectable()
export class AuthSupportService {
  constructor(private readonly authAudit: AuthAuditService) {}

  createCorrelationId(): string {
    return createCorrelationId();
  }

  now(): number {
    return Date.now();
  }

  get failedLoginLimit(): number {
    return FAILED_LOGIN_LIMIT;
  }

  get lockWindowMs(): number {
    return LOCK_WINDOW_MS;
  }

  safeUserProjection(user: User): SafeUserProjection {
    return {
      user_id: user.id,
      email: user.email.toString(),
      subject_attributes: { role: user.role },
    };
  }

  isMfaRequired(user: User, mfaEnrollment: MfaEnrollment | null): boolean {
    return (
      user.mfaRequired ||
      (mfaEnrollment !== null && mfaEnrollment.verifiedAt !== null)
    );
  }

  isMfaEnrolled(mfaEnrollment: MfaEnrollment | null): boolean {
    return mfaEnrollment !== null && mfaEnrollment.verifiedAt !== null;
  }

  recordAudit(event: AuditEvent): Promise<void> {
    return this.authAudit.write(event);
  }

  /**
   * Business purpose: Establish a new authenticated session with the account's current proof generation.
   *
   * Business rules:
   * - Suspended accounts are never issued sessions.
   * - Newly issued sessions do not inherit MFA or sensitive-action proofs from earlier generations.
   *
   * Execution flow:
   * 1. Require an active account and issue a random opaque bearer token.
   * 2. Persist the token hash, account access version and current proof generation.
   * 3. Record session creation without logging the bearer token.
   *
   * Failure cases:
   * - Suspended accounts or failed persistence reject the sign-in transaction.
   *
   * Side effects:
   * - Creates a session record and security audit event.
   */
  async createSession(
    sessions: SessionRepository,
    user: User,
    correlationId: string,
  ): Promise<{ token: string; session: Session }> {
    if (user.accessStatus !== USER_ACCESS_STATUSES.active)
      throw authFailure(AUTH_ERROR_CODES.accountSuspended, correlationId, {
        reason: AUTH_FAILURE_REASONS.accessDenied,
      });
    const token = issueOpaqueToken();
    const fingerprint = fingerprintToken(token);
    const session = new SessionEntity({
      userId: user.id,
      accessVersion: user.accessVersion,
      mfaGenerationId: user.mfaGenerationId,
      tokenHash: hashSecret(token),
      expiresAt: this.now() + SESSION_TTL_MS,
      revokedAt: null,
    });
    await sessions.save(session, fingerprint);
    await this.recordAudit({
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.sessionCreated,
      actor_id: user.id,
      decision: AUDIT_DECISIONS.allow,
      correlationId: correlationId,
      session_id: session.id,
    });
    return { token, session };
  }

  async findValidSession(
    sessions: SessionRepository,
    users: UserRepository,
    token: string,
  ): Promise<Session | null> {
    const session = await sessions.findByFingerprint(fingerprintToken(token));

    if (!session) {
      return null;
    }

    if (!session.isActive(this.now())) {
      return null;
    }

    const user = await users.findById(session.userId);
    if (
      !user ||
      user.accessStatus !== USER_ACCESS_STATUSES.active ||
      user.accessVersion !== session.accessVersion
    )
      return null;
    return session;
  }

  findMfaEnrollment(
    mfaEnrollments: MfaEnrollmentRepository,
    userId: string,
  ): Promise<MfaEnrollment | null> {
    return mfaEnrollments.findByUserId(userId);
  }
}
