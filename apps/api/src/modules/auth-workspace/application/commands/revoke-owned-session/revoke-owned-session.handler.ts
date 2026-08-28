import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import { HttpStatus } from "@nestjs/common";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { AUTH_RECORD_TYPES } from "../../../infrastructure/persistence/auth-record.persistence.ts";
import type { RevokeOwnedSessionSuccess } from "../../contracts/auth-workspace/settings.contract.ts";
import { AuthWorkspaceSupportService } from "../../services/auth-workspace/auth-workspace-support.service.ts";
import { RevokeOwnedSessionCommand } from "./revoke-owned-session.command.ts";

export class RevokeOwnedSessionHandler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly support: AuthWorkspaceSupportService,
  ) {}

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
