import { describe, expect, it, jest } from "@jest/globals";
import { AUDIT_EVENT_TYPES } from "@lcsp/contracts/audit";
import { AssessmentSessionExportController } from "./assessment-session-export.controller.js";

describe("AssessmentSessionExportController", () => {
  it("streams exported session JSON and records audit trail", async () => {
    const mockExportData = {
      schemaVersion: "assessment.session.v1",
      session: { assessmentId: "a1" },
      integrity: {
        provenanceSha256: "prov-checksum-123",
        contentSha256: "content-sha",
      },
    };

    const mockLoader = {
      load: jest.fn((_input: any) => Promise.resolve(mockExportData)),
    };

    const mockAudit = {
      write: jest.fn((_payload: any) => Promise.resolve(undefined)),
    };

    const controller = new AssessmentSessionExportController(
      mockLoader as any,
      mockAudit as any,
    );

    const headers: Record<string, string> = {};
    const mockResponse = {
      setHeader: jest.fn((name: string, value: string) => {
        headers[name] = value;
      }),
    };

    const mockRequest = {
      correlationId: "corr-123",
      rbacContext: {
        userId: "user-1",
        role: "CUSTOMER",
      },
    };

    const result = await controller.download(
      "a1",
      mockRequest as any,
      mockResponse as any,
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
