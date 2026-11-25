import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_AUDIT_EVENT_TYPES,
  AUTH_ERROR_CODES,
  CAPABILITY_POLICY_REASONS,
  DOMAIN_ALLOWLIST_MODES,
  USER_ACCESS_STATUSES,
  type CapabilitySettingsResponse,
} from "@lcsp/contracts/auth";
import { Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { authFailure } from "../../errors/auth-application.error.ts";
import {
  AUTH_CAPABILITY_SETTINGS_REPOSITORY,
  AUTH_USER_REPOSITORY,
  type CapabilitySettingsRepository,
  type CapabilitySettingsUpdate,
  type UserRepository,
} from "../../ports/persistence/index.ts";
import { AuthSupportService } from "../../services/auth/auth-support.service.ts";
import { UpdateCapabilitySettingsCommand } from "./update-capability-settings.command.ts";

const DEFAULT_PACKAGE_MANAGER_DOMAINS = ["registry.npmjs.org", "pypi.org"];

/**
 * Handles updating customer-configurable runtime capability settings for authenticated users.
 *
 * Enforces:
 * 1. Requires authenticated user context and active account status.
 * 2. Scopes upsert operations strictly to the caller's userId.
 * 3. Only permits updates to configurable capabilities (tool_access_mode, connector_search, artifacts).
 * 4. Records an immutable audit log capturing updated field names.
 */
@CommandHandler(UpdateCapabilitySettingsCommand)
export class UpdateCapabilitySettingsHandler implements ICommandHandler<UpdateCapabilitySettingsCommand> {
  constructor(
    private readonly support: AuthSupportService,
    @Inject(AUTH_USER_REPOSITORY)
    private readonly users: UserRepository,
    @Inject(AUTH_CAPABILITY_SETTINGS_REPOSITORY)
    private readonly capabilitySettings: CapabilitySettingsRepository,
  ) {}

  /**
   * Business purpose: Update customer-configurable capability settings and emit an audit trail event.
   *
   * Business rules:
   * - Only active accounts may update capability settings.
   * - Scoped strictly to the authenticated caller's userId to prevent BOLA/IDOR.
   * - System-enforced capabilities (cloud_code_execution, network_egress, domain_allowlist) remain locked and cannot be overridden.
   * - Emits AUTH_CAPABILITY_SETTINGS_UPDATED audit event when fields change.
   *
   * Execution flow:
   * 1. Verify caller account exists and accessStatus is ACTIVE.
   * 2. Extract permitted configurable updates (tool_access_mode, connector_search, artifacts).
   * 3. Atomically upsert CapabilitySetting row scoped to user.id.
   * 4. Record audit event with updated field names when any field was modified.
   * 5. Return effective CapabilitySettingsResponse combining persisted preferences and locked platform policies.
   *
   * Failure cases:
   * - Missing or suspended account throws accountSuspended error.
   * - Persistence errors propagate as unhandled exceptions.
   *
   * Side effects:
   * - Mutates CapabilitySetting table and writes an AuditEvent row.
   */
  async execute(
    command: UpdateCapabilitySettingsCommand,
  ): Promise<CapabilitySettingsResponse> {
    const { payload, userId, requestMeta } = command;
    const correlationId =
      requestMeta?.correlationId ?? this.support.createCorrelationId();

    // Rationale (Why): Active account verification prevents suspended or deactivated accounts from altering runtime policy.
    // Mechanism (How): Queries UserRepository by verified userId and checks accessStatus === ACTIVE.
    // Invariants (What): Rejects non-active accounts before any database write occurs.
    const user = await this.users.findById(userId);
    if (!user || user.accessStatus !== USER_ACCESS_STATUSES.active) {
      throw authFailure(AUTH_ERROR_CODES.accountSuspended, correlationId);
    }

    const updates: CapabilitySettingsUpdate = {};
    const updatedFields: string[] = [];

    if (payload.tool_access_mode !== undefined) {
      updates.toolAccessMode = payload.tool_access_mode;
      updatedFields.push("tool_access_mode");
    }

    if (typeof payload.connector_search === "boolean") {
      updates.connectorSearch = payload.connector_search;
      updatedFields.push("connector_search");
    }

    if (typeof payload.artifacts === "boolean") {
      updates.artifactsEnabled = payload.artifacts;
      updatedFields.push("artifacts");
    }

    // Rationale (Why): Atomic upsert handles both initial capability record creation and subsequent updates.
    // Mechanism (How): Scopes Prisma upsert strictly to unique userId.
    // Invariants (What): BOLA prevention — callers can only mutate their own capability row.
    const record = await this.capabilitySettings.upsert(user.id, updates);

    if (updatedFields.length > 0) {
      await this.support.recordAudit({
        event_type: AUTH_AUDIT_EVENT_TYPES.authCapabilitySettingsUpdated,
        actor_id: user.id,
        decision: AUDIT_DECISIONS.allow,
        updated_fields: updatedFields,
        correlationId,
      });
    }

    return {
      tool_access_mode: record.toolAccessMode,
      connector_search: record.connectorSearch,
      artifacts: record.artifactsEnabled,
      cloud_code_execution: {
        enabled: false,
        enforced: true,
        policy: CAPABILITY_POLICY_REASONS.platformRestricted,
      },
      network_egress: {
        enabled: false,
        enforced: true,
        policy: CAPABILITY_POLICY_REASONS.runtimePolicyRestricted,
      },
      domain_allowlist: {
        mode: DOMAIN_ALLOWLIST_MODES.packageManagersOnly,
        custom_domains_supported: false,
        allowed_domains: [...DEFAULT_PACKAGE_MANAGER_DOMAINS],
      },
      updated_at: record.updatedAt.toISOString(),
    };
  }
}
