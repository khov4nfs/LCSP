import { describe, expect, it, jest } from "@jest/globals";
import type { CommandBus, QueryBus } from "@nestjs/cqrs";

import {
  AUTH_USER_ROLES,
  CAPABILITY_POLICY_REASONS,
  DOMAIN_ALLOWLIST_MODES,
  TOOL_ACCESS_MODES,
  updateCapabilitySettingsSchema,
} from "@lcsp/contracts/auth";
import type { AuthenticatedRequest } from "../../../../platform/rbac/interfaces/authenticated-request.interface.ts";
import {
  UpdateCapabilitySettingsCommand,
  UpdatePrivacySettingsCommand,
} from "../../application/commands/index.ts";
import {
  GetCapabilitySettingsQuery,
  GetPrivacySettingsQuery,
} from "../../application/queries/index.ts";
import { AuthProfileController } from "./auth-profile.controller.ts";

describe("AuthProfileController - Privacy Settings", () => {
  it("dispatches GetPrivacySettingsQuery on GET /auth/privacy", async () => {
    const executeQuery = jest.fn().mockResolvedValue({
      retain_repository_telemetry: false,
      enable_audit_export_api: true,
      restricted_assessment_sharing: false,
      purge_agent_memory_on_completion: true,
      improve_models: { enabled: false, enforced: true },
      updated_at: null,
    } as never);
    const mockQueryBus = { execute: executeQuery } as unknown as QueryBus;
    const mockCommandBus = { execute: jest.fn() } as unknown as CommandBus;

    const controller = new AuthProfileController(mockCommandBus, mockQueryBus);

    const mockReq = {
      rbacContext: {
        userId: "user-1",
        sessionId: "session-1",
        role: AUTH_USER_ROLES.customer,
        scope: null,
      },
      correlationId: "corr-1",
    } as unknown as AuthenticatedRequest;

    const result = await controller.getPrivacySettings(mockReq);

    expect(result).toEqual({
      retain_repository_telemetry: false,
      enable_audit_export_api: true,
      restricted_assessment_sharing: false,
      purge_agent_memory_on_completion: true,
      improve_models: { enabled: false, enforced: true },
      updated_at: null,
    });
    expect(executeQuery).toHaveBeenCalledWith(
      new GetPrivacySettingsQuery(mockReq.rbacContext, "corr-1"),
    );
  });

  it("dispatches UpdatePrivacySettingsCommand on PATCH /auth/privacy", async () => {
    const executeCommand = jest.fn().mockResolvedValue({
      retain_repository_telemetry: true,
      enable_audit_export_api: true,
      restricted_assessment_sharing: false,
      purge_agent_memory_on_completion: true,
      improve_models: { enabled: false, enforced: true },
      updated_at: "2026-11-24T12:00:00.000Z",
    } as never);
    const mockQueryBus = { execute: jest.fn() } as unknown as QueryBus;
    const mockCommandBus = { execute: executeCommand } as unknown as CommandBus;

    const controller = new AuthProfileController(mockCommandBus, mockQueryBus);

    const mockReq = {
      rbacContext: {
        userId: "user-1",
        sessionId: "session-1",
        role: AUTH_USER_ROLES.customer,
        scope: null,
      },
      correlationId: "corr-2",
    } as unknown as AuthenticatedRequest;

    const result = await controller.updatePrivacySettings(
      { retain_repository_telemetry: true },
      mockReq,
    );

    expect(result).toEqual({
      retain_repository_telemetry: true,
      enable_audit_export_api: true,
      restricted_assessment_sharing: false,
      purge_agent_memory_on_completion: true,
      improve_models: { enabled: false, enforced: true },
      updated_at: "2026-11-24T12:00:00.000Z",
    });
    expect(executeCommand).toHaveBeenCalledWith(
      new UpdatePrivacySettingsCommand(
        { retain_repository_telemetry: true },
        "user-1",
        "session-1",
        { correlationId: "corr-2" },
      ),
    );
  });
});

describe("AuthProfileController - Capability Settings", () => {
  it("dispatches GetCapabilitySettingsQuery on GET /auth/capabilities", async () => {
    const payload = {
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
    };
    const executeQuery = jest.fn().mockResolvedValue(payload as never);
    const controller = new AuthProfileController(
      { execute: jest.fn() } as unknown as CommandBus,
      { execute: executeQuery } as unknown as QueryBus,
    );

    const mockReq = {
      rbacContext: {
        userId: "user-1",
        sessionId: "session-1",
        role: AUTH_USER_ROLES.customer,
        scope: null,
      },
      correlationId: "corr-cap-1",
    } as unknown as AuthenticatedRequest;

    const result = await controller.getCapabilitySettings(mockReq);

    expect(result).toEqual(payload);
    expect(executeQuery).toHaveBeenCalledWith(
      new GetCapabilitySettingsQuery(mockReq.rbacContext, "corr-cap-1"),
    );
  });

  it("dispatches UpdateCapabilitySettingsCommand on PATCH /auth/capabilities", async () => {
    const payload = {
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
      updated_at: "2026-11-25T10:00:00.000Z",
    };
    const executeCommand = jest.fn().mockResolvedValue(payload as never);
    const controller = new AuthProfileController(
      { execute: executeCommand } as unknown as CommandBus,
      { execute: jest.fn() } as unknown as QueryBus,
    );

    const mockReq = {
      rbacContext: {
        userId: "user-1",
        sessionId: "session-1",
        role: AUTH_USER_ROLES.customer,
        scope: null,
      },
      correlationId: "corr-cap-2",
    } as unknown as AuthenticatedRequest;

    const result = await controller.updateCapabilitySettings(
      { tool_access_mode: TOOL_ACCESS_MODES.guided, connector_search: false },
      mockReq,
    );

    expect(result).toEqual(payload);
    expect(executeCommand).toHaveBeenCalledWith(
      new UpdateCapabilitySettingsCommand(
        { tool_access_mode: TOOL_ACCESS_MODES.guided, connector_search: false },
        "user-1",
        "session-1",
        { correlationId: "corr-cap-2" },
      ),
    );
  });

  it("rejects direct API attempts to override locked platform capabilities", () => {
    const attemptCloudExecution = updateCapabilitySettingsSchema.safeParse({
      cloud_code_execution: { enabled: true },
    });
    const attemptNetworkEgress = updateCapabilitySettingsSchema.safeParse({
      network_egress: { enabled: true },
    });
    const attemptCustomDomains = updateCapabilitySettingsSchema.safeParse({
      domain_allowlist: { allowed_domains: ["evil.internal"] },
    });

    expect(attemptCloudExecution.success).toBe(false);
    expect(attemptNetworkEgress.success).toBe(false);
    expect(attemptCustomDomains.success).toBe(false);
  });
});
