import { describe, expect, it, jest } from "@jest/globals";
import {
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_STATUS_CODES,
  type AssessmentStatusCode,
} from "@lcsp/contracts/assessment";
import {
  AI_DISCOVERY_EVIDENCE_STATES,
  AI_DISCOVERY_GATES,
  ASSESSMENT_TECHNICAL_COVERAGE_STATES,
} from "@lcsp/contracts/evidence";
import { TECHNICAL_EVIDENCE_REPORT_STATUSES } from "@lcsp/contracts/scan";
import { HttpException } from "@nestjs/common";

import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { Assessment } from "../../../domain/entities/assessment.entity.js";
import type { AssessmentRepository } from "../../ports/persistence/assessment.repository.js";
import { provesAiAbsence } from "./ai-absence-evidence.js";
import { MarkAiNotDetectedCommand } from "./mark-ai-not-detected.command.js";
import { MarkAiNotDetectedHandler } from "./mark-ai-not-detected.handler.js";

const READY = ASSESSMENT_TECHNICAL_COVERAGE_STATES.ready;

type AbsencePayload = {
  technicalCoverageState: string;
  evidence_graph: { coverage_state: string; unresolved_frontiers: string[] };
  ai_discovery: {
    gate: string;
    coverage_state: string;
    findings: { state: string }[];
    material_unresolved_frontiers: string[];
  };
};

function absencePayload(): AbsencePayload {
  return {
    technicalCoverageState: READY,
    evidence_graph: { coverage_state: READY, unresolved_frontiers: [] },
    ai_discovery: {
      gate: AI_DISCOVERY_GATES.absentConfirmed,
      coverage_state: READY,
      findings: [],
      material_unresolved_frontiers: [],
    },
  };
}

function buildHandler(input?: {
  status?: AssessmentStatusCode;
  latest?: { id: string; evidencePayload: unknown } | null;
}) {
  const assessment = Assessment.rehydrate({
    id: "assessment-1",
    ownerId: "user-1",
    name: "No AI repository",
    description: null,
    status: input?.status ?? ASSESSMENT_STATUS_CODES.wizardSubmitted,
    createdAt: new Date("2026-09-26T00:00:00.000Z"),
    updatedAt: new Date("2026-09-26T00:00:00.000Z"),
  });
  const saveInTx = jest
    .fn<AssessmentRepository["saveInTx"]>()
    .mockResolvedValue(undefined);
  const repository: AssessmentRepository = {
    save: jest.fn<AssessmentRepository["save"]>().mockResolvedValue(undefined),
    saveInTx,
    findById: jest
      .fn<AssessmentRepository["findById"]>()
      .mockResolvedValue(assessment),
    findMany: jest
      .fn<AssessmentRepository["findMany"]>()
      .mockResolvedValue({ items: [], total: 0 }),
  };
  const writeInTx = jest
    .fn<AuditWriterService["writeInTx"]>()
    .mockResolvedValue(undefined);
  const reportFindFirst = jest
    .fn<(args: unknown) => Promise<unknown>>()
    .mockResolvedValue(
      input?.latest === undefined
        ? { id: "report-1", evidencePayload: absencePayload() }
        : input.latest,
    );
  const tx = { id: "tx" };
  const prisma = {
    technicalEvidenceReport: { findFirst: reportFindFirst },
    $transaction: jest.fn((callback: (client: unknown) => unknown) =>
      Promise.resolve(callback(tx)),
    ),
  };
  const handler = new MarkAiNotDetectedHandler(
    repository,
    prisma as never,
    { writeInTx } as unknown as AuditWriterService,
  );
  return { assessment, handler, reportFindFirst, saveInTx, tx, writeInTx };
}

async function problemCode(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(HttpException);
  const exception = error as HttpException;
  const body = exception.getResponse() as {
    problem: { code: string; status: number };
  };
  expect(body.problem.status).toBe(exception.getStatus());
  return body.problem.code;
}

describe("MarkAiNotDetectedHandler", () => {
  it("ends the assessment as AI not detected from the latest accepted absence proof", async () => {
    const { assessment, handler, reportFindFirst, saveInTx, tx, writeInTx } =
      buildHandler();

    const result = await handler.execute(
      new MarkAiNotDetectedCommand("assessment-1", "report-1", "corr-1"),
    );

    expect(result).toEqual({
      assessment_id: "assessment-1",
      status: ASSESSMENT_STATUS_CODES.aiNotDetected,
      technical_evidence_report_id: "report-1",
    });
    expect(assessment.status).toBe(ASSESSMENT_STATUS_CODES.aiNotDetected);
    expect(reportFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          assessmentId: "assessment-1",
          status: TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted,
        },
      }),
    );
    expect(saveInTx).toHaveBeenCalledTimes(1);
    expect(saveInTx.mock.calls[0][1]).toBe(tx);
    expect(writeInTx.mock.calls[0][1]).toBe(tx);
    expect(writeInTx.mock.calls[0][0]).toMatchObject({
      eventType: ASSESSMENT_EVENT_TYPES.aiNotDetected,
      actorId: null,
      payload: {
        assessmentId: "assessment-1",
        technicalEvidenceReportId: "report-1",
      },
    });
  });

  it("is idempotent once the assessment already ended as AI not detected", async () => {
    const { handler, reportFindFirst, saveInTx } = buildHandler({
      status: ASSESSMENT_STATUS_CODES.aiNotDetected,
    });

    await handler.execute(
      new MarkAiNotDetectedCommand("assessment-1", "report-1", "corr-2"),
    );

    expect(reportFindFirst).not.toHaveBeenCalled();
    expect(saveInTx).not.toHaveBeenCalled();
  });

  it("rejects a report that is not the latest accepted report", async () => {
    const { assessment, handler, saveInTx } = buildHandler({
      latest: { id: "report-newer", evidencePayload: absencePayload() },
    });

    const code = await problemCode(
      handler.execute(
        new MarkAiNotDetectedCommand("assessment-1", "report-1", "corr-3"),
      ),
    );

    expect(code).toBe(ASSESSMENT_ERROR_CODES.aiAbsenceNotProven);
    expect(assessment.status).toBe(ASSESSMENT_STATUS_CODES.wizardSubmitted);
    expect(saveInTx).not.toHaveBeenCalled();
  });

  it("rejects evidence that does not prove absence", async () => {
    const payload = absencePayload();
    payload.ai_discovery.gate = AI_DISCOVERY_GATES.unknown;
    const { handler, saveInTx } = buildHandler({
      latest: { id: "report-1", evidencePayload: payload },
    });

    const code = await problemCode(
      handler.execute(
        new MarkAiNotDetectedCommand("assessment-1", "report-1", "corr-4"),
      ),
    );

    expect(code).toBe(ASSESSMENT_ERROR_CODES.aiAbsenceNotProven);
    expect(saveInTx).not.toHaveBeenCalled();
  });

  it("never overrides a locked classification", async () => {
    const { handler, saveInTx } = buildHandler({
      status: ASSESSMENT_STATUS_CODES.classificationLocked,
    });

    const code = await problemCode(
      handler.execute(
        new MarkAiNotDetectedCommand("assessment-1", "report-1", "corr-5"),
      ),
    );

    expect(code).toBe(ASSESSMENT_ERROR_CODES.aiNotDetectedStateInvalid);
    expect(saveInTx).not.toHaveBeenCalled();
  });

  it("rejects a missing evidence report reference", async () => {
    const { handler } = buildHandler();

    const code = await problemCode(
      handler.execute(
        new MarkAiNotDetectedCommand("assessment-1", undefined, "corr-6"),
      ),
    );

    expect(code).toBe(ASSESSMENT_ERROR_CODES.invalidRequest);
  });
});

describe("provesAiAbsence", () => {
  it("accepts a READY absence proof", () => {
    expect(provesAiAbsence(absencePayload())).toBe(true);
  });

  it.each([
    [
      "PARTIAL technical coverage",
      (p: AbsencePayload) => {
        p.technicalCoverageState = ASSESSMENT_TECHNICAL_COVERAGE_STATES.partial;
      },
    ],
    [
      "PARTIAL AI coverage",
      (p: AbsencePayload) => {
        p.ai_discovery.coverage_state =
          ASSESSMENT_TECHNICAL_COVERAGE_STATES.partial;
      },
    ],
    [
      "an AI provider reference",
      (p: AbsencePayload) => {
        p.ai_discovery.findings = [
          { state: AI_DISCOVERY_EVIDENCE_STATES.aiProviderReference },
        ];
      },
    ],
    [
      "a material unresolved frontier",
      (p: AbsencePayload) => {
        p.ai_discovery.material_unresolved_frontiers = ["dynamic endpoint"];
      },
    ],
    [
      "a graph unresolved frontier",
      (p: AbsencePayload) => {
        p.evidence_graph.unresolved_frontiers = ["unparsed module"];
      },
    ],
  ])("rejects %s", (_label, mutate) => {
    const payload = absencePayload();
    mutate(payload);
    expect(provesAiAbsence(payload)).toBe(false);
  });

  it("rejects a missing or malformed payload", () => {
    expect(provesAiAbsence(null)).toBe(false);
    expect(provesAiAbsence({ ai_discovery: "absent" })).toBe(false);
  });

  it("allows explicit NO_AI_SIGNAL findings", () => {
    const payload = absencePayload();
    payload.ai_discovery.findings = [
      { state: AI_DISCOVERY_EVIDENCE_STATES.noAiSignal },
    ];
    expect(provesAiAbsence(payload)).toBe(true);
  });
});
