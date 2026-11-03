import { readFileSync } from "node:fs";
const eventPolicy = JSON.parse(
  readFileSync(
    new URL(
      "../../../../../tests/fixtures/outbox-event-policy.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { retired: string[]; retained: string[] };
import {
  OUTBOX_AGGREGATE_TYPES,
  OUTBOX_AUDIT_EVENT_TYPES,
  OUTBOX_ERROR_CODES,
  OUTBOX_STATUSES,
} from "@lcsp/contracts/outbox";
import { REPOSITORY_SCAN_JOB_STATUSES } from "@lcsp/contracts/github-integration";
import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import { jest } from "@jest/globals";
import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";

import { OutboxDlqService } from "./outbox-dlq.service.js";
import { OutboxRepository } from "./outbox.repository.js";
import { AuditWriterService } from "../audit/audit-writer.service.js";
import { OutboxMessageEntity } from "./outbox-message.entity.js";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";

describe("OutboxDlqService", () => {
  let service: OutboxDlqService;
  let findDlqMessages: jest.MockedFunction<OutboxRepository["findDlqMessages"]>;
  let writeAudit: jest.MockedFunction<AuditWriterService["write"]>;
  let writeAuditInTx: jest.MockedFunction<AuditWriterService["writeInTx"]>;
  let repositoryScanJobFindUnique: ReturnType<
    typeof jest.fn<() => Promise<Record<string, unknown> | null>>
  >;
  let technicalEvidenceReportFindUnique: ReturnType<
    typeof jest.fn<() => Promise<Record<string, unknown> | null>>
  >;
  let technicalProfileFindUnique: ReturnType<
    typeof jest.fn<() => Promise<Record<string, unknown> | null>>
  >;
  let currentMessageRow: Record<string, unknown> | null = null;
  let txMock: Record<string, unknown>;

  beforeEach(async () => {
    findDlqMessages = jest.fn<OutboxRepository["findDlqMessages"]>();
    writeAudit = jest.fn<AuditWriterService["write"]>();
    writeAuditInTx = jest.fn<AuditWriterService["writeInTx"]>();
    repositoryScanJobFindUnique =
      jest.fn<() => Promise<Record<string, unknown> | null>>();
    technicalEvidenceReportFindUnique =
      jest.fn<() => Promise<Record<string, unknown> | null>>();
    technicalProfileFindUnique =
      jest.fn<() => Promise<Record<string, unknown> | null>>();

    currentMessageRow = null;
    txMock = {
      $executeRaw: jest.fn<() => Promise<number>>().mockResolvedValue(1),
      $queryRaw: jest
        .fn<(strings: TemplateStringsArray) => Promise<any>>()
        .mockImplementation((strings: TemplateStringsArray) => {
          const text = Array.isArray(strings)
            ? strings.join("")
            : String(strings);
          if (text.includes('"AssessmentRootCapacity"')) {
            return Promise.resolve([{ id: "singleton" }]);
          }
          if (text.includes('"OutboxMessage"')) {
            return Promise.resolve(
              currentMessageRow ? [currentMessageRow] : [],
            );
          }
          return Promise.resolve([]);
        }),
      assessmentRootAdmissionRequest: {
        findUnique: jest.fn<() => Promise<any>>().mockResolvedValue({
          commandId: "1",
          assessmentId: "123",
        }),
      },
      assessment: {
        findUnique: jest.fn<() => Promise<any>>().mockResolvedValue({
          lifecycleState: "ACTIVE",
          runtime: {
            executionState: "FAILED",
            leaseToken: null,
          },
        }),
      },
      assessmentRootExecutionSlot: {
        count: jest.fn<() => Promise<number>>().mockResolvedValue(0),
      },
      repositoryScanJob: { findUnique: repositoryScanJobFindUnique },
      technicalEvidenceReport: {
        findUnique: technicalEvidenceReportFindUnique,
      },
      technicalProfile: { findUnique: technicalProfileFindUnique },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OutboxDlqService,
        {
          provide: OutboxRepository,
          useValue: {
            findDlqMessages,
          },
        },
        {
          provide: AuditWriterService,
          useValue: { write: writeAudit, writeInTx: writeAuditInTx },
        },
        {
          provide: PrismaService,
          useValue: {
            $transaction: jest.fn(
              (callback: (tx: typeof txMock) => Promise<unknown>) =>
                callback(txMock),
            ),
            repositoryScanJob: { findUnique: repositoryScanJobFindUnique },
            technicalEvidenceReport: {
              findUnique: technicalEvidenceReportFindUnique,
            },
            technicalProfile: { findUnique: technicalProfileFindUnique },
          },
        },
      ],
    }).compile();

    service = module.get<OutboxDlqService>(OutboxDlqService);
  });

  it("returns DLQ messages and count", async () => {
    const mockMessages = [{ id: "1" } as OutboxMessageEntity];
    findDlqMessages.mockResolvedValue(mockMessages);

    await expect(service.getDlqMessages()).resolves.toEqual({
      messages: mockMessages,
      count: 1,
    });
  });

  it("replays a valid DLQ message and writes audit", async () => {
    currentMessageRow = {
      id: "1",
      aggregateType: OUTBOX_AGGREGATE_TYPES.assessment,
      status: OUTBOX_STATUSES.dlq,
      eventType: "TEST",
      aggregateId: "123",
      errorMessage: null,
    };

    await service.replayMessage("1", "actor-1", "corr-1");

    expect(writeAuditInTx).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: OUTBOX_AUDIT_EVENT_TYPES.dlqReplayed,
        actorId: "actor-1",
        decision: AUDIT_DECISIONS.allow,
        correlationId: "corr-1",
        payload: {
          originalEventType: "TEST",
          aggregateId: "123",
        },
      }),
      txMock,
    );
  });

  it("rejects replay when the message is not in the DLQ", async () => {
    currentMessageRow = {
      id: "1",
      aggregateType: OUTBOX_AGGREGATE_TYPES.assessment,
      status: OUTBOX_STATUSES.failed,
      eventType: "TEST",
      aggregateId: "123",
      errorMessage: null,
    };

    await expect(
      service.replayMessage("1", "actor-1", "corr-1"),
    ).rejects.toThrow(NotFoundException);
    expect(writeAuditInTx).not.toHaveBeenCalled();
  });

  it("rejects replay when the message does not exist", async () => {
    currentMessageRow = null;

    await expect(
      service.replayMessage("1", "actor-1", "corr-1"),
    ).rejects.toThrow(NotFoundException);
    expect(writeAuditInTx).not.toHaveBeenCalled();
  });

  it.each(eventPolicy.retired)(
    "never replays the retired V1 event %s",
    async (eventType) => {
      currentMessageRow = {
        id: "1",
        aggregateType: OUTBOX_AGGREGATE_TYPES.assessment,
        status: OUTBOX_STATUSES.dlq,
        eventType,
        aggregateId: "123",
        errorMessage: null,
      };

      await expect(
        service.replayMessage("1", "actor-1", "corr-1"),
      ).rejects.toMatchObject({
        response: {
          problem: { code: OUTBOX_ERROR_CODES.dlqReplayUnsafeTarget },
        },
      });
      expect(writeAuditInTx).not.toHaveBeenCalled();
      expect(writeAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: OUTBOX_AUDIT_EVENT_TYPES.dlqReplayDenied,
          decision: AUDIT_DECISIONS.deny,
        }),
      );
    },
  );

  it("rejects replay for a terminal repository scan job", async () => {
    currentMessageRow = {
      id: "1",
      aggregateType: OUTBOX_AGGREGATE_TYPES.repositoryScanJob,
      status: OUTBOX_STATUSES.dlq,
      eventType: "TEST",
      aggregateId: "scan-job-1",
      errorMessage: null,
    };
    repositoryScanJobFindUnique.mockResolvedValue({
      status: REPOSITORY_SCAN_JOB_STATUSES.completed,
    });

    await expect(
      service.replayMessage("1", "actor-1", "corr-1"),
    ).rejects.toMatchObject({
      response: {
        problem: { code: OUTBOX_ERROR_CODES.dlqReplayUnsafeTarget },
      },
    });
    expect(writeAuditInTx).not.toHaveBeenCalled();
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: OUTBOX_AUDIT_EVENT_TYPES.dlqReplayDenied,
        decision: AUDIT_DECISIONS.deny,
        correlationId: "corr-1",
      }),
    );
  });

  it("deletes a valid DLQ message and writes audit", async () => {
    currentMessageRow = {
      id: "1",
      aggregateType: OUTBOX_AGGREGATE_TYPES.assessment,
      status: OUTBOX_STATUSES.dlq,
      eventType: "TEST",
      aggregateId: "123",
    };

    await service.deleteMessage("1", "actor-1", "corr-2");

    expect(writeAuditInTx).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: OUTBOX_AUDIT_EVENT_TYPES.dlqDiscarded,
        actorId: "actor-1",
        decision: AUDIT_DECISIONS.allow,
        correlationId: "corr-2",
        payload: {
          originalEventType: "TEST",
          aggregateId: "123",
        },
      }),
      txMock,
    );
  });

  it("rejects deletion when the message is not in the DLQ", async () => {
    currentMessageRow = {
      id: "1",
      aggregateType: OUTBOX_AGGREGATE_TYPES.assessment,
      status: OUTBOX_STATUSES.published,
      eventType: "TEST",
      aggregateId: "123",
    };

    await expect(
      service.deleteMessage("1", "actor-1", "corr-2"),
    ).rejects.toThrow(NotFoundException);
    expect(writeAuditInTx).not.toHaveBeenCalled();
  });
});
