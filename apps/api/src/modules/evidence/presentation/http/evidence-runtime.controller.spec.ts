import { jest } from "@jest/globals";
import { AGENTIC_TOOL_NAMES } from "@lcsp/contracts/evidence";
import { NotFoundException } from "@nestjs/common";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { InternalAgenticToolDispatchController } from "./agentic-tool-dispatch.controller.js";
import { InternalEvidenceController } from "./evidence.controller.js";

function buildEvidenceController() {
  const technicalEvidenceReportFindUnique =
    jest.fn<(args?: unknown) => Promise<Record<string, unknown> | null>>();
  const technicalProfileFindUnique =
    jest.fn<(args?: unknown) => Promise<Record<string, unknown> | null>>();
  const commandBus = {
    execute: jest.fn<(query?: unknown) => Promise<{ status: string }>>(),
  };
  const prisma = {
    technicalEvidenceReport: { findUnique: technicalEvidenceReportFindUnique },
    technicalProfile: { findUnique: technicalProfileFindUnique },
  } as unknown as PrismaService;
  return {
    controller: new InternalEvidenceController(commandBus as never, prisma),
    technicalEvidenceReportFindUnique,
    technicalProfileFindUnique,
  };
}

function buildAgenticController() {
  const execute = jest
    .fn<(query?: unknown) => Promise<{ status: string }>>()
    .mockResolvedValue({ status: "READY" });
  const runtimeEvents = {
    recordRunStartedIfMissing: jest
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined),
    recordRunStageChangedIfNeeded: jest
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined),
    recordToolStarted: jest
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined),
    recordToolCompleted: jest
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined),
    recordToolWaitingInput: jest
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined),
    recordToolFailed: jest
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined),
  };
  const controller = new InternalAgenticToolDispatchController(
    { execute } as never,
    { get: jest.fn().mockReturnValue(false) } as never,
    runtimeEvents as never,
  );
  return { controller, execute };
}

describe("InternalEvidenceController runtime reads", () => {
  it("returns accepted evidence report in worker snake_case shape", async () => {
    const { controller, technicalEvidenceReportFindUnique } =
      buildEvidenceController();
    technicalEvidenceReportFindUnique.mockResolvedValue({
      id: "report-1",
      scanJobId: "scan-1",
      assessmentId: "assessment-1",
      organizationId: "org-1",
      snapshotId: "snapshot-1",
      toolsVersion: { semgrep: "1.0" },
      configHash: { semgrep: "sha256:test" },
      evidencePayload: { evidence_graph: { schema_version: "2.0.0" } },
      privacyFlags: { containsSourceCode: false, secretsRedacted: true },
      schemaVersion: "2.0.0",
      status: "ACCEPTED",
      rejectionReason: null,
      createdAt: new Date("2026-08-08T00:00:00.000Z"),
    });
    const result = await controller.getTechnicalEvidenceReport("report-1");
    expect(result).toMatchObject({
      id: "report-1",
      assessment_id: "assessment-1",
      evidence_payload: { evidence_graph: { schema_version: "2.0.0" } },
      status: "accepted",
    });
  });

  it("flattens profileData while persisted identifiers remain authoritative", async () => {
    const { controller, technicalProfileFindUnique } =
      buildEvidenceController();
    technicalProfileFindUnique.mockResolvedValue({
      id: "profile-1",
      evidenceReportId: "report-1",
      assessmentId: "assessment-1",
      organizationId: "org-1",
      schemaVersion: "2.0.0",
      providerVersion: "technical-profile-worker@2",
      profileData: {
        id: "spoofed-id",
        assessment_id: "spoofed",
        ai_detected: "confirmed",
        program_graph_ref: { graphId: "graph:1" },
      },
      privacyFlags: { containsSourceCode: false, secretsRedacted: true },
      status: "ACCEPTED",
      rejectionReason: null,
      createdAt: new Date("2026-08-08T00:00:00.000Z"),
    });
    const result = await controller.getTechnicalProfile("profile-1");
    expect(result).toMatchObject({
      id: "profile-1",
      assessment_id: "assessment-1",
      ai_detected: "confirmed",
      program_graph_ref: { graphId: "graph:1" },
      status: "accepted",
    });
  });

  it("returns 404 for missing worker artifacts", async () => {
    const {
      controller,
      technicalEvidenceReportFindUnique,
      technicalProfileFindUnique,
    } = buildEvidenceController();
    technicalEvidenceReportFindUnique.mockResolvedValue(null);
    technicalProfileFindUnique.mockResolvedValue(null);
    await expect(
      controller.getTechnicalEvidenceReport("missing"),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.getTechnicalProfile("missing"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("InternalAgenticToolDispatchController CQRS boundary", () => {
  it("dispatches CQRS-only get_artifact_chain to QueryBus", async () => {
    const { controller, execute } = buildAgenticController();
    await controller.dispatch({
      tool_name: AGENTIC_TOOL_NAMES.getArtifactChain,
      assessment_id: "assessment-1",
      organization_id: "org-1",
      user_id: "user-1",
      artifact_versions: {},
      input: { anchor: { assessmentId: "assessment:abcdefgh" } },
      correlationId: "corr-1",
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("rejects Python-local technical processing at the Nest CQRS dispatcher", async () => {
    const { controller, execute } = buildAgenticController();
    await expect(
      controller.dispatch({
        tool_name: AGENTIC_TOOL_NAMES.getScanCoverage,
        assessment_id: "assessment-1",
        organization_id: "org-1",
        user_id: "user-1",
        artifact_versions: { technicalEvidenceReportId: "report-1" },
        input: { maxResults: 10 },
        correlationId: "corr-1",
      }),
    ).rejects.toBeDefined();
    expect(execute).not.toHaveBeenCalled();
  });
});
