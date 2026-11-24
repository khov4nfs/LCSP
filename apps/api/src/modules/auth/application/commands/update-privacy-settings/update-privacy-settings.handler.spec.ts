import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_AUDIT_EVENT_TYPES,
  AUTH_ERROR_CODES,
  USER_ACCESS_STATUSES,
} from "@lcsp/contracts/auth";
import { describe, expect, it, jest } from "@jest/globals";

import { AuthApplicationError } from "../../errors/auth-application.error.ts";
import type {
  PrivacySettingsRecord,
  PrivacySettingsRepository,
} from "../../ports/persistence/privacy-settings.repository.ts";
import type { UserRepository } from "../../ports/persistence/user.repository.ts";
import { UpdatePrivacySettingsCommand } from "./update-privacy-settings.command.ts";
import { UpdatePrivacySettingsHandler } from "./update-privacy-settings.handler.ts";

describe("UpdatePrivacySettingsHandler", () => {
  it("rejects when user is not found or suspended", async () => {
    const support = {
      createCorrelationId: () => "corr-test",
      recordAudit: jest
        .fn<(event: unknown) => Promise<void>>()
        .mockResolvedValue(),
    };
    const mockUsers = {
      findById: jest.fn<UserRepository["findById"]>().mockResolvedValue(null),
    };
    const mockPrivacyRepo = {
      findByUserId: jest.fn<PrivacySettingsRepository["findByUserId"]>(),
      upsert: jest.fn<PrivacySettingsRepository["upsert"]>(),
    };

    const handler = new UpdatePrivacySettingsHandler(
      support as never,
      mockUsers as unknown as UserRepository,
      mockPrivacyRepo,
    );

    let thrown: unknown;
    try {
      await handler.execute(
        new UpdatePrivacySettingsCommand(
          { retain_repository_telemetry: true },
          "user-inactive",
          "session-1",
          { correlationId: "corr-test" },
        ),
      );
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(AuthApplicationError);
    expect((thrown as AuthApplicationError).code).toBe(
      AUTH_ERROR_CODES.accountSuspended,
    );
  });

  it("upserts privacy settings, emits audit event, and returns normalized response", async () => {
    const record: PrivacySettingsRecord = {
      id: "privacy-1",
      userId: "user-123",
      retainRepositoryTelemetry: true,
      enableAuditExportApi: true,
      restrictedAssessmentSharing: false,
      purgeAgentMemoryOnCompletion: true,
      createdAt: new Date("2026-11-20T10:00:00.000Z"),
      updatedAt: new Date("2026-11-24T14:00:00.000Z"),
    };

    const recordAudit = jest
      .fn<(event: unknown) => Promise<void>>()
      .mockResolvedValue();
    const support = {
      createCorrelationId: () => "corr-test",
      recordAudit,
    };
    const mockUsers = {
      findById: jest.fn<UserRepository["findById"]>().mockResolvedValue({
        id: "user-123",
        accessStatus: USER_ACCESS_STATUSES.active,
      } as never),
    };
    const upsert = jest
      .fn<PrivacySettingsRepository["upsert"]>()
      .mockResolvedValue(record);
    const mockPrivacyRepo = {
      findByUserId: jest.fn<PrivacySettingsRepository["findByUserId"]>(),
      upsert,
    };

    const handler = new UpdatePrivacySettingsHandler(
      support as never,
      mockUsers as unknown as UserRepository,
      mockPrivacyRepo,
    );

    const result = await handler.execute(
      new UpdatePrivacySettingsCommand(
        {
          retain_repository_telemetry: true,
        },
        "user-123",
        "session-1",
        { correlationId: "corr-123" },
      ),
    );

    expect(result).toEqual({
      retain_repository_telemetry: true,
      enable_audit_export_api: true,
      restricted_assessment_sharing: false,
      purge_agent_memory_on_completion: true,
      improve_models: {
        enabled: false,
        enforced: true,
      },
      updated_at: "2026-11-24T14:00:00.000Z",
    });

    expect(upsert).toHaveBeenCalledWith("user-123", {
      retainRepositoryTelemetry: true,
    });

    expect(recordAudit).toHaveBeenCalledWith({
      event_type: AUTH_AUDIT_EVENT_TYPES.authPrivacySettingsUpdated,
      actor_id: "user-123",
      decision: AUDIT_DECISIONS.allow,
      updated_fields: ["retain_repository_telemetry"],
      correlationId: "corr-123",
    });
  });
});
