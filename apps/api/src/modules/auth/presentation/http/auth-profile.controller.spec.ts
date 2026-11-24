import { describe, expect, it, jest } from "@jest/globals";
import type { CommandBus, QueryBus } from "@nestjs/cqrs";

import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import type { AuthenticatedRequest } from "../../../../platform/rbac/interfaces/authenticated-request.interface.ts";
import { UpdatePrivacySettingsCommand } from "../../application/commands/index.ts";
import { GetPrivacySettingsQuery } from "../../application/queries/index.ts";
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
