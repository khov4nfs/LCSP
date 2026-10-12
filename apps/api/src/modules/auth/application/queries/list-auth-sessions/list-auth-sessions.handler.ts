import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import {
  AUTH_RECORD_TYPES,
  authRecordMetadataDate,
} from "../../../infrastructure/persistence/auth-record.persistence.ts";
import type { AuthSessionsSuccess } from "../../contracts/auth/settings.contract.ts";
import { ListAuthSessionsQuery } from "./list-auth-sessions.query.ts";

/**
 * Handles listing all active and historical sessions for the authenticated user.
 *
 * Enforces:
 * 1. Queries auth sessions belonging exclusively to `query.context.userId`.
 * 2. Orders results chronologically by recent activity (`updatedAt` DESC, `createdAt` DESC).
 * 3. Annotates each session with MFA verification timestamp and `is_current` boolean flag.
 */
@QueryHandler(ListAuthSessionsQuery)
export class ListAuthSessionsHandler implements IQueryHandler<ListAuthSessionsQuery> {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Executes session listing query.
   *
   * @param query - Contains caller context (userId, sessionId) and correlationId.
   * @returns List of formatted session records.
   */
  async execute(query: ListAuthSessionsQuery): Promise<AuthSessionsSuccess> {
    const sessions = await this.prisma.authRecord.findMany({
      where: {
        userId: query.context.userId,
        type: AUTH_RECORD_TYPES.session,
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    });

    return {
      ok: true,
      sessions: sessions.map((session) => ({
        id: session.id,
        created_at: session.createdAt.toISOString(),
        updated_at: session.updatedAt.toISOString(),
        expires_at: requireDate(session.expiresAt).toISOString(),
        revoked_at: session.revokedAt?.toISOString() ?? null,
        mfa_verified_at:
          authRecordMetadataDate(session, "mfaVerifiedAt")?.toISOString() ??
          null,
        is_current: session.id === query.context.sessionId,
      })),
    };
  }
}

function requireDate(value: Date | null): Date {
  if (!value) {
    throw new Error("SESSION_EXPIRES_AT_MISSING");
  }
  return value;
}
