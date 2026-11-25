import {
  AUTH_USER_ROLES,
  CAPABILITY_POLICY_REASONS,
  DOMAIN_ALLOWLIST_MODES,
  TOOL_ACCESS_MODES,
} from "@lcsp/contracts/auth";
import { describe, expect, it, jest } from "@jest/globals";

import type { RbacRequestContext } from "../../../../../platform/rbac/interfaces/rbac-request.interface.ts";
import type { CapabilitySettingsRepository } from "../../ports/persistence/capability-settings.repository.ts";
import { GetCapabilitySettingsHandler } from "./get-capability-settings.handler.ts";
import { GetCapabilitySettingsQuery } from "./get-capability-settings.query.ts";

describe("GetCapabilitySettingsHandler", () => {
  it("returns secure defaults and locked platform policies when no record exists", async () => {
    const findByUserId = jest
      .fn<CapabilitySettingsRepository["findByUserId"]>()
      .mockResolvedValue(null);
    const handler = new GetCapabilitySettingsHandler({
      findByUserId,
      upsert: jest.fn<CapabilitySettingsRepository["upsert"]>(),
    });

    const context: RbacRequestContext = {
      userId: "user-1",
      sessionId: "sess-1",
      role: AUTH_USER_ROLES.customer,
      scope: null,
    };
    const result = await handler.execute(
      new GetCapabilitySettingsQuery(context, "corr-1"),
    );

    expect(findByUserId).toHaveBeenCalledWith("user-1");
    expect(result).toEqual({
      tool_access_mode: TOOL_ACCESS_MODES.loadWhenNeeded,
      connector_search: true,
      artifacts: true,
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
        allowed_domains: ["registry.npmjs.org", "pypi.org"],
      },
      updated_at: null,
    });
  });

  it("returns persisted customer preferences combined with locked platform policies", async () => {
    const updatedAt = new Date("2026-11-25T10:00:00.000Z");
    const findByUserId = jest
      .fn<CapabilitySettingsRepository["findByUserId"]>()
      .mockResolvedValue({
        id: "cap-1",
        userId: "user-2",
        toolAccessMode: TOOL_ACCESS_MODES.guided,
        connectorSearch: false,
        artifactsEnabled: false,
        createdAt: updatedAt,
        updatedAt,
      });
    const handler = new GetCapabilitySettingsHandler({
      findByUserId,
      upsert: jest.fn<CapabilitySettingsRepository["upsert"]>(),
    });

    const context2: RbacRequestContext = {
      userId: "user-2",
      sessionId: "sess-2",
      role: AUTH_USER_ROLES.customer,
      scope: null,
    };
    const result = await handler.execute(
      new GetCapabilitySettingsQuery(context2, "corr-2"),
    );

    expect(result).toEqual({
      tool_access_mode: TOOL_ACCESS_MODES.guided,
      connector_search: false,
      artifacts: false,
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
        allowed_domains: ["registry.npmjs.org", "pypi.org"],
      },
      updated_at: updatedAt.toISOString(),
    });
  });
});
