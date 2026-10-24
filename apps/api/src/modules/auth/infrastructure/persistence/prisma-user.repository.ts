import * as crypto from "node:crypto";
import { USER_ACCESS_STATUSES } from "@lcsp/contracts/auth";
import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  toPrismaAuthBackupEmailPolicy,
  toPrismaAuthPrimaryEmailAddressPolicy,
} from "../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import type {
  UserProfileUpdate,
  UserRepository,
} from "../../application/ports/persistence/user.repository.ts";
import type { User } from "../../domain/models/auth.models.ts";
import { dateFromEpochMs, mapUserRecord } from "./prisma-auth.mappers.ts";

@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  nextId(): string {
    return crypto.randomUUID();
  }

  async recordFailedLoginAttempt(
    id: string,
    expectedPasswordHash: string,
    now: number,
    limit: number,
    lockWindowMs: number,
  ): Promise<User | null> {
    return this.prisma.$transaction(async (tx) => {
      // Serialize failed attempts without holding a lock during scrypt verification.
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${id} FOR UPDATE`,
      );
      const record = await tx.user.findUnique({ where: { id } });
      if (!record || record.passwordHash !== expectedPasswordHash) return null;
      const user = mapUserRecord(record);
      if (!user.isLocked(now)) {
        user.recordFailedLogin(now, limit, lockWindowMs);
        await tx.user.update({
          where: { id },
          data: {
            failedLoginCount: user.failedLoginCount,
            lockUntil: dateFromEpochMs(user.lockUntil),
          },
        });
      }
      return user;
    });
  }

  async clearFailedLoginsIfCredentialsCurrent(
    id: string,
    expectedPasswordHash: string,
    now: number,
  ): Promise<User | null> {
    const result = await this.prisma.user.updateMany({
      where: {
        id,
        passwordHash: expectedPasswordHash,
        accessStatus: USER_ACCESS_STATUSES.active,
        OR: [{ lockUntil: null }, { lockUntil: { lte: new Date(now) } }],
      },
      data: { failedLoginCount: 0, lockUntil: null },
    });
    if (result.count !== 1) return null;
    const current = await this.findById(id);
    return current?.passwordHash === expectedPasswordHash ? current : null;
  }

  async updateProfile(id: string, changes: UserProfileUpdate): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: {
        ...(changes.displayName !== undefined
          ? { displayName: changes.displayName }
          : {}),
        ...(changes.recoveryEmail !== undefined
          ? { recoveryEmail: changes.recoveryEmail }
          : {}),
        ...(changes.primaryEmailAddressPolicy !== undefined
          ? {
              primaryEmailAddressPolicy: toPrismaAuthPrimaryEmailAddressPolicy(
                changes.primaryEmailAddressPolicy,
              ),
            }
          : {}),
        ...(changes.backupEmailPolicy !== undefined
          ? {
              backupEmailPolicy: toPrismaAuthBackupEmailPolicy(
                changes.backupEmailPolicy,
              ),
            }
          : {}),
      },
    });
  }

  async setMfaRequired(id: string, required: boolean): Promise<boolean> {
    const updated = await this.prisma.user.updateMany({
      where: {
        id,
        accessStatus: USER_ACCESS_STATUSES.active,
        ...(required
          ? { mfaEncryptedSecret: { not: null }, mfaVerifiedAt: { not: null } }
          : {}),
      },
      data: { mfaRequired: required },
    });
    return updated.count === 1;
  }

  async findById(id: string): Promise<User | null> {
    const record = await this.prisma.user.findUnique({ where: { id } });
    return record ? mapUserRecord(record) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const record = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    return record ? mapUserRecord(record) : null;
  }

  async findByRecoveryEmail(email: string): Promise<User | null> {
    const record = await this.prisma.user.findFirst({
      where: { recoveryEmail: email.trim().toLowerCase() },
    });
    return record ? mapUserRecord(record) : null;
  }

  async findByPrimaryEmail(email: string): Promise<User | null> {
    const normalizedEmail = email.trim().toLowerCase();
    const record = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: normalizedEmail },
          {
            recoveryEmail: normalizedEmail,
            primaryEmailAddressPolicy: "RECOVERY_EMAIL",
          },
        ],
      },
    });
    return record ? mapUserRecord(record) : null;
  }
}
