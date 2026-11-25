import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_AUDIT_EVENT_TYPES,
  CAPABILITY_POLICY_REASONS,
  DOMAIN_ALLOWLIST_MODES,
  TOOL_ACCESS_MODES,
  USER_ACCESS_STATUSES,
} from "@lcsp/contracts/auth";
import { describe, expect, it, jest } from "@jest/globals";

import type {
  CapabilitySettingsRepository,
  UserRepository,
} from "../../ports/persistence/index.ts";
import { UpdateCapabilitySettingsCommand } from "./update-capability-settings.command.ts";
import { UpdateCapabilitySettingsHandler } from "./update-capability-settings.handler.ts";

describe("UpdateCapabilitySettingsHandler", () => {
  it("rejects suspended or missing accounts before mutating settings", async () => {
    const upsert = jest.fn<CapabilitySettingsRepository["upsert"]>();
    const recordAudit = jest
      .fn<(event: unknown) => Promise<void>>()
      .mockResolvedValue();
    const handler = new UpdateCapabilitySettingsHandler(
      {
        createCorrelationId: () => "corr-1",
        recordAudit,
      } as never,
      {
        findById: jest.fn<UserRepository["findById"]>().mockResolvedValue({
          id: "user-1",
          accessStatus: USER_ACCESS_STATUSES.suspended,
        } as never),
      } as never,
      {
        findByUserId: jest.fn<CapabilitySettingsRepository["findByUserId"]>(),
        upsert,
      },
    );

    await expect(
      handler.execute(
        new UpdateCapabilitySettingsCommand(
          { connector_search: false },
          "user-1",
          "sess-1",
          { correlationId: "corr-1" },
        ),
      ),
    ).rejects.toThrow();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("persists configurable capability preferences and emits audit event", async () => {
    const updatedAt = new Date("2026-11-25T10:15:00.000Z");
    const recordAudit = jest
      .fn<(event: unknown) => Promise<void>>()
      .mockResolvedValue();
    const upsert = jest
      .fn<CapabilitySettingsRepository["upsert"]>()
      .mockResolvedValue({
        id: "cap-1",
        userId: "user-1",
        toolAccessMode: TOOL_ACCESS_MODES.guided,
        connectorSearch: false,
        artifactsEnabled: true,
        createdAt: updatedAt,
        updatedAt,
      });

    const handler = new UpdateCapabilitySettingsHandler(
      {
        createCorrelationId: () => "corr-2",
        recordAudit,
      } as never,
      {
        findById: jest.fn<UserRepository["findById"]>().mockResolvedValue({
          id: "user-1",
          accessStatus: USER_ACCESS_STATUSES.active,
        } as never),
      } as never,
      {
        findByUserId: jest.fn<CapabilitySettingsRepository["findByUserId"]>(),
        upsert,
      },
    );

    const result = await handler.execute(
      new UpdateCapabilitySettingsCommand(
        {
          tool_access_mode: TOOL_ACCESS_MODES.guided,
          connector_search: false,
        },
        "user-1",
        "sess-1",
        { correlationId: "corr-2" },
      ),
    );

    expect(upsert).toHaveBeenCalledWith("user-1", {
      toolAccessMode: TOOL_ACCESS_MODES.guided,
      connectorSearch: false,
    });
    expect(recordAudit).toHaveBeenCalledWith({
      event_type: AUTH_AUDIT_EVENT_TYPES.authCapabilitySettingsUpdated,
      actor_id: "user-1",
      decision: AUDIT_DECISIONS.allow,
      updated_fields: ["tool_access_mode", "connector_search"],
      correlationId: "corr-2",
    });
    expect(result).toEqual({
      tool_access_mode: TOOL_ACCESS_MODES.guided,
      connector_search: false,
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
      updated_at: updatedAt.toISOString(),
    });
  });
});
