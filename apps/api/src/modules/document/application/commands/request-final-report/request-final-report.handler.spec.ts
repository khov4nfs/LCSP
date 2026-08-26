import { describe, expect, it, jest } from "@jest/globals";
import {
  DOCUMENT_ERROR_CODES,
  DOCUMENT_EVENT_TYPES,
  DOCUMENT_REQUEST_STATUSES,
  DOCUMENT_TYPES,
} from "@lcsp/contracts/document";
import { CLASSIFICATION_GUARDRAIL_STATUSES } from "@lcsp/contracts/scan";
import { ConflictException, NotFoundException } from "@nestjs/common";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import type { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import { RequestFinalReportCommand } from "./request-final-report.command.js";
import { RequestFinalReportHandler } from "./request-final-report.handler.js";

type AssessmentRecord = { id: string };
type ClassificationResultRecord = { id: string; guardrailStatus: string };
type CreateDocumentRequestFn = () => Promise<{ id: string }>;
type AdvisoryLockFn = () => Promise<number>;

function buildHandler(options?: {
  assessment?: AssessmentRecord | null;
  evidence?: ClassificationResultRecord | null;
  existing?: { id: string } | null;
}) {
  const assessment: AssessmentRecord | null =
    options?.assessment === undefined ? { id: "asmt-1" } : options.assessment;
  const evidence: ClassificationResultRecord | null =
    options?.evidence === undefined
      ? {
          id: "classification-1",
          guardrailStatus: CLASSIFICATION_GUARDRAIL_STATUSES.passed,
        }
      : options.evidence;
  const existing: { id: string } | null =
    options?.existing === undefined ? null : options.existing;

  const findAssessment = jest.fn(() => assessment);
  const findEvidence = jest.fn(() => evidence);
  const findExisting = jest.fn(() => existing);
  const createDocumentRequest = jest
    .fn<CreateDocumentRequestFn>()
    .mockResolvedValue({ id: "document-request-1" });
  const advisoryLock = jest.fn<AdvisoryLockFn>().mockResolvedValue(1);

  const tx = {
    $executeRaw: advisoryLock,
    documentRequest: {
      findFirst: findExisting,
      create: createDocumentRequest,
    },
  };

  const transaction = jest.fn((cb: (arg: typeof tx) => Promise<string>) =>
    cb(tx),
  );

  const prisma = {
    $transaction: transaction,
    assessment: { findUnique: findAssessment },
    classificationResult: { findFirst: findEvidence },
  } as unknown as PrismaService;

  const enqueue = jest
    .fn<OutboxRepository["enqueue"]>()
    .mockResolvedValue("outbox-message-1");
  const outbox = { enqueue } as unknown as OutboxRepository;

  const write = jest
    .fn<AuditWriterService["write"]>()
    .mockResolvedValue(undefined);
  const audit = { write } as unknown as AuditWriterService;

  const handler = new RequestFinalReportHandler(prisma, outbox, audit);
  const command = new RequestFinalReportCommand("asmt-1", "user-1", "corr-1");

  return {
    handler,
    command,
    findAssessment,
    findEvidence,
    findExisting,
    advisoryLock,
    transaction,
    enqueue,
    write,
    createDocumentRequest,
  };
}

describe("RequestFinalReportHandler", () => {
  it("returns QUEUED response when guardrail is passed", async () => {
    const { handler, command, enqueue, transaction } = buildHandler();

    const result = await handler.execute(command);

    expect(result.status).toBe(DOCUMENT_REQUEST_STATUSES.queued);
    expect(result.document_type).toBe(DOCUMENT_TYPES.finalReport);
    expect(result.correlationId).toBe("corr-1");
    expect(result.document_request_id).toBeTruthy();
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("throws ASSESSMENT_NOT_FOUND when assessment does not exist", async () => {
    const { handler, command } = buildHandler({ assessment: null });

    try {
      await handler.execute(command);
      throw new Error("Expected NotFoundException");
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toMatchObject({
        ok: false,
        problem: {
          code: DOCUMENT_ERROR_CODES.assessmentNotFound,
          correlationId: "corr-1",
        },
      });
    }
  });

  it("throws CLASSIFICATION_GUARDRAIL_NOT_PASSED when guardrail is degraded", async () => {
    const { handler, command } = buildHandler({
      evidence: {
        id: "classification-1",
        guardrailStatus: CLASSIFICATION_GUARDRAIL_STATUSES.degraded,
      },
    });

    try {
      await handler.execute(command);
      throw new Error("Expected ConflictException");
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        ok: false,
        problem: {
          code: DOCUMENT_ERROR_CODES.classificationGuardrailNotPassed,
          correlationId: "corr-1",
        },
      });
    }
  });

  it("throws CLASSIFICATION_GUARDRAIL_NOT_PASSED when guardrail is blocked", async () => {
    const { handler, command } = buildHandler({
      evidence: {
        id: "classification-1",
        guardrailStatus: CLASSIFICATION_GUARDRAIL_STATUSES.blocked,
      },
    });

    await expect(handler.execute(command)).rejects.toThrow(ConflictException);
  });

  it("throws DOCUMENT_ALREADY_QUEUED when an active request exists", async () => {
    const { handler, command } = buildHandler({ existing: { id: "outbox-1" } });

    try {
      await handler.execute(command);
      throw new Error("Expected ConflictException");
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        ok: false,
        problem: {
          code: DOCUMENT_ERROR_CODES.alreadyQueued,
          correlationId: "corr-1",
        },
      });
    }
  });

  it("enqueues final report outbox event and writes audit", async () => {
    const {
      handler,
      command,
      enqueue,
      write,
      createDocumentRequest,
      advisoryLock,
    } = buildHandler();

    await handler.execute(command);

    expect(advisoryLock).toHaveBeenCalledTimes(1);
    expect(createDocumentRequest).toHaveBeenCalledTimes(1);

    expect(enqueue).toHaveBeenCalledTimes(1);
    const outbox = enqueue.mock.calls[0][0];
    expect(outbox.eventType).toBe(DOCUMENT_EVENT_TYPES.finalReportRequested);
    expect(outbox.aggregateId).toBe("document-request-1");
    expect(outbox.payload).toEqual(
      expect.objectContaining({
        assessmentId: "asmt-1",
        classificationResultId: "classification-1",
        correlationId: "corr-1",
      }),
    );

    expect(write).toHaveBeenCalled();
    const firstEvent = write.mock.calls[0][0];
    expect(firstEvent.eventType).toBe(
      DOCUMENT_EVENT_TYPES.finalReportRequestedAudit,
    );
  });
});
