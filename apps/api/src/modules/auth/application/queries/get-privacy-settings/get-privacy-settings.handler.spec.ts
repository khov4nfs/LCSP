import { describe, expect, it, jest } from "@jest/globals";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";

import type {
  PrivacySettingsRecord,
  PrivacySettingsRepository,
} from "../../ports/persistence/privacy-settings.repository.ts";
import { GetPrivacySettingsHandler } from "./get-privacy-settings.handler.ts";
import { GetPrivacySettingsQuery } from "./get-privacy-settings.query.ts";

describe("GetPrivacySettingsHandler", () => {
  it("returns default privacy settings when no record exists", async () => {
    const findByUserId = jest
      .fn<PrivacySettingsRepository["findByUserId"]>()
      .mockResolvedValue(null);
    const mockRepo: PrivacySettingsRepository = {
      findByUserId,
      upsert: jest.fn<PrivacySettingsRepository["upsert"]>(),
    };

    const handler = new GetPrivacySettingsHandler(mockRepo);
    const result = await handler.execute(
      new GetPrivacySettingsQuery(
        {
          userId: "user-123",
          sessionId: "session-123",
          role: AUTH_USER_ROLES.customer,
          scope: null,
        },
        "corr-1",
      ),
    );

    expect(result).toEqual({
      retain_repository_telemetry: false,
      enable_audit_export_api: true,
      restricted_assessment_sharing: false,
      purge_agent_memory_on_completion: true,
      improve_models: {
        enabled: false,
        enforced: true,
      },
      updated_at: null,
    });
    expect(findByUserId).toHaveBeenCalledWith("user-123");
  });

  it("returns mapped privacy settings and ISO updated_at timestamp when record exists", async () => {
    const updatedAt = new Date("2026-11-24T12:00:00.000Z");
    const record: PrivacySettingsRecord = {
      id: "privacy-1",
      userId: "user-456",
      retainRepositoryTelemetry: true,
      enableAuditExportApi: false,
      restrictedAssessmentSharing: true,
      purgeAgentMemoryOnCompletion: false,
      createdAt: new Date("2026-11-20T10:00:00.000Z"),
      updatedAt,
    };

    const findByUserId = jest
      .fn<PrivacySettingsRepository["findByUserId"]>()
      .mockResolvedValue(record);
    const mockRepo: PrivacySettingsRepository = {
      findByUserId,
      upsert: jest.fn<PrivacySettingsRepository["upsert"]>(),
    };

    const handler = new GetPrivacySettingsHandler(mockRepo);
    const result = await handler.execute(
      new GetPrivacySettingsQuery(
        {
          userId: "user-456",
          sessionId: "session-456",
          role: AUTH_USER_ROLES.customer,
          scope: null,
        },
        "corr-2",
      ),
    );

    expect(result).toEqual({
      retain_repository_telemetry: true,
      enable_audit_export_api: false,
      restricted_assessment_sharing: true,
      purge_agent_memory_on_completion: false,
      improve_models: {
        enabled: false,
        enforced: true,
      },
      updated_at: "2026-11-24T12:00:00.000Z",
    });
    expect(findByUserId).toHaveBeenCalledWith("user-456");
  });
});
