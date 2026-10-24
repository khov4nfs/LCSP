import * as crypto from "node:crypto";
import { USER_ACCESS_STATUSES } from "@lcsp/contracts/auth";
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import type {
  MfaEnrollmentRepository,
  MfaOtpUsedRepository,
  MfaRateLimitRepository,
  MfaRecoveryCodeCreateInput,
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

  async save(enrollment: MfaEnrollment): Promise<void> {
    await this.prisma.user.update({
      where: { id: enrollment.userId },
      data: {
        mfaEncryptedSecret: enrollment.encryptedSecret,
        mfaEnrolledAt: new Date(enrollment.enrolledAt),
        mfaVerifiedAt: dateFromEpochMs(enrollment.verifiedAt),
      },
    });
  }

  async markVerifiedIfCurrent(
    enrollment: MfaEnrollment,
    now: number,
  ): Promise<boolean> {
    const result = await this.prisma.user.updateMany({
      where: {
        id: enrollment.userId,
        accessStatus: USER_ACCESS_STATUSES.active,
        mfaEncryptedSecret: enrollment.encryptedSecret,
        mfaEnrolledAt: new Date(enrollment.enrolledAt),
      },
      data: { mfaVerifiedAt: new Date(now) },
    });
    return result.count === 1;
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.prisma.user.updateMany({
      where: { id: userId },
      data: {
        mfaEncryptedSecret: null,
        mfaEnrolledAt: null,
        mfaVerifiedAt: null,
      },
    });
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

  async tryMarkUsed(userId: string, otpCode: string): Promise<boolean> {
    try {
      await this.prisma.authRecord.create({
        data: {
          id: crypto.randomUUID(),
          userId,
          type: AUTH_RECORD_TYPES.mfaOtpUse,
          lookupKey: authRecordLookupKey(
            AUTH_RECORD_TYPES.mfaOtpUse,
            userId,
            otpCode,
          ),
          usedAt: new Date(),
          metadata: { otpCode },
        },
      });
      return true;
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        return false;
      }
      throw error;
    }
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.prisma.authRecord.deleteMany({
      where: { userId, type: AUTH_RECORD_TYPES.mfaOtpUse },
    });
  }

  async pruneOlderThan(cutoffMs: number): Promise<void> {
    await this.prisma.authRecord.deleteMany({
      where: {
        type: AUTH_RECORD_TYPES.mfaOtpUse,
        usedAt: { lt: new Date(cutoffMs) },
      },
    });
  }
}

@Injectable()
export class PrismaMfaRecoveryCodeRepository implements MfaRecoveryCodeRepository {
  constructor(private readonly prisma: PrismaService) {}

  nextId(): string {
    return crypto.randomUUID();
  }

  nextBatchId(): string {
    return crypto.randomUUID();
  }

  async hasActiveForUser(userId: string): Promise<boolean> {
    const count = await this.prisma.authRecord.count({
      where: {
        userId,
        type: AUTH_RECORD_TYPES.mfaRecoveryCode,
        usedAt: null,
        revokedAt: null,
      },
    });
    return count > 0;
  }

  async replaceForUser(
    userId: string,
    codeRecords: readonly MfaRecoveryCodeCreateInput[],
    batchId: string,
    now: number,
  ): Promise<void> {
    const nowDate = new Date(now);
    await this.prisma.$transaction(async (tx) => {
      await tx.authRecord.updateMany({
        where: {
          userId,
          type: AUTH_RECORD_TYPES.mfaRecoveryCode,
          revokedAt: null,
          usedAt: null,
        },
        data: { revokedAt: nowDate },
      });
      await tx.authRecord.createMany({
        data: codeRecords.map((record) => ({
          id: record.id,
          userId,
          type: AUTH_RECORD_TYPES.mfaRecoveryCode,
          lookupKey: authRecordLookupKey(
            AUTH_RECORD_TYPES.mfaRecoveryCode,
            userId,
            record.codeHash,
          ),
          secretHash: record.codeHash,
          metadata: { batchId },
          createdAt: nowDate,
        })),
      });
    });
  }

  async revokeActiveForUser(userId: string, now: number): Promise<void> {
    await this.prisma.authRecord.updateMany({
      where: {
        userId,
        type: AUTH_RECORD_TYPES.mfaRecoveryCode,
        revokedAt: null,
        usedAt: null,
      },
      data: { revokedAt: new Date(now) },
    });
  }

  async tryConsume(
    userId: string,
    codeHash: string,
    now: number,
  ): Promise<boolean> {
    const result = await this.prisma.authRecord.updateMany({
      where: {
        userId,
        type: AUTH_RECORD_TYPES.mfaRecoveryCode,
        lookupKey: authRecordLookupKey(
          AUTH_RECORD_TYPES.mfaRecoveryCode,
          userId,
          codeHash,
        ),
        usedAt: null,
        revokedAt: null,
      },
      data: { usedAt: new Date(now) },
    });
    return result.count === 1;
  }
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
