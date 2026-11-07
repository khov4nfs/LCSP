import { describe, expect, it, jest } from "@jest/globals";
import { AUDIT_EVENT_TYPES } from "@lcsp/contracts/audit";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import type { Response } from "express";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import type { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";
import type { AssessmentSessionExportLoader } from "../../infrastructure/persistence/assessment-session-export.loader.js";
import { AssessmentSessionExportController } from "./assessment-session-export.controller.js";

describe("AssessmentSessionExportController", () => {
  it("streams exported session JSON and records audit trail", async () => {
    type SessionExport = Awaited<
      ReturnType<AssessmentSessionExportLoader["load"]>
    >;
    type ExportFixture = Pick<SessionExport, "schemaVersion" | "integrity"> & {
      session: Pick<SessionExport["session"], "assessmentId">;
    };
    const mockExportData: ExportFixture = {
      schemaVersion: "assessment.session.v1",
      session: { assessmentId: "a1" },
      integrity: {
        provenanceSha256: "prov-checksum-123",
        contentSha256: "content-sha",
      },
    };

    const mockLoader = {
      load: jest
        .fn<
          (
            input: Parameters<AssessmentSessionExportLoader["load"]>[0],
          ) => Promise<ExportFixture>
        >()
        .mockResolvedValue(mockExportData),
    };

    const mockAudit = {
      write: jest
        .fn<AuditWriterService["write"]>()
        .mockResolvedValue(undefined),
    };

    const controller = new AssessmentSessionExportController(
      // The controller fixture supplies only the public dependency surfaces it uses.
      mockLoader as unknown as AssessmentSessionExportLoader,
      mockAudit as unknown as AuditWriterService,
    );

    const headers: Record<string, string> = {};
    const mockResponse: Pick<Response, "setHeader"> = {
      setHeader: jest.fn<Response["setHeader"]>((name, value) => {
        headers[name] = String(value);
        return mockResponse as Response;
      }),
    };

    const mockRequest = {
      correlationId: "corr-123",
      rbacContext: {
        userId: "user-1",
        sessionId: "session-1",
        role: AUTH_USER_ROLES.customer,
        scope: null,
      },
    } satisfies Pick<AuthenticatedRequest, "correlationId" | "rbacContext">;

    const result = await controller.download(
      "a1",
      mockRequest as AuthenticatedRequest,
      mockResponse as Response,
    );

    expect(mockLoader.load).toHaveBeenCalledWith({
      assessmentId: "a1",
      sessionUserId: "user-1",
      subjectRole: "CUSTOMER",
      correlationId: "corr-123",
    });

    expect(mockResponse.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "private, no-store",
    );
    expect(headers["X-Content-Fingerprint-Sha256"]).toBe("prov-checksum-123");
    expect(headers["X-Checksum-Sha256"]).toBeDefined();

    expect(mockAudit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: AUDIT_EVENT_TYPES.sessionExported,
        assessmentId: "a1",
        actorId: "user-1",
      }),
    );

    expect(result).toBeDefined();
  });
});
