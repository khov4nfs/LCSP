import { describe, expect, it, jest } from "@jest/globals";
import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import { OUTBOX_AGGREGATE_TYPES } from "@lcsp/contracts/outbox";
import {
  CLASSIFICATION_GUARDRAIL_STATUSES,
  CLASSIFICATION_RESULT_STATUSES,
  LEGAL_RULE_MATCH_GUARDRAIL_STATUSES,
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

type LegalRuleMatchRecord = {
  id: string;
  assessmentId: string;
  guardrailStatus: string;
};

type VerifiedProfileRecord = {
  id: string;
  assessmentId: string;
  organizationId: string;
};

describe("AcceptClassificationHandler", () => {
  let handler: AcceptClassificationHandler;
  let prisma: jest.Mocked<PrismaService>;
  let overclaimGuardrail: OverclaimGuardrailService;
  let mockFindFirstLegalRuleMatch: jest.Mock<
    (args: unknown) => Promise<LegalRuleMatchRecord | null>
  >;
  let mockFindFirstVerifiedProfile: jest.Mock<
    (args: unknown) => Promise<VerifiedProfileRecord | null>
  >;
  let mockFindUniqueClassificationResult: jest.Mock<
    (args: unknown) => Promise<{ id: string } | null>
  >;
  let mockCreateClassificationResult: jest.Mock<
    (args: { data: unknown }) => Promise<unknown>
  >;
  let mockEnqueueOutbox: jest.Mock<
    (event: unknown, tx: unknown) => Promise<void>
  >;
  let mockWriteAuditInTx: jest.Mock<
    (event: unknown, tx: unknown) => Promise<void>
  >;
  let mockRecordToolCompleted: jest.Mock<(event: unknown) => Promise<void>>;
  let mockRecordRunCompleted: jest.Mock<(event: unknown) => Promise<void>>;

  const validPayload: AcceptClassificationDto = {
    legal_rule_match_id: "lrm-123",
    verified_profile_id: "vp-123",
    assessment_id: "asm-123",
    schema_version: "1.0.0",
    classification_data: {
      system_type: "HIGH_IMPACT_AI",
      risk_level: "HIGH",
      citation_basis: ["chunk-1"],
    },
    guardrail_status: CLASSIFICATION_GUARDRAIL_STATUSES.passed,
  };

  beforeEach(() => {
    mockFindFirstLegalRuleMatch = jest
      .fn<(args: unknown) => Promise<LegalRuleMatchRecord | null>>()
      .mockResolvedValue({
        id: "lrm-123",
        assessmentId: "asm-123",
        guardrailStatus: "passed",
      });

    mockFindFirstVerifiedProfile = jest
      .fn<(args: unknown) => Promise<VerifiedProfileRecord | null>>()
      .mockResolvedValue({
        id: "vp-123",
        assessmentId: "asm-123",
        organizationId: "org-123",
      });

    mockFindUniqueClassificationResult = jest
      .fn<(args: unknown) => Promise<{ id: string } | null>>()
      .mockResolvedValue(null);

    mockCreateClassificationResult = jest
      .fn<(args: { data: unknown }) => Promise<unknown>>()
      .mockImplementation(({ data }: { data: unknown }) =>
        Promise.resolve(data),
      );

    mockEnqueueOutbox = jest
      .fn<(event: unknown, tx: unknown) => Promise<void>>()
      .mockResolvedValue(undefined);

    mockWriteAuditInTx = jest
      .fn<(event: unknown, tx: unknown) => Promise<void>>()
      .mockResolvedValue(undefined);
    mockRecordToolCompleted = jest
      .fn<(event: unknown) => Promise<void>>()
      .mockResolvedValue(undefined);
    mockRecordRunCompleted = jest
      .fn<(event: unknown) => Promise<void>>()
      .mockResolvedValue(undefined);

    prisma = {
      legalRuleMatch: {
        findFirst: mockFindFirstLegalRuleMatch,
      },
      verifiedProfile: {
        findFirst: mockFindFirstVerifiedProfile,
      },
      classificationResult: {
        findUnique: mockFindUniqueClassificationResult,
        create: mockCreateClassificationResult,
      },
      $transaction: jest
        .fn()
        .mockImplementation(
          async (callback: (tx: unknown) => Promise<unknown>) =>
            callback(prisma),
        ),
    } as unknown as jest.Mocked<PrismaService>;

    const auditWriter = {
      writeInTx: mockWriteAuditInTx,
    } as unknown as jest.Mocked<AuditWriterService>;

    const outboxRepository = {
      enqueue: mockEnqueueOutbox,
    } as unknown as jest.Mocked<OutboxRepository>;
    const runtimeEvents = {
      recordToolCompleted: mockRecordToolCompleted,
      recordRunCompleted: mockRecordRunCompleted,
    } as unknown as jest.Mocked<AssessmentRuntimeEventService>;

    overclaimGuardrail = new OverclaimGuardrailService();

    handler = new AcceptClassificationHandler(
      prisma,
      auditWriter,
      outboxRepository,
      overclaimGuardrail,
      runtimeEvents,
    );
  });

  it("T01: accepts valid classification result with passed status", async () => {
    const command = new AcceptClassificationCommand(validPayload, "corr-123");
    const result = await handler.execute(command);

    expect(result.accepted).toBe(true);
    expect(result.guardrail_status).toBe(
      CLASSIFICATION_GUARDRAIL_STATUSES.passed,
    );
    expect(result.correlationId).toBe("corr-123");

    expect(mockCreateClassificationResult).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          legalRuleMatchId: "lrm-123",
          verifiedProfileId: "vp-123",
          assessmentId: "asm-123",
          organizationId: "org-123",
          schemaVersion: "1.0.0",
          classificationData: expect.objectContaining({
            system_type: "HIGH_IMPACT_AI",
            risk_level: "HIGH",
          }),
          guardrailStatus: CLASSIFICATION_GUARDRAIL_STATUSES.passed,
          blockedReason: null,
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
        stage: "CLASSIFICATION",
        toolName: "classification_result",
      }),
    );
    expect(mockRecordRunCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        assessmentId: "asm-123",
        stage: "CLASSIFICATION",
      }),
    );
  });

  it("T02: accepts degraded guardrail_status", async () => {
    const degradedPayload: AcceptClassificationDto = {
      ...validPayload,
      guardrail_status: CLASSIFICATION_GUARDRAIL_STATUSES.degraded,
    };
    const command = new AcceptClassificationCommand(
      degradedPayload,
      "corr-degraded",
    );
    const result = await handler.execute(command);

    expect(result.accepted).toBe(true);
    expect(result.guardrail_status).toBe(
      CLASSIFICATION_GUARDRAIL_STATUSES.degraded,
    );
  });

  it("T03: accepts blocked guardrail_status with blocked audit decision", async () => {
    const blockedPayload: AcceptClassificationDto = {
      ...validPayload,
      guardrail_status: CLASSIFICATION_GUARDRAIL_STATUSES.blocked,
    };
    const command = new AcceptClassificationCommand(
      blockedPayload,
      "corr-blocked",
    );
    const result = await handler.execute(command);

    expect(result.accepted).toBe(true);
    expect(result.guardrail_status).toBe(
      CLASSIFICATION_GUARDRAIL_STATUSES.blocked,
    );

    expect(mockWriteAuditInTx).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: SCAN_EVENT_TYPES.classificationBlockedAudit,
        decision: AUDIT_DECISIONS.deny,
      }),
      prisma,
    );
  });

  it("T04: rejects overclaim wording with CLASSIFICATION_OVERCLAIM", async () => {
    const overclaimPayload: AcceptClassificationDto = {
      ...validPayload,
      classification_data: {
        system_type: "HIGH_IMPACT_AI",
        notes: "This AI solution is certified by regulatory body",
      },
    };
    const command = new AcceptClassificationCommand(
      overclaimPayload,
      "corr-overclaim",
    );

    try {
      await handler.execute(command);
      expect(true).toBe(false);
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(UnprocessableEntityException);
      const res = (err as UnprocessableEntityException).getResponse() as {
        problem: { code: string };
      };
      expect(res.problem.code).toBe(SCAN_ERROR_CODES.classificationOverclaim);
    }
  });

  it("T05: rejects when LegalRuleMatch has guardrailStatus = blocked", async () => {
    mockFindFirstLegalRuleMatch.mockResolvedValue({
      id: "lrm-123",
      assessmentId: "asm-123",
      guardrailStatus: LEGAL_RULE_MATCH_GUARDRAIL_STATUSES.blocked,
    });

    const command = new AcceptClassificationCommand(
      validPayload,
      "corr-blocked-match",
    );

    try {
      await handler.execute(command);
      expect(true).toBe(false);
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(UnprocessableEntityException);
    }
  });

  it("T06: throws ConflictException when result already exists", async () => {
    mockFindUniqueClassificationResult.mockResolvedValue({
      id: "existing-res-1",
    });

    const command = new AcceptClassificationCommand(
      validPayload,
      "corr-exists",
    );

    try {
      await handler.execute(command);
      expect(true).toBe(false);
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ConflictException);
      const res = (err as ConflictException).getResponse() as {
        problem: { code: string };
      };
      expect(res.problem.code).toBe(SCAN_ERROR_CODES.resultAlreadyExists);
    }
  });

  it("T08: throws NotFoundException when LegalRuleMatch is missing", async () => {
    mockFindFirstLegalRuleMatch.mockResolvedValue(null);

    const command = new AcceptClassificationCommand(
      validPayload,
      "corr-missing-lrm",
    );

    try {
      await handler.execute(command);
      expect(true).toBe(false);
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(NotFoundException);
      const res = (err as NotFoundException).getResponse() as {
        problem: { code: string };
      };
      expect(res.problem.code).toBe(SCAN_ERROR_CODES.legalRuleMatchNotFound);
    }
  });

  it("throws NotFoundException when VerifiedProfile is missing", async () => {
    mockFindFirstVerifiedProfile.mockResolvedValue(null);

    const command = new AcceptClassificationCommand(
      validPayload,
      "corr-missing-vp",
    );

    try {
      await handler.execute(command);
      expect(true).toBe(false);
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(NotFoundException);
      const res = (err as NotFoundException).getResponse() as {
        problem: { code: string };
      };
      expect(res.problem.code).toBe(SCAN_ERROR_CODES.verifiedProfileNotFound);
    }
  });
});
