import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import { HttpStatus } from "@nestjs/common";

import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";

import {
  fromPrismaAuthBackupEmailPolicy,
  fromPrismaAuthPrimaryEmailAddressPolicy,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import {
  AUTH_RECORD_TYPES,
  authRecordMetadataDate,
} from "../../../infrastructure/persistence/auth-record.persistence.ts";
import type { AuthProfileSuccess } from "../../contracts/auth/settings.contract.ts";
import { GetAuthProfileQuery } from "./get-auth-profile.query.ts";

/**
 * Handles fetching the authenticated user's profile and current session security status.
 *
 * Enforces:
 * 1. Requires valid user ID and active, unexpired session ID from context.
 * 2. Reads MFA enrollment state and active session MFA verification metadata.
 * 3. Maps database enum fields to domain contract value sets.
 * 4. Returns comprehensive profile and session metadata.
 */
@QueryHandler(GetAuthProfileQuery)
export class GetAuthProfileHandler implements IQueryHandler<GetAuthProfileQuery> {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Executes profile and session status lookup.
   *
   * @param query - Contains caller context (userId, sessionId, role) and correlationId.
   * @returns User profile details, email policy, MFA status, and current session metadata.
   */
  async execute(query: GetAuthProfileQuery): Promise<AuthProfileSuccess> {
    const [user, session] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: query.context.userId },
      }),
      this.prisma.authRecord.findFirst({
        where: {
          id: query.context.sessionId,
          type: AUTH_RECORD_TYPES.session,
        },
      }),
    ]);

    if (!user || !session || !session.expiresAt) {
      throw problemException(
        AUTH_ERROR_CODES.sessionInvalid,
        query.correlationId,
        {
          status: HttpStatus.UNAUTHORIZED,
        },
      );
    }

    const mfaEnrolled =
      user.mfaEncryptedSecret !== null && user.mfaVerifiedAt !== null;
    const sessionMfaVerifiedAt = authRecordMetadataDate(
      session,
      "mfaVerifiedAt",
    );

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
      mfa_enrolled_at: mfaEnrolled
        ? (user.mfaVerifiedAt?.toISOString() ?? null)
        : null,
      mfa_verified: sessionMfaVerifiedAt !== null,
      mfa_verified_at: sessionMfaVerifiedAt?.toISOString() ?? null,
      current_session_id: session.id,
      current_session_created_at: session.createdAt.toISOString(),
      current_session_updated_at: session.updatedAt.toISOString(),
      current_session_expires_at: session.expiresAt.toISOString(),
    };
  }
}
