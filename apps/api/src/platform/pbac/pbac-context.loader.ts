import { Inject, Injectable } from "@nestjs/common";
import { PBAC_REASON_CODE } from "@lcsp/contracts/pbac";
import type {
  Membership,
  Policy,
  Session,
} from "../../modules/auth-workspace/domain/models/auth-workspace.models.js";
import {
  fingerprintToken,
  verifySecret,
} from "../../modules/auth-workspace/infrastructure/security/security.utils.js";
import {
  PrismaMembershipRepository,
  PrismaMfaEnrollmentRepository,
  PrismaPolicyRepository,
  PrismaSessionRepository,
} from "../../modules/auth-workspace/infrastructure/persistence/prisma-auth-workspace.repositories.js";
import type { MembershipRepository } from "../../modules/auth-workspace/application/ports/persistence/membership.repository.js";
import type { MfaEnrollmentRepository } from "../../modules/auth-workspace/application/ports/persistence/mfa.repository.js";
import type { PolicyRepository } from "../../modules/auth-workspace/application/ports/persistence/policy.repository.js";
import type { SessionRepository } from "../../modules/auth-workspace/application/ports/persistence/session.repository.js";

export type PbacContextDenialReason =
  | typeof PBAC_REASON_CODE.sessionInvalid
  | typeof PBAC_REASON_CODE.mfaRequired
  | typeof PBAC_REASON_CODE.membershipMissing
  | typeof PBAC_REASON_CODE.policyNotFound
  | typeof PBAC_REASON_CODE.loadError;

export type PbacContextResult =
  | { ok: true; session: Session; membership: Membership; policy: Policy }
  | {
      ok: false;
      reason: PbacContextDenialReason;
      mfaEnrolled?: boolean;
    };

/**
 * Loads the authenticated PBAC context in session → MFA → membership → policy order.
 * Reuses the auth-workspace repositories instead of querying Prisma directly so session and membership semantics remain consistent across authentication and PBAC paths.
 */
@Injectable()
export class PbacContextLoader {
  /**
   * Creates the loader with the repositories needed to resolve authorization context.
   *
   * @param sessions - Session repository used to validate the presented bearer token.
   * @param memberships - Membership repository used to resolve the user's organization membership.
   * @param policies - Policy repository used to resolve the membership's pinned policy version.
   * @param mfaEnrollments - MFA repository used to determine whether verified MFA is required for the session.
   */
  constructor(
    @Inject(PrismaSessionRepository)
    private readonly sessions: SessionRepository,
    @Inject(PrismaMembershipRepository)
    private readonly memberships: MembershipRepository,
    @Inject(PrismaPolicyRepository)
    private readonly policies: PolicyRepository,
    @Inject(PrismaMfaEnrollmentRepository)
    private readonly mfaEnrollments: MfaEnrollmentRepository,
  ) {}

  /**
   * Validates a session token and resolves the active membership plus policy required for PBAC evaluation.
   *
   * @param token - Raw bearer token presented by the request.
   * @param now - Current time in milliseconds used to evaluate session activity.
   * @param options - Loading options, including whether a pending-MFA session is temporarily acceptable.
   * @returns A resolved PBAC context or a fail-closed denial reason.
   */
  async load(
    token: string,
    now: number,
    options: { allowPendingMfa?: boolean } = {},
  ): Promise<PbacContextResult> {
    try {
      const fingerprint = fingerprintToken(token);
      const session = await this.sessions.findByFingerprint(fingerprint);
      if (
        !session ||
        !verifySecret(token, session.tokenHash) ||
        !session.isActive(now)
      ) {
        return { ok: false, reason: PBAC_REASON_CODE.sessionInvalid };
      }

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
          reason: PBAC_REASON_CODE.mfaRequired,
          mfaEnrolled: true,
        };
      }

      const membership = await this.memberships.findByUserAndOrganization(
        session.userId,
        session.organizationId,
      );
      if (!membership || !membership.isActive()) {
        return { ok: false, reason: PBAC_REASON_CODE.membershipMissing };
      }

      const policy = await this.policies.findByIdAndVersion(
        membership.policyId,
        membership.policyVersion,
      );
      if (!policy) {
        return { ok: false, reason: PBAC_REASON_CODE.policyNotFound };
      }

      return { ok: true, session, membership, policy };
    } catch {
      // Any unexpected DB failure at any stage — deny, never allow on error.
      return { ok: false, reason: PBAC_REASON_CODE.loadError };
    }
  }
}
