import {
  CAPABILITY_POLICY_REASONS,
  DOMAIN_ALLOWLIST_MODES,
  TOOL_ACCESS_MODES,
} from "@lcsp/contracts/auth";
import { Inject } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";

import type { CapabilitySettingsSuccess } from "../../contracts/auth/capability.contract.ts";
import {
  AUTH_CAPABILITY_SETTINGS_REPOSITORY,
  type CapabilitySettingsRepository,
} from "../../ports/persistence/capability-settings.repository.ts";
import { GetCapabilitySettingsQuery } from "./get-capability-settings.query.ts";

const DEFAULT_PACKAGE_MANAGER_DOMAINS = ["registry.npmjs.org", "pypi.org"];

/**
 * Handles fetching effective capability settings for the authenticated user.
 *
 * Enforces:
 * 1. Scopes lookup strictly to the authenticated caller's userId.
 * 2. Returns secure system defaults when no custom capability row exists.
 * 3. Always enforces platform invariants (cloud_code_execution=false, network_egress=false, domain_allowlist=PACKAGE_MANAGERS_ONLY).
 */
@QueryHandler(GetCapabilitySettingsQuery)
export class GetCapabilitySettingsHandler implements IQueryHandler<GetCapabilitySettingsQuery> {
  constructor(
    @Inject(AUTH_CAPABILITY_SETTINGS_REPOSITORY)
    private readonly capabilitySettings: CapabilitySettingsRepository,
  ) {}

  /**
   * Business purpose: Retrieve effective capability settings and enforced platform policies for the authenticated account.
   *
   * Business rules:
   * - Only reads capability preferences where userId matches the caller's authenticated user ID.
   * - Unconfigured accounts receive secure runtime defaults (LOAD_WHEN_NEEDED, connector_search=true, artifacts=true).
   * - Platform-enforced capabilities (cloud_code_execution, network_egress, domain_allowlist) are always returned as locked system policies.
   *
   * Execution flow:
   * 1. Extract userId from authenticated query context.
   * 2. Query repository for capability record matching userId.
   * 3. Merge customer-configurable fields (or defaults) with immutable platform policy descriptors.
   * 4. Return normalized CapabilitySettingsSuccess response.
   *
   * Failure cases:
   * - Persistence errors propagate as unhandled database exceptions.
   *
   * Side effects:
   * - None: read-only query.
   */
  async execute(
    query: GetCapabilitySettingsQuery,
  ): Promise<CapabilitySettingsSuccess> {
    // Rationale (Why): BOLA/IDOR prevention by scoping persistence query strictly to context.userId.
    // Mechanism (How): Reads repository exclusively using caller's verified userId from RBAC context.
    // Invariants (What): Platform policies remain immutable regardless of stored user preferences.
    const record = await this.capabilitySettings.findByUserId(
      query.context.userId,
    );

    const toolAccessMode =
      record?.toolAccessMode === TOOL_ACCESS_MODES.guided ||
      record?.toolAccessMode === TOOL_ACCESS_MODES.loadWhenNeeded
        ? record.toolAccessMode
        : TOOL_ACCESS_MODES.loadWhenNeeded;

    return {
      tool_access_mode: toolAccessMode,
      connector_search: record?.connectorSearch ?? true,
      artifacts: record?.artifactsEnabled ?? true,
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
      updated_at: record ? record.updatedAt.toISOString() : null,
    };
  }
}
