import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import type {
  PrivacySettingsRecord,
  PrivacySettingsRepository,
  PrivacySettingsUpdate,
} from "../../application/ports/persistence/privacy-settings.repository.ts";

/**
 * Prisma-backed implementation of PrivacySettingsRepository.
 *
 * Rationale (Why):
 * Encapsulates all relational database operations for user privacy configuration,
 * shielding the CQRS domain layer from Prisma-specific query constructs.
 *
 * Mechanism (How):
 * Utilizes PrismaService to perform single-record lookups and atomic upserts
 * against the PrivacySetting table, keyed on unique userId.
 *
 * Invariants (What):
 * Every operation is strictly scoped to the provided userId to prevent BOLA / IDOR.
 * Upsert guarantees that a row is created with default fallback values if it did not exist.
 */
@Injectable()
export class PrismaPrivacySettingsRepository implements PrivacySettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Find privacy settings record for a given user ID.
   */
  async findByUserId(userId: string): Promise<PrivacySettingsRecord | null> {
    return this.prisma.privacySetting.findUnique({
      where: { userId },
    });
  }

  /**
   * Atomically create or update privacy settings for a user.
   */
  async upsert(
    userId: string,
    update: PrivacySettingsUpdate,
  ): Promise<PrivacySettingsRecord> {
    return this.prisma.privacySetting.upsert({
      where: { userId },
      create: {
        userId,
        retainRepositoryTelemetry: update.retainRepositoryTelemetry ?? false,
        enableAuditExportApi: update.enableAuditExportApi ?? true,
        restrictedAssessmentSharing:
          update.restrictedAssessmentSharing ?? false,
        purgeAgentMemoryOnCompletion:
          update.purgeAgentMemoryOnCompletion ?? true,
      },
      update: {
        ...(update.retainRepositoryTelemetry !== undefined && {
          retainRepositoryTelemetry: update.retainRepositoryTelemetry,
        }),
        ...(update.enableAuditExportApi !== undefined && {
          enableAuditExportApi: update.enableAuditExportApi,
        }),
        ...(update.restrictedAssessmentSharing !== undefined && {
          restrictedAssessmentSharing: update.restrictedAssessmentSharing,
        }),
        ...(update.purgeAgentMemoryOnCompletion !== undefined && {
          purgeAgentMemoryOnCompletion: update.purgeAgentMemoryOnCompletion,
        }),
      },
    });
  }
}
