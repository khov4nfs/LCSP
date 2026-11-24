import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_AUDIT_EVENT_TYPES,
  AUTH_ERROR_CODES,
  USER_ACCESS_STATUSES,
  type PrivacySettingsResponse,
} from "@lcsp/contracts/auth";
import { Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { authFailure } from "../../errors/auth-application.error.ts";
import {
  AUTH_PRIVACY_SETTINGS_REPOSITORY,
  AUTH_USER_REPOSITORY,
  type PrivacySettingsRepository,
  type PrivacySettingsUpdate,
  type UserRepository,
} from "../../ports/persistence/index.ts";
import { AuthSupportService } from "../../services/auth/auth-support.service.ts";
import { UpdatePrivacySettingsCommand } from "./update-privacy-settings.command.ts";

/**
 * Handles updating privacy configurations and persistence for authenticated users.
 *
 * Enforces:
 * 1. Requires authenticated user context and active account status.
 * 2. Scopes upsert operations strictly to the caller's user ID.
 * 3. Records an immutable audit log capturing updated field names.
 * 4. Preserves model training invariants: customer code is never used for training.
 */
@CommandHandler(UpdatePrivacySettingsCommand)
export class UpdatePrivacySettingsHandler implements ICommandHandler<UpdatePrivacySettingsCommand> {
  constructor(
    private readonly support: AuthSupportService,
    @Inject(AUTH_USER_REPOSITORY)
    private readonly users: UserRepository,
    @Inject(AUTH_PRIVACY_SETTINGS_REPOSITORY)
    private readonly privacySettings: PrivacySettingsRepository,
  ) {}

  /**
   * Business purpose: Update privacy settings and emission of audit logging for the authenticated user.
   *
   * Business rules:
   * - Only active accounts may update privacy settings.
   * - Scoped strictly to the authenticated caller's userId to prevent BOLA / cross-tenant modification.
   * - Emits structured audit event containing updated field names for compliance and traceability.
   * - System invariant: model training option is enforced false and cannot be overridden by user input.
   *
   * Execution flow:
   * 1. Validate caller account exists and access status is active.
   * 2. Extract and sanitize requested privacy configuration updates.
   * 3. Atomically upsert privacy settings row in database.
   * 4. Emit audit log with updated field names.
   * 5. Return updated privacy settings response matching contract.
   *
   * Failure cases:
   * - Inactive or non-existent user returns accountSuspended or sessionExpired error.
   * - Persistence errors propagate as unhandled exceptions.
   *
   * Side effects:
   * - Mutates PrivacySetting table and writes an audit event record.
   */
  async execute(
    command: UpdatePrivacySettingsCommand,
  ): Promise<PrivacySettingsResponse> {
    const { payload, userId, requestMeta } = command;
    const correlationId =
      requestMeta?.correlationId ?? this.support.createCorrelationId();

    // Rationale (Why): Active account check ensures suspended or deleted accounts cannot mutate settings.
    // Mechanism (How): Queries user repository by verified userId.
    // Invariants (What): Rejects non-active accounts before initiating any database write.
    const user = await this.users.findById(userId);
    if (!user || user.accessStatus !== USER_ACCESS_STATUSES.active) {
      throw authFailure(AUTH_ERROR_CODES.accountSuspended, correlationId);
    }

    const updates: PrivacySettingsUpdate = {};
    const updatedFields: string[] = [];

    if (typeof payload.retain_repository_telemetry === "boolean") {
      updates.retainRepositoryTelemetry = payload.retain_repository_telemetry;
      updatedFields.push("retain_repository_telemetry");
    }

    if (typeof payload.enable_audit_export_api === "boolean") {
      updates.enableAuditExportApi = payload.enable_audit_export_api;
      updatedFields.push("enable_audit_export_api");
    }

    if (typeof payload.restricted_assessment_sharing === "boolean") {
      updates.restrictedAssessmentSharing =
        payload.restricted_assessment_sharing;
      updatedFields.push("restricted_assessment_sharing");
    }

    if (typeof payload.purge_agent_memory_on_completion === "boolean") {
      updates.purgeAgentMemoryOnCompletion =
        payload.purge_agent_memory_on_completion;
      updatedFields.push("purge_agent_memory_on_completion");
    }

    // Rationale (Why): Atomic upsert handles both first-time preference creation and subsequent updates.
    // Mechanism (How): Prisma upsert scoped to unique userId.
    // Invariants (What): BOLA prevention: record always belongs to userId.
    const record = await this.privacySettings.upsert(user.id, updates);

    // Rationale (Why): Auditing compliance tracks who changed privacy settings and which fields changed.
    // Mechanism (How): Writes AUTH_PRIVACY_SETTINGS_UPDATED audit entry via support service.
    // Invariants (What): Audit entry carries accurate actorId and correlationId.
    if (updatedFields.length > 0) {
      await this.support.recordAudit({
        event_type: AUTH_AUDIT_EVENT_TYPES.authPrivacySettingsUpdated,
        actor_id: user.id,
        decision: AUDIT_DECISIONS.allow,
        updated_fields: updatedFields,
        correlationId: correlationId,
      });
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
