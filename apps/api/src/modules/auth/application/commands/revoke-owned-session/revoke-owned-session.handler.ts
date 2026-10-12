import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import { HttpStatus } from "@nestjs/common";

import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { AUTH_RECORD_TYPES } from "../../../infrastructure/persistence/auth-record.persistence.ts";
import type { RevokeOwnedSessionSuccess } from "../../contracts/auth/settings.contract.ts";
import { AuthSupportService } from "../../services/auth/auth-support.service.ts";
import { RevokeOwnedSessionCommand } from "./revoke-owned-session.command.ts";

/**
 * Handles revoking a specific session owned by the authenticated user.
 *
 * Enforces:
 * 1. Verifies the target session ID exists and belongs to the authenticated user (`command.context.userId`).
 * 2. Throws 404 problemException if session is not found or owned by another user.
 * 3. Idempotently marks session as revoked.
 */
@CommandHandler(RevokeOwnedSessionCommand)
export class RevokeOwnedSessionHandler implements ICommandHandler<RevokeOwnedSessionCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly support: AuthSupportService,
  ) {}

  /**
   * Executes revocation of an owned session.
   *
   * @param command - Contains target sessionId, caller auth context, and request metadata.
   * @returns Success response with revoked session ID.
   */
  async execute(
    command: RevokeOwnedSessionCommand,
  ): Promise<RevokeOwnedSessionSuccess> {
    const correlationId =
      command.requestMeta.correlationId ?? this.support.createCorrelationId();
    const session = await this.prisma.authRecord.findFirst({
      where: {
        id: command.sessionId,
        userId: command.context.userId,
        type: AUTH_RECORD_TYPES.session,
      },
    });

    if (!session) {
      throw problemException(AUTH_ERROR_CODES.sessionInvalid, correlationId, {
        status: HttpStatus.NOT_FOUND,
      });
    }

    if (!session.revokedAt) {
      await this.prisma.authRecord.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
    }

    return {
      ok: true,
      revoked_session_id: session.id,
    };
  }
}
