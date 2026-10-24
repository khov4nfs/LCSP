import * as crypto from "node:crypto";
import { AUTH_ERROR_CODES, USER_ACCESS_STATUSES } from "@lcsp/contracts/auth";
import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import {
  APPLICATION_ERROR_REASONS,
  ApplicationError,
} from "../../../../common/errors/application.error.ts";
import type { SessionRepository } from "../../application/ports/persistence/session.repository.ts";
import type { Session } from "../../domain/models/auth.models.ts";
import {
  AUTH_RECORD_TYPES,
  authRecordDateMetadata,
  authRecordLookupKey,
} from "./auth-record.persistence.ts";
import {
  dateFromEpochMs,
  dateFromEpochMsRequired,
  mapSessionRecord,
} from "./prisma-auth.mappers.ts";

@Injectable()
export class PrismaSessionRepository implements SessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  nextId(): string {
    return crypto.randomUUID();
  }

  async save(session: Session, fingerprint?: string): Promise<void> {
    const tokenFingerprint =
      fingerprint ?? (await this.resolveFingerprint(session));
    const metadata = {
      tokenFingerprint,
      mfaVerifiedAt: authRecordDateMetadata(session.mfaVerifiedAt),
      sensitiveActionVerifiedAt: authRecordDateMetadata(
        session.sensitiveActionVerifiedAt,
      ),
    } satisfies Prisma.InputJsonObject;

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${session.userId} FOR UPDATE`,
      );
      const user = await tx.user.findUnique({
        where: { id: session.userId },
        select: {
          accessStatus: true,
          accessVersion: true,
          mfaEncryptedSecret: true,
          mfaVerifiedAt: true,
        },
      });
      if (
        !user ||
        (session.revokedAt === null &&
          (user.accessStatus !== USER_ACCESS_STATUSES.active ||
            user.accessVersion !== session.accessVersion ||
            // Prevent a late MFA verification from resurrecting a disabled MFA state.
            (session.mfaVerifiedAt !== null &&
              (!user.mfaEncryptedSecret || !user.mfaVerifiedAt))))
      ) {
        throw new ApplicationError(
          AUTH_ERROR_CODES.sessionInvalid,
          crypto.randomUUID(),
          { reason: APPLICATION_ERROR_REASONS.authenticationRequired },
        );
      }
      const existing = await tx.authRecord.findUnique({
        where: { id: session.id },
        select: { id: true },
      });
      if (existing) {
        // An MFA/reauth write from a stale entity must never un-revoke a session.
        const updated = await tx.authRecord.updateMany({
          where: {
            id: session.id,
            userId: session.userId,
            type: AUTH_RECORD_TYPES.session,
            revokedAt: null,
          },
          data: {
            revokedAt: dateFromEpochMs(session.revokedAt),
            metadata: { ...metadata, accessVersion: session.accessVersion },
          },
        });
        if (updated.count === 0 && session.revokedAt === null)
          throw new ApplicationError(
            AUTH_ERROR_CODES.sessionInvalid,
            crypto.randomUUID(),
            { reason: APPLICATION_ERROR_REASONS.authenticationRequired },
          );
      } else {
        await tx.authRecord.create({
          data: {
            id: session.id,
            userId: session.userId,
            type: AUTH_RECORD_TYPES.session,
            lookupKey: authRecordLookupKey(
              AUTH_RECORD_TYPES.session,
              tokenFingerprint,
            ),
            secretHash: session.tokenHash,
            expiresAt: dateFromEpochMsRequired(session.expiresAt),
            revokedAt: dateFromEpochMs(session.revokedAt),
            metadata: { ...metadata, accessVersion: session.accessVersion },
          },
        });
      }
    });
  }

  async findById(id: string): Promise<Session | null> {
    const record = await this.prisma.authRecord.findUnique({
      where: { id },
    });
    return record?.type === AUTH_RECORD_TYPES.session
      ? mapSessionRecord(record)
      : null;
  }

  async findByFingerprint(fingerprint: string): Promise<Session | null> {
    const record = await this.prisma.authRecord.findUnique({
      where: {
        lookupKey: authRecordLookupKey(AUTH_RECORD_TYPES.session, fingerprint),
      },
    });
    return record?.type === AUTH_RECORD_TYPES.session
      ? mapSessionRecord(record)
      : null;
  }

  private async resolveFingerprint(session: Session): Promise<string> {
    const existing = await this.prisma.authRecord.findUnique({
      where: { id: session.id },
      select: { type: true, lookupKey: true },
    });
    if (!existing || existing.type !== AUTH_RECORD_TYPES.session) {
      throw new Error(
        `Session fingerprint is required for new session ${session.id}`,
      );
    }
    return existing.lookupKey.slice(`${AUTH_RECORD_TYPES.session}:`.length);
  }

  async revokeOwned(
    sessionId: string,
    userId: string,
    now: number,
  ): Promise<boolean> {
    const session = await this.prisma.authRecord.findFirst({
      where: { id: sessionId, userId, type: AUTH_RECORD_TYPES.session },
      select: { id: true },
    });
    if (!session) return false;

    // Restrict the write to the owner and session type even if the row changes
    // between the ownership lookup and the update. Already-revoked is success.
    await this.prisma.authRecord.updateMany({
      where: {
        id: sessionId,
        userId,
        type: AUTH_RECORD_TYPES.session,
        revokedAt: null,
      },
      data: { revokedAt: new Date(now) },
    });
    return true;
  }

  async revokeAllForUser(userId: string, now: number): Promise<void> {
    await this.prisma.authRecord.updateMany({
      where: {
        userId,
        type: AUTH_RECORD_TYPES.session,
        revokedAt: null,
        expiresAt: { gt: new Date(now) },
      },
      data: { revokedAt: new Date(now) },
    });
  }
}
