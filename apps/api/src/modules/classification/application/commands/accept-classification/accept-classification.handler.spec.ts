import { describe, expect, it, jest } from "@jest/globals";
import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import { OUTBOX_AGGREGATE_TYPES } from "@lcsp/contracts/outbox";
import {
  ASSESSMENT_RESULT_MODES,
  CLASSIFICATION_GUARDRAIL_STATUSES,
  CLASSIFICATION_RESULT_STATUSES,
  ENGINEERING_LIMITATION_CODES,
  SCAN_ERROR_CODES,
  SCAN_EVENT_TYPES,
} from "@lcsp/contracts/scan";
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import type { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import type { AssessmentRuntimeEventService } from "../../../../../platform/runtime-events/assessment-runtime-event.service.js";
import type { AcceptClassificationDto } from "../../contracts/classification/classification-result-callback.contract.js";
import { OverclaimGuardrailService } from "../../services/classification/overclaim-guardrail.service.js";
import { AcceptClassificationCommand } from "./accept-classification.command.js";
import { AcceptClassificationHandler } from "./accept-classification.handler.js";

type EvidenceFixture = {
  id: string;
  assessmentId: string;
  organizationId: string;
  snapshotId: string;
} | null;

type ClassificationResultFixture = {
  id: string;
  classificationData: unknown;
};

describe("AcceptClassificationHandler", () => {
  let handler: AcceptClassificationHandler;
  let prisma: jest.Mocked<PrismaService>;
  let mockFindEvidence: jest.Mock<() => Promise<EvidenceFixture>>;
  let mockFindResults: jest.Mock<() => Promise<ClassificationResultFixture[]>>;
  let mockCreateResult: jest.Mock<
    (args: { data: unknown }) => Promise<unknown>
  >;
  let mockEnqueueOutbox: jest.Mock<(...args: unknown[]) => Promise<void>>;
  let mockWriteAuditInTx: jest.Mock<(...args: unknown[]) => Promise<void>>;
  let mockRecordToolCompleted: jest.Mock<(...args: unknown[]) => Promise<void>>;

  const validPayload: AcceptClassificationDto = {
    technical_evidence_report_id: "ter-123",
    assessment_id: "asm-123",
    schema_version: "2.0.0",
    classification_data: {
      mode: ASSESSMENT_RESULT_MODES.engineeringRuleEvaluation,
      status: "COMPLETE",
      summary: { compliant: 1, non_compliant: 1, unknown: 0, total: 2 },
      evaluations: [
        {
          engineering_rule_id: "eng-1",
          legal_rule_id: "legal-1",
          concept: "HUMAN_REVIEW",
          status: "NON_COMPLIANT",
          reason:
            "Repository evidence demonstrates that the engineering requirement is not met.",
          evidence_refs: ["graph:path:1"],
          source_chunk_ids: ["LAW:A1"],
          source_locators: ["art-1::cl-1"],
          confidence: 0.95,
          limitations: [],
        },
      ],
      limitations: [],
    },
    guardrail_status: CLASSIFICATION_GUARDRAIL_STATUSES.passed,
  };

  beforeEach(() => {
    mockFindEvidence = jest
      .fn<() => Promise<EvidenceFixture>>()
      .mockResolvedValue({
        id: "ter-123",
        assessmentId: "asm-123",
        organizationId: "org-123",
        snapshotId: "snapshot-123",
      });
    mockFindResults = jest
      .fn<() => Promise<ClassificationResultFixture[]>>()
      .mockResolvedValue([]);
    mockCreateResult = jest
      .fn<(args: { data: unknown }) => Promise<unknown>>()
      .mockImplementation(({ data }) => Promise.resolve(data));
    mockEnqueueOutbox = jest
      .fn<(...args: unknown[]) => Promise<void>>()
      .mockResolvedValue(undefined);
    mockWriteAuditInTx = jest
      .fn<(...args: unknown[]) => Promise<void>>()
      .mockResolvedValue(undefined);
    mockRecordToolCompleted = jest
      .fn<(...args: unknown[]) => Promise<void>>()
      .mockResolvedValue(undefined);

    prisma = {
      technicalEvidenceReport: { findFirst: mockFindEvidence },
      classificationResult: {
        findMany: mockFindResults,
        create: mockCreateResult,
      },
      $transaction: jest
        .fn()
        .mockImplementation(
          async (callback: (tx: unknown) => Promise<unknown>) =>
            callback(prisma),
        ),
    } as unknown as jest.Mocked<PrismaService>;

    handler = new AcceptClassificationHandler(
      prisma,
      { writeInTx: mockWriteAuditInTx } as unknown as AuditWriterService,
      { enqueue: mockEnqueueOutbox } as unknown as OutboxRepository,
      new OverclaimGuardrailService(),
      {
        recordToolCompleted: mockRecordToolCompleted,
        recordRunCompleted: jest
          .fn<(...args: unknown[]) => Promise<void>>()
          .mockResolvedValue(undefined),
      } as unknown as AssessmentRuntimeEventService,
    );
  });

  it("accepts direct EngineeringRule assessment result", async () => {
    const result = await handler.execute(
      new AcceptClassificationCommand(validPayload, "corr-123"),
    );

    expect(result.accepted).toBe(true);
    expect(result.guardrail_status).toBe(
      CLASSIFICATION_GUARDRAIL_STATUSES.passed,
    );
    expect(mockCreateResult).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          legalRuleMatchId: null,
          verifiedProfileId: null,
          assessmentId: "asm-123",
          organizationId: "org-123",
          schemaVersion: "2.0.0",
          classificationData: expect.objectContaining({
            mode: ASSESSMENT_RESULT_MODES.engineeringRuleEvaluation,
            technical_evidence_report_id: "ter-123",
            snapshot_id: "snapshot-123",
          }),
          status: CLASSIFICATION_RESULT_STATUSES.accepted,
        }),
      }),
    );
    expect(mockEnqueueOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: SCAN_EVENT_TYPES.classificationResultReady,
        aggregateType: OUTBOX_AGGREGATE_TYPES.classificationResult,
      }),
      prisma,
    );
    expect(mockWriteAuditInTx).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: SCAN_EVENT_TYPES.classificationAcceptedAudit,
        decision: AUDIT_DECISIONS.allow,
      }),
      prisma,
    );
    expect(mockRecordToolCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        assessmentId: "asm-123",
        toolName: "engineering_rule_evaluation",
      }),
    );
  });

  it("accepts canonical COMPLIANT/NON_COMPLIANT machine status labels", async () => {
    await expect(
      handler.execute(
        new AcceptClassificationCommand(validPayload, "corr-status"),
      ),
    ).resolves.toEqual(expect.objectContaining({ accepted: true }));
  });

  it("accepts canonical machine limitation codes", async () => {
    const payload: AcceptClassificationDto = {
      ...validPayload,
      classification_data: {
        ...validPayload.classification_data,
        limitations: [ENGINEERING_LIMITATION_CODES.graphCoverageLimited],
      },
    };

    await expect(
      handler.execute(
        new AcceptClassificationCommand(payload, "corr-limit-code"),
      ),
    ).resolves.toEqual(expect.objectContaining({ accepted: true }));
  });

  it("rejects narrative legal/compliance overclaim wording", async () => {
    const payload: AcceptClassificationDto = {
      ...validPayload,
      classification_data: {
        ...validPayload.classification_data,
        notes: "This system is certified and legally compliant.",
      },
    };

    await expect(
      handler.execute(
        new AcceptClassificationCommand(payload, "corr-overclaim"),
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it("rejects free-form prose in machine limitation fields", async () => {
    const evaluations = validPayload.classification_data.evaluations as Array<
      Record<string, unknown>
    >;
    const payload: AcceptClassificationDto = {
      ...validPayload,
      classification_data: {
        ...validPayload.classification_data,
        evaluations: [
          {
            ...evaluations[0],
            limitations: [
              "System appears compliant based on external evidence.",
            ],
          },
        ],
      },
    };

    try {
      await handler.execute(
        new AcceptClassificationCommand(payload, "corr-prose-limit"),
      );
      throw new Error("expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      const response = (
        error as UnprocessableEntityException
      ).getResponse() as {
        problem: { code: string };
      };
      expect(response.problem.code).toBe(
        SCAN_ERROR_CODES.classificationSchemaInvalid,
      );
    }
  });

  it("rejects textual claim values", async () => {
    const payload: AcceptClassificationDto = {
      ...validPayload,
      classification_data: {
        ...validPayload.classification_data,
        claims: [
          {
            claim_id: "claim-1",
            engineering_rule_id: "eng-1",
            claim_type: "RULE_REQUIREMENT_MET",
            value: "yes",
            evidence_refs: ["graph:path:1"],
            graph_path_refs: [],
            source_anchor_refs: [],
            confidence: 0.9,
            limitations: [],
          },
        ],
      },
    };

    await expect(
      handler.execute(
        new AcceptClassificationCommand(payload, "corr-text-claim-value"),
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it("rejects invalid v2 callback shape", async () => {
    const payload = {
      ...validPayload,
      classification_data: { status: "COMPLETE" },
    } as AcceptClassificationDto;
    await expect(
      handler.execute(new AcceptClassificationCommand(payload, "corr-invalid")),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it("rejects duplicate assessment result for the same evidence report", async () => {
    mockFindResults.mockResolvedValue([
      {
        id: "existing",
        classificationData: {
          mode: ASSESSMENT_RESULT_MODES.engineeringRuleEvaluation,
          technical_evidence_report_id: "ter-123",
        },
      },
    ]);

    await expect(
      handler.execute(
        new AcceptClassificationCommand(validPayload, "corr-dup"),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("rejects callback when accepted TechnicalEvidenceReport does not exist", async () => {
    mockFindEvidence.mockResolvedValue(null);

    try {
      await handler.execute(
        new AcceptClassificationCommand(validPayload, "corr-missing"),
      );
      throw new Error("expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
      const response = (error as NotFoundException).getResponse() as {
        problem: { code: string };
      };
      expect(response.problem.code).toBe(
        SCAN_ERROR_CODES.evidenceReportNotFound,
      );
    }
  });

  it("records blocked guardrail as deny audit", async () => {
    const payload: AcceptClassificationDto = {
      ...validPayload,
      guardrail_status: CLASSIFICATION_GUARDRAIL_STATUSES.blocked,
    };
    await handler.execute(
      new AcceptClassificationCommand(payload, "corr-blocked"),
    );

    expect(mockWriteAuditInTx).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: SCAN_EVENT_TYPES.classificationBlockedAudit,
        decision: AUDIT_DECISIONS.deny,
      }),
      prisma,
    );
  });
});
