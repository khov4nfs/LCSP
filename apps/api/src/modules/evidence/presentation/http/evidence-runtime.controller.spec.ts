import { jest } from "@jest/globals";
import { AUTH_USER_ROLES, REQUIRED_ACTIONS } from "@lcsp/contracts/auth";
import {
  AGENTIC_TOOL_NAMES,
  EVIDENCE_ERROR_CODES,
} from "@lcsp/contracts/evidence";
import { REPOSITORY_SCAN_JOB_STATUSES } from "@lcsp/contracts/github-integration";
import { HttpStatus, NotFoundException } from "@nestjs/common";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { InternalAgenticToolDispatchController } from "./agentic-tool-dispatch.controller.js";
import {
  EvidenceController,
  InternalEvidenceController,
} from "./evidence.controller.js";

function buildEvidenceController() {
  const technicalEvidenceReportFindUnique =
    jest.fn<(args?: unknown) => Promise<Record<string, unknown> | null>>();
  const technicalProfileFindUnique =
    jest.fn<(args?: unknown) => Promise<Record<string, unknown> | null>>();
  const assessmentFindUnique =
    jest.fn<(args?: unknown) => Promise<Record<string, unknown> | null>>();
  const commandBus = {
    execute: jest.fn<(query?: unknown) => Promise<{ status: string }>>(),
  };
  const prisma = {
    technicalEvidenceReport: { findUnique: technicalEvidenceReportFindUnique },
    technicalProfile: { findUnique: technicalProfileFindUnique },
    assessment: { findUnique: assessmentFindUnique },
  } as unknown as PrismaService;
  return {
    controller: new InternalEvidenceController(commandBus as never, prisma),
    technicalEvidenceReportFindUnique,
    technicalProfileFindUnique,
    assessmentFindUnique,
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

function buildPublicEvidenceController() {
  const technicalEvidenceReportFindFirst =
    jest.fn<(args?: unknown) => Promise<Record<string, unknown> | null>>();
  const technicalEvidenceReportFindUnique =
    jest.fn<(args?: unknown) => Promise<Record<string, unknown> | null>>();
  const repositoryScanJobFindFirst =
    jest.fn<(args?: unknown) => Promise<Record<string, unknown> | null>>();
  const assessmentFindUnique =
    jest.fn<(args?: unknown) => Promise<Record<string, unknown> | null>>();
  const graphDetail = {
    projectAcceptedReport: jest.fn(
      async (input: { loadEvidencePayload: () => Promise<unknown> }) => ({
        payload: await input.loadEvidencePayload(),
      }),
    ),
    projectOverview: jest.fn((payload: unknown) => payload),
  };
  const artifacts = {
    getAvailability: jest
      .fn<(_assessmentId: string) => Promise<unknown>>()
      .mockResolvedValue(null),
    getBusinessContext: jest
      .fn<(_assessmentId: string) => Promise<unknown>>()
      .mockResolvedValue(null),
    getInvestigationNotes: jest
      .fn<(_assessmentId: string) => Promise<unknown>>()
      .mockResolvedValue(null),
  };
  const prisma = {
    technicalEvidenceReport: {
      findFirst: technicalEvidenceReportFindFirst,
      findUnique: technicalEvidenceReportFindUnique,
    },
    repositoryScanJob: { findFirst: repositoryScanJobFindFirst },
    assessment: { findUnique: assessmentFindUnique },
  } as unknown as PrismaService;
  return {
    controller: new EvidenceController(
      {} as never,
      prisma,
      graphDetail as never,
      artifacts as never,
    ),
    technicalEvidenceReportFindFirst,
    technicalEvidenceReportFindUnique,
    repositoryScanJobFindFirst,
    assessmentFindUnique,
    graphDetail,
    artifacts,
  };
}

const adminGraphRequest = {
  correlationId: "corr-graph",
  rbacContext: { role: AUTH_USER_ROLES.admin, userId: "admin-1" },
} as never;

describe("InternalEvidenceController runtime reads", () => {
  it("returns accepted evidence report in worker snake_case shape", async () => {
    const {
      controller,
      technicalEvidenceReportFindUnique,
      assessmentFindUnique,
    } = buildEvidenceController();
    technicalEvidenceReportFindUnique.mockResolvedValue({
      id: "report-1",
      scanJobId: "scan-1",
      assessmentId: "assessment-1",
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
    assessmentFindUnique.mockResolvedValue({ ownerId: "owner-1" });
    const result = await controller.getTechnicalEvidenceReport("report-1");
    expect(result).toMatchObject({
      id: "report-1",
      assessment_id: "assessment-1",
      user_id: "owner-1",
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

describe("EvidenceController graph lifecycle", () => {
  it.each([
    REPOSITORY_SCAN_JOB_STATUSES.queued,
    REPOSITORY_SCAN_JOB_STATUSES.running,
    REPOSITORY_SCAN_JOB_STATUSES.pendingMapping,
    REPOSITORY_SCAN_JOB_STATUSES.readyToSnapshot,
  ])("returns EVIDENCE_NOT_READY while the scan is %s", async (scanStatus) => {
    const {
      controller,
      technicalEvidenceReportFindFirst,
      repositoryScanJobFindFirst,
      graphDetail,
    } = buildPublicEvidenceController();
    technicalEvidenceReportFindFirst.mockResolvedValue(null);
    repositoryScanJobFindFirst.mockResolvedValue({
      id: "scan-active",
      status: scanStatus,
    });

    await expect(
      controller.getEvidenceGraph("assessment-1", adminGraphRequest),
    ).rejects.toMatchObject({
      status: HttpStatus.ACCEPTED,
      response: {
        ok: false,
        problem: {
          status: HttpStatus.ACCEPTED,
          code: EVIDENCE_ERROR_CODES.notReady,
          requiredAction: REQUIRED_ACTIONS.none,
          meta: { scanJobId: "scan-active", scanStatus },
        },
      },
    });
    expect(graphDetail.projectAcceptedReport).not.toHaveBeenCalled();
  });

  it("returns EVIDENCE_NOT_READY for overview while the scan is running", async () => {
    const {
      controller,
      technicalEvidenceReportFindFirst,
      repositoryScanJobFindFirst,
      graphDetail,
    } = buildPublicEvidenceController();
    technicalEvidenceReportFindFirst.mockResolvedValue(null);
    repositoryScanJobFindFirst.mockResolvedValue({
      id: "scan-overview-running",
      status: REPOSITORY_SCAN_JOB_STATUSES.running,
    });

    await expect(
      controller.getEvidenceGraphOverview("assessment-1", adminGraphRequest),
    ).rejects.toMatchObject({
      status: HttpStatus.ACCEPTED,
      response: {
        ok: false,
        problem: {
          code: EVIDENCE_ERROR_CODES.notReady,
          requiredAction: REQUIRED_ACTIONS.none,
          meta: {
            scanJobId: "scan-overview-running",
            scanStatus: REPOSITORY_SCAN_JOB_STATUSES.running,
          },
        },
      },
    });
    expect(graphDetail.projectOverview).not.toHaveBeenCalled();
  });

  it("returns EVIDENCE_NOT_READY after scan completion while report acceptance is pending", async () => {
    const {
      controller,
      technicalEvidenceReportFindFirst,
      repositoryScanJobFindFirst,
    } = buildPublicEvidenceController();
    technicalEvidenceReportFindFirst.mockResolvedValue(null);
    repositoryScanJobFindFirst.mockResolvedValue({
      id: "scan-done",
      status: REPOSITORY_SCAN_JOB_STATUSES.completed,
    });

    await expect(
      controller.getEvidenceGraph("assessment-1", adminGraphRequest),
    ).rejects.toMatchObject({
      status: HttpStatus.ACCEPTED,
      response: { problem: { code: EVIDENCE_ERROR_CODES.notReady } },
    });
  });

  it.each([
    REPOSITORY_SCAN_JOB_STATUSES.failed,
    REPOSITORY_SCAN_JOB_STATUSES.blocked,
    REPOSITORY_SCAN_JOB_STATUSES.blockedMapping,
  ])(
    "returns EVIDENCE_BUILD_FAILED when the scan is %s",
    async (scanStatus) => {
      const {
        controller,
        technicalEvidenceReportFindFirst,
        repositoryScanJobFindFirst,
      } = buildPublicEvidenceController();
      technicalEvidenceReportFindFirst.mockResolvedValue(null);
      repositoryScanJobFindFirst.mockResolvedValue({
        id: "scan-failed",
        status: scanStatus,
      });

      await expect(
        controller.getEvidenceGraph("assessment-1", adminGraphRequest),
      ).rejects.toMatchObject({
        status: HttpStatus.CONFLICT,
        response: {
          problem: {
            status: HttpStatus.CONFLICT,
            code: EVIDENCE_ERROR_CODES.buildFailed,
            meta: { scanJobId: "scan-failed", scanStatus },
          },
        },
      });
    },
  );

  it("returns EVIDENCE_BUILD_FAILED when the completed scan's evidence report was rejected", async () => {
    const {
      controller,
      technicalEvidenceReportFindFirst,
      repositoryScanJobFindFirst,
    } = buildPublicEvidenceController();
    technicalEvidenceReportFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "report-rejected" });
    repositoryScanJobFindFirst.mockResolvedValue({
      id: "scan-done",
      status: REPOSITORY_SCAN_JOB_STATUSES.completed,
    });

    await expect(
      controller.getEvidenceGraph("assessment-1", adminGraphRequest),
    ).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
      response: { problem: { code: EVIDENCE_ERROR_CODES.buildFailed } },
    });
  });

  it("returns EVIDENCE_NOT_FOUND when no scan or evidence exists", async () => {
    const {
      controller,
      technicalEvidenceReportFindFirst,
      repositoryScanJobFindFirst,
    } = buildPublicEvidenceController();
    technicalEvidenceReportFindFirst.mockResolvedValue(null);
    repositoryScanJobFindFirst.mockResolvedValue(null);

    await expect(
      controller.getEvidenceGraph("assessment-1", adminGraphRequest),
    ).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
      response: { problem: { code: EVIDENCE_ERROR_CODES.notFound } },
    });
  });

  it("projects the accepted report and loads its payload only through the cached projection", async () => {
    const {
      controller,
      technicalEvidenceReportFindFirst,
      technicalEvidenceReportFindUnique,
      repositoryScanJobFindFirst,
      graphDetail,
    } = buildPublicEvidenceController();
    technicalEvidenceReportFindFirst.mockResolvedValue({
      id: "report-accepted",
      assessmentId: "assessment-1",
      scanJobId: "scan-done",
      snapshotId: "snapshot-1",
      createdAt: new Date("2026-09-14T00:00:00.000Z"),
      snapshot: null,
    });
    technicalEvidenceReportFindUnique.mockResolvedValue({
      evidencePayload: { evidence_graph: { nodes: [] } },
    });

    await expect(
      controller.getEvidenceGraph("assessment-1", adminGraphRequest),
    ).resolves.toEqual({
      ok: true,
      data: { payload: { evidence_graph: { nodes: [] } } },
    });
    const acceptedQuery = technicalEvidenceReportFindFirst.mock
      .calls[0]?.[0] as {
      select: Record<string, unknown>;
    };
    expect(acceptedQuery.select).not.toHaveProperty("evidencePayload");
    expect(technicalEvidenceReportFindUnique).toHaveBeenCalledWith({
      where: { id: "report-accepted" },
      select: { evidencePayload: true },
    });
    expect(graphDetail.projectAcceptedReport).toHaveBeenCalledTimes(1);
    expect(repositoryScanJobFindFirst).not.toHaveBeenCalled();
  });
});

describe("EvidenceController assessment artifact reads", () => {
  const customerRequest = {
    correlationId: "corr-artifact",
    rbacContext: { role: AUTH_USER_ROLES.customer, userId: "owner-1" },
  } as never;

  it("returns the artifact projection for the assessment owner", async () => {
    const { controller, assessmentFindUnique, artifacts } =
      buildPublicEvidenceController();
    assessmentFindUnique.mockResolvedValue({ ownerId: "owner-1" });
    artifacts.getBusinessContext.mockResolvedValue({
      type: "BUSINESS_CONTEXT",
      status: "READY",
      content: { confirmedStatements: [] },
    });

    await expect(
      controller.getBusinessContextArtifact("assessment-1", customerRequest),
    ).resolves.toMatchObject({
      ok: true,
      data: { type: "BUSINESS_CONTEXT", status: "READY" },
    });
    expect(artifacts.getBusinessContext).toHaveBeenCalledWith("assessment-1");
  });

  it("denies another customer from reading assessment artifacts", async () => {
    const { controller, assessmentFindUnique, artifacts } =
      buildPublicEvidenceController();
    assessmentFindUnique.mockResolvedValue({ ownerId: "another-owner" });

    await expect(
      controller.getInvestigationNotesArtifact("assessment-1", customerRequest),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(artifacts.getInvestigationNotes).not.toHaveBeenCalled();
  });

  it("allows an admin to read artifact availability", async () => {
    const { controller, assessmentFindUnique, artifacts } =
      buildPublicEvidenceController();
    assessmentFindUnique.mockResolvedValue({ ownerId: "owner-1" });
    artifacts.getAvailability.mockResolvedValue({
      assessmentId: "assessment-1",
      artifacts: [],
    });

    await expect(
      controller.getArtifacts("assessment-1", adminGraphRequest),
    ).resolves.toMatchObject({ ok: true });
    expect(artifacts.getAvailability).toHaveBeenCalledWith("assessment-1");
  });
});

describe("InternalAgenticToolDispatchController CQRS boundary", () => {
  it("dispatches CQRS-only get_artifact_chain to QueryBus", async () => {
    const { controller, execute } = buildAgenticController();
    await controller.dispatch({
      tool_name: AGENTIC_TOOL_NAMES.getArtifactChain,
      assessment_id: "assessment-1",
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
        user_id: "user-1",
        artifact_versions: { technicalEvidenceReportId: "report-1" },
        input: { maxResults: 10 },
        correlationId: "corr-1",
      }),
    ).rejects.toBeDefined();
    expect(execute).not.toHaveBeenCalled();
  });
});
