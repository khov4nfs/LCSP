import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import { HttpStatus } from "@nestjs/common";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
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
    const session = await this.prisma.authSession.findFirst({
      where: {
        id: command.sessionId,
        userId: command.context.userId,
        organizationId: command.context.organizationId,
      },
    });

    if (!session) {
      throw problemException(AUTH_ERROR_CODES.sessionInvalid, correlationId, {
        status: HttpStatus.NOT_FOUND,
      });
    }

    if (!session.revokedAt) {
      await this.prisma.authSession.update({
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
