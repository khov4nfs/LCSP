import { describe, expect, it, jest } from "@jest/globals";
import { HttpStatus, UnprocessableEntityException } from "@nestjs/common";

import { AcceptTechnicalProfileCommand } from "./accept-technical-profile.command.js";
import { AcceptTechnicalProfileHandler } from "./accept-technical-profile.handler.js";

interface ProblemResponse {
  problem: {
    code: string;
    status: number;
  };
}

function buildHandler(
  mockReadAndReconstruct?: jest.Mock<() => Promise<string>>,
) {
  const technicalEvidenceReport = {
    findFirst: jest.fn().mockImplementation(() =>
      Promise.resolve({
        id: "report-1",
        assessmentId: "assessment-1",
        organizationId: "org-1",
      }),
    ),
  };
  const technicalProfile = {
    findUnique: jest.fn().mockImplementation(() => Promise.resolve(null)),
    create: jest.fn().mockImplementation(() => Promise.resolve()),
  };
  const outboxMessage = {
    create: jest.fn().mockImplementation(() => Promise.resolve()),
  };
  const authAuditEvent = {
    create: jest.fn().mockImplementation(() => Promise.resolve()),
  };
  const prisma = {
    technicalEvidenceReport,
    technicalProfile,
    outboxMessage,
    authAuditEvent,
    $transaction: jest.fn((handler: (tx: any) => unknown) =>
      Promise.resolve(
        handler({ technicalProfile, outboxMessage, authAuditEvent }),
      ),
    ),
  };
  const storageService = {
    readAndReconstruct:
      mockReadAndReconstruct ||
      jest.fn<() => Promise<string>>().mockImplementation(() =>
        Promise.resolve(
          JSON.stringify({
            evidence_report_id: "report-1",
            assessment_id: "assessment-1",
            schema_version: "1.0.0",
            provider_version: "prov-1",
            profile_data: { ai_detected: "confirmed" },
            privacy_flags: { containsSourceCode: false, secretsRedacted: true },
          }),
        ),
      ),
  };
  return {
    handler: new AcceptTechnicalProfileHandler(
      prisma as never,
      storageService as never,
    ),
    technicalEvidenceReport,
    technicalProfile,
    storageService,
  };
}

describe("AcceptTechnicalProfileHandler", () => {
  it("reconstructs and accepts a valid artifact reference envelope", async () => {
    const { handler, storageService } = buildHandler();
    const payload = {
      evidence_report_id: "report-1",
      assessment_id: "assessment-1",
      schema_version: "1.0.0",
      provider_version: "prov-1",
      privacy_flags: { containsSourceCode: false, secretsRedacted: true },
      is_artifact_reference: true,
      artifact_manifest: {
        artifact_id: "art-1",
        total_size: 100,
        hash: "sha256-hex",
        chunks: ["chunk_0.json"],
      },
    };
    const response = await handler.execute(
      new AcceptTechnicalProfileCommand(payload, "correlation-1"),
    );
    expect(response.accepted).toBe(true);
    expect(storageService.readAndReconstruct).toHaveBeenCalled();
  });

  it("accepts a normal small inline payload", async () => {
    const { handler } = buildHandler();
    const payload = {
      evidence_report_id: "report-1",
      assessment_id: "assessment-1",
      schema_version: "1.0.0",
      provider_version: "prov-1",
      profile_data: { ai_detected: "confirmed" },
      privacy_flags: { containsSourceCode: false, secretsRedacted: true },
    };
    const response = await handler.execute(
      new AcceptTechnicalProfileCommand(payload, "correlation-1"),
    );
    expect(response.accepted).toBe(true);
  });

  it("throws UnprocessableEntityException with ARTIFACT_STORAGE_ERROR if storage reconstruction fails", async () => {
    const mockReconstruct = jest
      .fn<() => Promise<string>>()
      .mockRejectedValue(new Error("read error"));
    const { handler } = buildHandler(mockReconstruct);
    const payload = {
      evidence_report_id: "report-1",
      assessment_id: "assessment-1",
      schema_version: "1.0.0",
      provider_version: "prov-1",
      privacy_flags: { containsSourceCode: false, secretsRedacted: true },
      is_artifact_reference: true,
      artifact_manifest: {
        artifact_id: "art-1",
        total_size: 100,
        hash: "sha256-hex",
        chunks: ["chunk_0.json"],
      },
    };

    let error: UnprocessableEntityException | undefined;
    try {
      await handler.execute(
        new AcceptTechnicalProfileCommand(payload, "correlation-1"),
      );
    } catch (e) {
      if (e instanceof UnprocessableEntityException) {
        error = e;
      }
    }

    expect(error).toBeDefined();
    if (error) {
      const body = error.getResponse() as ProblemResponse;
      expect(body.problem.code).toBe("ARTIFACT_STORAGE_ERROR");
      expect(body.problem.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    }
  });

  it("ensures problem status aligns with thrown exception (422 for SCHEMA_INVALID)", async () => {
    const { handler } = buildHandler();
    const payload = {
      evidence_report_id: "report-1",
      assessment_id: "assessment-1",
      schema_version: "1.0.0",
      provider_version: "prov-1",
      privacy_flags: { containsSourceCode: false, secretsRedacted: true },
    };

    let error: UnprocessableEntityException | undefined;
    try {
      await handler.execute(
        new AcceptTechnicalProfileCommand(payload, "correlation-1"),
      );
    } catch (e) {
      if (e instanceof UnprocessableEntityException) {
        error = e;
      }
    }

    expect(error).toBeDefined();
    if (error) {
      const body = error.getResponse() as ProblemResponse;
      expect(body.problem.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    }
  });
});
