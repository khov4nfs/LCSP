/**
 * Persistence port interface for managing user privacy settings.
 *
 * Rationale (Why):
 * In accordance with Clean Architecture and DDD principles, domain logic interacts
 * with persistence boundaries exclusively through abstracted port interfaces.
 *
 * Mechanism (How):
 * Defines lookup and atomic upsert operations for PrivacySetting records keyed by userId.
 *
 * Invariants (What):
 * Every record is uniquely associated with exactly one authenticated user (1:1 relation).
 */
export interface PrivacySettingsRecord {
  id: string;
  userId: string;
  retainRepositoryTelemetry: boolean;
  enableAuditExportApi: boolean;
  restrictedAssessmentSharing: boolean;
  purgeAgentMemoryOnCompletion: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrivacySettingsUpdate {
  retainRepositoryTelemetry?: boolean;
  enableAuditExportApi?: boolean;
  restrictedAssessmentSharing?: boolean;
  purgeAgentMemoryOnCompletion?: boolean;
}

export interface PrivacySettingsRepository {
  findByUserId(userId: string): Promise<PrivacySettingsRecord | null>;
  upsert(
    userId: string,
    update: PrivacySettingsUpdate,
  ): Promise<PrivacySettingsRecord>;
}

export const AUTH_PRIVACY_SETTINGS_REPOSITORY = Symbol(
  "AUTH_PRIVACY_SETTINGS_REPOSITORY",
);
