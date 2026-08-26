import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AuthSessionsSuccess } from "../../contracts/auth-workspace/settings.contract.ts";
import { ListAuthSessionsQuery } from "./list-auth-sessions.query.ts";

export class ListAuthSessionsHandler {
  constructor(private readonly prisma: PrismaService) {}

  async execute(query: ListAuthSessionsQuery): Promise<AuthSessionsSuccess> {
    const sessions = await this.prisma.authSession.findMany({
      where: {
        userId: query.context.userId,
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    });

    return {
      ok: true,
      sessions: sessions.map((session) => ({
        id: session.id,
        created_at: session.createdAt.toISOString(),
        updated_at: session.updatedAt.toISOString(),
        expires_at: session.expiresAt.toISOString(),
        revoked_at: session.revokedAt?.toISOString() ?? null,
        mfa_verified_at: session.mfaVerifiedAt?.toISOString() ?? null,
        is_current: session.id === query.context.sessionId,
      })),
    };
  }
}
