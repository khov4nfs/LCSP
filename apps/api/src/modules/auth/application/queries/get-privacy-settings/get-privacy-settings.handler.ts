import { Inject } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";

import type { PrivacySettingsSuccess } from "../../contracts/auth/privacy.contract.ts";
import {
  AUTH_PRIVACY_SETTINGS_REPOSITORY,
  type PrivacySettingsRepository,
} from "../../ports/persistence/privacy-settings.repository.ts";
import { GetPrivacySettingsQuery } from "./get-privacy-settings.query.ts";

/**
 * Handles fetching privacy configuration for the authenticated user.
 *
 * Enforces:
 * 1. Requires valid user ID and active session from context.
 * 2. Only retrieves privacy settings owned by the authenticated user.
 * 3. Returns system default settings when no custom record has been saved yet.
 * 4. Always enforces system policy on model training (improve_models: enabled=false, enforced=true).
 */
@QueryHandler(GetPrivacySettingsQuery)
export class GetPrivacySettingsHandler implements IQueryHandler<GetPrivacySettingsQuery> {
  constructor(
    @Inject(AUTH_PRIVACY_SETTINGS_REPOSITORY)
    private readonly privacySettings: PrivacySettingsRepository,
  ) {}

  /**
   * Business purpose: Retrieve current privacy settings and system policy enforcement for the authenticated account.
   *
   * Business rules:
   * - Only reads privacy preferences where userId matches the caller's authenticated user ID.
   * - If no customized settings row exists in the database, returns secure system defaults.
   * - In accordance with LCSP security policy, AI model training on customer data is permanently disabled (improve_models: { enabled: false, enforced: true }).
   *
   * Execution flow:
   * 1. Extract userId from authenticated query context.
   * 2. Query repository for privacy record matching the authenticated userId.
   * 3. Construct response object, falling back to defaults for missing preferences and enforcing system invariants.
   * 4. Return normalized PrivacySettingsSuccess response.
   *
   * Failure cases:
   * - Persistence errors propagate as unhandled database exceptions.
   *
   * Side effects:
   * - None: read-only query.
   */
  async execute(
    query: GetPrivacySettingsQuery,
  ): Promise<PrivacySettingsSuccess> {
    // Rationale (Why): BOLA/IDOR prevention by scoping persistence query strictly to context.userId.
    // Mechanism (How): Reads repository exclusively using caller's verified userId from RBAC context.
    // Invariants (What): Users can never read other tenants' or accounts' privacy settings.
    const record = await this.privacySettings.findByUserId(
      query.context.userId,
    );

    if (!record) {
      return {
        retain_repository_telemetry: false,
        enable_audit_export_api: true,
        restricted_assessment_sharing: false,
        purge_agent_memory_on_completion: true,
        improve_models: {
          enabled: false,
          enforced: true,
        },
        updated_at: null,
      };
    }

    return {
      retain_repository_telemetry: record.retainRepositoryTelemetry,
      enable_audit_export_api: record.enableAuditExportApi,
      restricted_assessment_sharing: record.restrictedAssessmentSharing,
      purge_agent_memory_on_completion: record.purgeAgentMemoryOnCompletion,
      improve_models: {
        enabled: false,
        enforced: true,
      },
      updated_at: record.updatedAt.toISOString(),
    };
  }
}
