import * as crypto from "node:crypto";
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import type {
  MfaEnrollmentRepository,
  MfaOtpUsedRepository,
  MfaRateLimitRepository,
  MfaRecoveryCodeRepository,
} from "../../application/ports/persistence/mfa.repository.ts";
import type {
  MfaEnrollment,
  MfaRateLimit,
} from "../../domain/models/auth.models.ts";
import {
  AUTH_RECORD_TYPES,
  authRecordLookupKey,
} from "./auth-record.persistence.ts";
import {
  dateFromEpochMs,
  mapMfaEnrollmentRecord,
  mapMfaRateLimitRecord,
} from "./prisma-auth.mappers.ts";

@Injectable()
export class PrismaMfaEnrollmentRepository implements MfaEnrollmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByUserId(userId: string): Promise<MfaEnrollment | null> {
    const record = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!record?.mfaEncryptedSecret || !record.mfaEnrolledAt) {
      return null;
    }
    return mapMfaEnrollmentRecord(record);
  }
}

@Injectable()
export class PrismaMfaRateLimitRepository implements MfaRateLimitRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByUserId(userId: string): Promise<MfaRateLimit | null> {
    const record = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!record || (record.mfaFailedCount === 0 && !record.mfaLockedUntil)) {
      return null;
    }
    return mapMfaRateLimitRecord(record);
  }

  async save(rateLimit: MfaRateLimit): Promise<void> {
    await this.prisma.user.update({
      where: { id: rateLimit.userId },
      data: {
        mfaFailedCount: rateLimit.failedCount,
        mfaLockedUntil: dateFromEpochMs(rateLimit.lockedUntil),
      },
    });
  }

  async resetByUserId(userId: string): Promise<void> {
    await this.prisma.user.updateMany({
      where: { id: userId },
      data: { mfaFailedCount: 0, mfaLockedUntil: null },
    });
  }

  async recordFailedAttempt(
    userId: string,
    now: number,
    limit: number,
    lockWindowMs: number,
  ): Promise<MfaRateLimit> {
    const nowDate = new Date(now);
    await this.prisma.user.updateMany({
      where: { id: userId, mfaLockedUntil: { lte: nowDate } },
      data: { mfaFailedCount: 0, mfaLockedUntil: null },
    });

    let updated = await this.prisma.user.update({
      where: { id: userId },
      data: { mfaFailedCount: { increment: 1 } },
    });

    if (
      updated.mfaFailedCount >= limit &&
      (!updated.mfaLockedUntil || updated.mfaLockedUntil <= nowDate)
    ) {
      updated = await this.prisma.user.update({
        where: { id: userId },
        data: { mfaLockedUntil: new Date(now + lockWindowMs) },
      });
    }
    return mapMfaRateLimitRecord(updated);
  }
}

@Injectable()
export class PrismaMfaOtpUsedRepository implements MfaOtpUsedRepository {
  constructor(private readonly prisma: PrismaService) {}

  async isUsed(userId: string, otpCode: string): Promise<boolean> {
    return (
      (await this.prisma.authRecord.findUnique({
        where: {
          lookupKey: authRecordLookupKey(
            AUTH_RECORD_TYPES.mfaOtpUse,
            userId,
            otpCode,
          ),
        },
        select: { id: true },
      })) !== null
    );
  }
}

@Injectable()
export class PrismaMfaRecoveryCodeRepository implements MfaRecoveryCodeRepository {
  nextId(): string {
    return crypto.randomUUID();
  }

  nextBatchId(): string {
    return crypto.randomUUID();
  }
}
