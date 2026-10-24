import * as crypto from "node:crypto";
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import type { RecoveryRequestRepository } from "../../application/ports/persistence/recovery-request.repository.ts";
import type { RecoveryRequest } from "../../domain/models/auth.models.ts";
import {
  AUTH_RECORD_TYPES,
  authRecordLookupKey,
} from "./auth-record.persistence.ts";
import {
  dateFromEpochMs,
  dateFromEpochMsRequired,
  mapRecoveryRequestRecord,
} from "./prisma-auth.mappers.ts";

@Injectable()
export class PrismaRecoveryRequestRepository implements RecoveryRequestRepository {
  constructor(private readonly prisma: PrismaService) {}

  nextId(): string {
    return crypto.randomUUID();
  }

  async save(request: RecoveryRequest, fingerprint?: string): Promise<void> {
    const tokenFingerprint =
      fingerprint ?? (await this.resolveFingerprint(request));
    await this.prisma.authRecord.upsert({
      where: { id: request.id },
      create: {
        id: request.id,
        userId: request.userId,
        type: AUTH_RECORD_TYPES.recoveryRequest,
        lookupKey: authRecordLookupKey(
          AUTH_RECORD_TYPES.recoveryRequest,
          tokenFingerprint,
        ),
        secretHash: request.tokenHash,
        expiresAt: dateFromEpochMsRequired(request.expiresAt),
        usedAt: dateFromEpochMs(request.consumedAt),
        metadata: { tokenFingerprint },
      },
      update: {
        lookupKey: authRecordLookupKey(
          AUTH_RECORD_TYPES.recoveryRequest,
          tokenFingerprint,
        ),
        secretHash: request.tokenHash,
        expiresAt: dateFromEpochMsRequired(request.expiresAt),
        usedAt: dateFromEpochMs(request.consumedAt),
        metadata: { tokenFingerprint },
      },
    });
  }

  async findByFingerprint(
    fingerprint: string,
  ): Promise<RecoveryRequest | null> {
    const record = await this.prisma.authRecord.findUnique({
      where: {
        lookupKey: authRecordLookupKey(
          AUTH_RECORD_TYPES.recoveryRequest,
          fingerprint,
        ),
      },
    });
    return record?.type === AUTH_RECORD_TYPES.recoveryRequest
      ? mapRecoveryRequestRecord(record)
      : null;
  }

  private async resolveFingerprint(request: RecoveryRequest): Promise<string> {
    const existing = await this.prisma.authRecord.findUnique({
      where: { id: request.id },
      select: { type: true, lookupKey: true },
    });
    if (!existing || existing.type !== AUTH_RECORD_TYPES.recoveryRequest) {
      throw new Error(
        `Recovery request fingerprint is required for new request ${request.id}`,
      );
    }
    return existing.lookupKey.slice(
      `${AUTH_RECORD_TYPES.recoveryRequest}:`.length,
    );
  }
}
