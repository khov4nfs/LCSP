import { HttpStatus } from "@nestjs/common";
import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";

import {
  fromPrismaAuthBackupEmailPolicy,
  fromPrismaAuthPrimaryEmailAddressPolicy,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AuthProblemResult } from "../../contracts/auth-workspace/common.contract.ts";
import type { AuthProfileSuccess } from "../../contracts/auth-workspace/settings.contract.ts";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { GetAuthProfileQuery } from "./get-auth-profile.query.ts";

export class GetAuthProfileHandler {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    query: GetAuthProfileQuery,
  ): Promise<AuthProblemResult | AuthProfileSuccess> {
    const [user, session] = await Promise.all([
      this.prisma.authUser.findUnique({
        where: { id: query.context.userId },
        select: {
          id: true,
          email: true,
          emailVerified: true,
          displayName: true,
          recoveryEmail: true,
          primaryEmailAddressPolicy: true,
          backupEmailPolicy: true,
          createdAt: true,
          updatedAt: true,
          mfaEnrollment: { select: { enrolledAt: true, verifiedAt: true } },
        },
      }),
      this.prisma.authSession.findUnique({
        where: { id: query.context.sessionId },
        select: {
          id: true,
          mfaVerifiedAt: true,
          createdAt: true,
          updatedAt: true,
          expiresAt: true,
        },
      }),
    ]);

    if (!user || !session) {
      throw problemException(
        AUTH_ERROR_CODES.sessionInvalid,
        query.correlationId,
        {
          status: HttpStatus.UNAUTHORIZED,
        },
      );
    }

    const mfaEnrolled =
      user.mfaEnrollment !== null && user.mfaEnrollment.verifiedAt !== null;
    const mfaEnrolledAt = mfaEnrolled
      ? (user.mfaEnrollment?.verifiedAt?.toISOString() ?? null)
      : null;

    return {
      ok: true,
      user_id: user.id,
      email: user.email,
      email_verified: user.emailVerified,
      display_name: user.displayName,
      recovery_email: user.recoveryEmail,
      primary_email_address_policy: fromPrismaAuthPrimaryEmailAddressPolicy(
        user.primaryEmailAddressPolicy,
      ),
      backup_recovery_email_policy: fromPrismaAuthBackupEmailPolicy(
        user.backupEmailPolicy,
      ),
      created_at: user.createdAt.toISOString(),
      updated_at: user.updatedAt.toISOString(),
      role: query.context.role,
      mfa_enrolled: mfaEnrolled,
      mfa_enrolled_at: mfaEnrolledAt,
      mfa_verified: session.mfaVerifiedAt !== null,
      mfa_verified_at: session.mfaVerifiedAt?.toISOString() ?? null,
      current_session_id: session.id,
      current_session_created_at: session.createdAt.toISOString(),
      current_session_updated_at: session.updatedAt.toISOString(),
      current_session_expires_at: session.expiresAt.toISOString(),
    };
  }
}
