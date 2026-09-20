import { USER_ACCESS_STATUSES } from "@lcsp/contracts/auth";
import { Inject, Injectable } from "@nestjs/common";
import {
  AUTH_MFA_ENROLLMENT_REPOSITORY,
  AUTH_SESSION_REPOSITORY,
  AUTH_USER_REPOSITORY,
  type MfaEnrollmentRepository,
  type SessionRepository,
  type UserRepository,
} from "../../modules/auth/application/ports/persistence/index.js";
import type {
  Session,
  User,
} from "../../modules/auth/domain/models/auth.models.js";
import { fingerprintToken, verifySecret } from "../security/crypto.utils.js";
import {
  RBAC_REASON_CODES,
  type RbacContextDenialReason,
} from "@lcsp/contracts/rbac";

export type RbacContextResult =
  | {
      ok: true;
      session: Session;
      user: User;
    }
  | {
      ok: false;
      reason: RbacContextDenialReason;
      mfaEnrolled?: boolean;
    };

/**
 * Loads the authenticated RBAC context in session → MFA → user role order.
 */
@Injectable()
export class RbacContextLoader {
  constructor(
    @Inject(AUTH_SESSION_REPOSITORY)
    private readonly sessions: SessionRepository,
    @Inject(AUTH_USER_REPOSITORY)
    private readonly users: UserRepository,
    @Inject(AUTH_MFA_ENROLLMENT_REPOSITORY)
    private readonly mfaEnrollments: MfaEnrollmentRepository,
  ) {}

  async load(
    token: string,
    now: number,
    options: { allowPendingMfa?: boolean } = {},
  ): Promise<RbacContextResult> {
    try {
      const fingerprint = fingerprintToken(token);
      const session = await this.sessions.findByFingerprint(fingerprint);
      if (
        !session ||
        !verifySecret(token, session.tokenHash) ||
        !session.isActive(now)
      ) {
        return { ok: false, reason: RBAC_REASON_CODES.sessionInvalid };
      }

      const user = await this.users.findById(session.userId);
      if (!user) {
        return { ok: false, reason: RBAC_REASON_CODES.loadError };
      }
      if (user.accessStatus !== USER_ACCESS_STATUSES.active)
        return { ok: false, reason: RBAC_REASON_CODES.accountSuspended };
      if (user.accessVersion !== session.accessVersion)
        return { ok: false, reason: RBAC_REASON_CODES.sessionInvalid };

      const mfaEnrollment = await this.mfaEnrollments.findByUserId(
        session.userId,
      );
      if (
        !options.allowPendingMfa &&
        mfaEnrollment !== null &&
        mfaEnrollment.verifiedAt !== null &&
        !session.isMfaVerified()
      ) {
        return {
          ok: false,
          reason: RBAC_REASON_CODES.mfaRequired,
          mfaEnrolled: true,
        };
      }

      return {
        ok: true,
        session,
        user,
      };
    } catch {
      return { ok: false, reason: RBAC_REASON_CODES.loadError };
    }
  }
}
