import { SENSITIVE_ACTION_REAUTH_TTL_MS } from "../../../domain/entities/session.entity.ts";
import { Inject, Injectable } from "@nestjs/common";
import {
  AUTH_ERROR_CODES,
  REQUIRED_ACTIONS,
  USER_ACCESS_STATUSES,
} from "@lcsp/contracts/auth";
import {
  AUTH_SESSION_REPOSITORY,
  AUTH_USER_REPOSITORY,
  type SessionRepository,
  type UserRepository,
} from "../../ports/persistence/index.ts";
import { authFailure } from "../../errors/auth-application.error.ts";
import type { RbacRequestContext } from "../../../../../platform/rbac/interfaces/rbac-request.interface.ts";

@Injectable()
export class SessionManagementService {
  constructor(
    @Inject(AUTH_SESSION_REPOSITORY)
    private readonly sessions: SessionRepository,
    @Inject(AUTH_USER_REPOSITORY) private readonly users: UserRepository,
  ) {}

  /**
   * Business purpose: Authorize session revocation with recent proof from the calling account.
   * Business rules:
   * - Caller must own an active session of an active account at the current access version.
   * - Accept recent password or MFA step-up only from the current account proof generation.
   * - Accounts requiring MFA must also have completed that factor for this session.
   * Execution flow:
   * 1. Read the caller session and owner, and reject invalid access.
   * 2. Verify MFA eligibility and a non-future step-up timestamp within five minutes.
   * Failure cases:
   * - Invalid callers receive SESSION_INVALID; missing MFA receives MFA_REQUIRED;
   *   missing, stale or rotated proof receives REAUTH_REQUIRED without revoking anything.
   * Side effects:
   * - Read-only authorization; credentials and proofs never leave the backend.
   */
  async authorize(
    context: RbacRequestContext,
    now: number,
    correlationId: string,
  ): Promise<void> {
    const [session, user] = await Promise.all([
      this.sessions.findById(context.sessionId),
      this.users.findById(context.userId),
    ]);
    if (
      !session ||
      !user ||
      session.userId !== context.userId ||
      !session.isActive(now) ||
      user.accessStatus !== USER_ACCESS_STATUSES.active ||
      session.accessVersion !== user.accessVersion
    ) {
      throw authFailure(AUTH_ERROR_CODES.sessionInvalid, correlationId);
    }
    if (
      (user.mfaRequired || user.mfaVerifiedAt !== null) &&
      !session.isMfaVerified(user.mfaGenerationId)
    ) {
      throw authFailure(AUTH_ERROR_CODES.mfaRequired, correlationId);
    }
    const passwordFresh =
      session.passwordReauthenticatedAt !== null &&
      session.passwordReauthenticatedAt <= now &&
      session.isPasswordReauthenticated(now, user.mfaGenerationId);
    const mfaFresh =
      session.isMfaVerified(user.mfaGenerationId) &&
      session.mfaVerifiedAt !== null &&
      session.mfaVerifiedAt <= now &&
      now - session.mfaVerifiedAt <= SENSITIVE_ACTION_REAUTH_TTL_MS;
    if (!passwordFresh && !mfaFresh) {
      throw authFailure(AUTH_ERROR_CODES.reauthRequired, correlationId, {
        requiredAction: REQUIRED_ACTIONS.reauthenticate,
      });
    }
  }
}
