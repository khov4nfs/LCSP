import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  USER_ACCESS_STATUSES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
} from "@lcsp/contracts/auth";
import { HttpStatus } from "@nestjs/common";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";

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
} from "../../../infrastructure/security/security.utils.ts";
import type { SafeUserProjection } from "../../contracts/auth/common.contract.ts";
import type {
  MfaEnrollmentRepository,
  SessionRepository,
  UserRepository,
} from "../../ports/persistence/index.ts";
import type { AuthAuditService } from "./auth-audit.service.ts";

const FAILED_LOGIN_LIMIT = 3;
const LOCK_WINDOW_MS = 15 * 60_000;
const SESSION_TTL_MS = 8 * 60 * 60_000;

export class AuthSupportService {
  constructor(private readonly authAudit?: AuthAuditService) {}

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

  recordAudit(
    repositoriesOrEvent: unknown,
    maybeEvent?: AuditEvent,
  ): Promise<void> {
    const event = (maybeEvent ?? repositoriesOrEvent) as AuditEvent;
    if (!this.authAudit) {
      return Promise.resolve();
    }
    return this.authAudit.write(event);
  }

  resolveUserById(
    repositoriesOrUsers: { users: UserRepository } | UserRepository,
    userId: string,
  ): Promise<User | null> {
    const repo =
      "users" in repositoriesOrUsers
        ? repositoriesOrUsers.users
        : repositoriesOrUsers;
    return repo.findById(userId);
  }

  async createSession(
    repositoriesOrSessions: { sessions: SessionRepository } | SessionRepository,
    user: User,
    correlationId: string,
  ): Promise<{ token: string; session: Session }> {
    const sessions =
      "sessions" in repositoriesOrSessions
        ? repositoriesOrSessions.sessions
        : repositoriesOrSessions;
    if (user.accessStatus !== USER_ACCESS_STATUSES.active)
      throw problemException(AUTH_ERROR_CODES.accountSuspended, correlationId, {
        status: HttpStatus.FORBIDDEN,
      });
    const token = issueOpaqueToken();
    const fingerprint = fingerprintToken(token);
    const session = new SessionEntity({
      userId: user.id,
      accessVersion: user.accessVersion,
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
    repositoriesOrSessions:
      | { sessions: SessionRepository; users: UserRepository }
      | SessionRepository,
    usersOrToken: UserRepository | string,
    maybeToken?: string,
  ): Promise<Session | null> {
    const sessions =
      "sessions" in repositoriesOrSessions
        ? repositoriesOrSessions.sessions
        : repositoriesOrSessions;
    const users =
      "users" in repositoriesOrSessions
        ? repositoriesOrSessions.users
        : (usersOrToken as UserRepository);
    const token =
      typeof usersOrToken === "string" ? usersOrToken : (maybeToken as string);

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
    repositoriesOrMfa:
      { mfaEnrollments: MfaEnrollmentRepository } | MfaEnrollmentRepository,
    userId: string,
  ): Promise<MfaEnrollment | null> {
    const repo =
      "mfaEnrollments" in repositoriesOrMfa
        ? repositoriesOrMfa.mfaEnrollments
        : repositoriesOrMfa;
    return repo.findByUserId(userId);
  }
}
