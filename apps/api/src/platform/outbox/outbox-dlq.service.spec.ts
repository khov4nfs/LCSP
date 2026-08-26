import {
  OUTBOX_AGGREGATE_TYPES,
  OUTBOX_AUDIT_EVENT_TYPES,
  OUTBOX_ERROR_CODES,
  OUTBOX_STATUSES,
} from "@lcsp/contracts/outbox";
import { REPOSITORY_SCAN_JOB_STATUSES } from "@lcsp/contracts/github-integration";
import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import { TECHNICAL_EVIDENCE_REPORT_STATUSES } from "@lcsp/contracts/scan";
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
  let findMessageById: jest.MockedFunction<OutboxRepository["findMessageById"]>;
  let resetMessageForReplay: jest.MockedFunction<
    OutboxRepository["resetMessageForReplay"]
  >;
  let deleteMessage: jest.MockedFunction<OutboxRepository["deleteMessage"]>;
  let writeAudit: jest.MockedFunction<AuditWriterService["write"]>;
  let repositoryScanJobFindUnique: ReturnType<
    typeof jest.fn<() => Promise<Record<string, unknown> | null>>
  >;
  let technicalEvidenceReportFindUnique: ReturnType<
    typeof jest.fn<() => Promise<Record<string, unknown> | null>>
  >;
  let technicalProfileFindUnique: ReturnType<
    typeof jest.fn<() => Promise<Record<string, unknown> | null>>
  >;

  beforeEach(async () => {
    findDlqMessages = jest.fn<OutboxRepository["findDlqMessages"]>();
    findMessageById = jest.fn<OutboxRepository["findMessageById"]>();
    resetMessageForReplay =
      jest.fn<OutboxRepository["resetMessageForReplay"]>();
    deleteMessage = jest.fn<OutboxRepository["deleteMessage"]>();
    writeAudit = jest.fn<AuditWriterService["write"]>();
    repositoryScanJobFindUnique =
      jest.fn<() => Promise<Record<string, unknown> | null>>();
    technicalEvidenceReportFindUnique =
      jest.fn<() => Promise<Record<string, unknown> | null>>();
    technicalProfileFindUnique =
      jest.fn<() => Promise<Record<string, unknown> | null>>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OutboxDlqService,
        {
          provide: OutboxRepository,
          useValue: {
            findDlqMessages,
            findMessageById,
            resetMessageForReplay,
            deleteMessage,
          },
        },
        {
          provide: AuditWriterService,
          useValue: { write: writeAudit, writeInTx: jest.fn() },
        },
        {
          provide: PrismaService,
          useValue: {
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
    findMessageById.mockResolvedValue({
      id: "1",
      aggregateType: OUTBOX_AGGREGATE_TYPES.assessment,
      status: OUTBOX_STATUSES.dlq,
      eventType: "TEST",
      aggregateId: "123",
    } as OutboxMessageEntity);

    await service.replayMessage("1", "actor-1", "corr-1");

    expect(resetMessageForReplay).toHaveBeenCalledWith("1");
    expect(writeAudit).toHaveBeenCalledWith(
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
    );
  });

  it("rejects replay when the message is not in the DLQ", async () => {
    findMessageById.mockResolvedValue({
      id: "1",
      aggregateType: OUTBOX_AGGREGATE_TYPES.assessment,
      status: OUTBOX_STATUSES.failed,
    } as OutboxMessageEntity);

    await expect(
      service.replayMessage("1", "actor-1", "corr-1"),
    ).rejects.toThrow(NotFoundException);
    expect(resetMessageForReplay).not.toHaveBeenCalled();
  });

  it("rejects replay when the message does not exist", async () => {
    findMessageById.mockResolvedValue(null);

    await expect(
      service.replayMessage("1", "actor-1", "corr-1"),
    ).rejects.toThrow(NotFoundException);
  });

  it("rejects replay for a terminal repository scan job", async () => {
    findMessageById.mockResolvedValue({
      id: "1",
      aggregateType: OUTBOX_AGGREGATE_TYPES.repositoryScanJob,
      status: OUTBOX_STATUSES.dlq,
      eventType: "command.scan.requested.v1",
      aggregateId: "scan-job-1",
    } as OutboxMessageEntity);
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
    expect(resetMessageForReplay).not.toHaveBeenCalled();
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: OUTBOX_AUDIT_EVENT_TYPES.dlqReplayDenied,
        decision: AUDIT_DECISIONS.deny,
        correlationId: "corr-1",
      }),
    );
  });

  it("rejects replay for an accepted technical evidence artifact", async () => {
    findMessageById.mockResolvedValue({
      id: "1",
      aggregateType: OUTBOX_AGGREGATE_TYPES.technicalEvidenceReport,
      status: OUTBOX_STATUSES.dlq,
      eventType: "event.scan.evidence.accepted.v1",
      aggregateId: "report-1",
    } as OutboxMessageEntity);
    technicalEvidenceReportFindUnique.mockResolvedValue({
      status: TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted,
    });

    await expect(
      service.replayMessage("1", "actor-1", "corr-1"),
    ).rejects.toMatchObject({
      response: {
        problem: { code: OUTBOX_ERROR_CODES.dlqReplayUnsafeTarget },
      },
    });
  });

  it("deletes a valid DLQ message and writes audit", async () => {
    findMessageById.mockResolvedValue({
      id: "1",
      aggregateType: OUTBOX_AGGREGATE_TYPES.assessment,
      status: OUTBOX_STATUSES.dlq,
      eventType: "TEST",
      aggregateId: "123",
    } as OutboxMessageEntity);

    await service.deleteMessage("1", "actor-1", "corr-2");

    expect(deleteMessage).toHaveBeenCalledWith("1");
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: OUTBOX_AUDIT_EVENT_TYPES.dlqDiscarded,
        actorId: "actor-1",
        decision: AUDIT_DECISIONS.allow,
        correlationId: "corr-2",
      }),
    );
  });

  it("rejects deletion when the message is not in the DLQ", async () => {
    findMessageById.mockResolvedValue({
      id: "1",
      aggregateType: OUTBOX_AGGREGATE_TYPES.assessment,
      status: OUTBOX_STATUSES.published,
    } as OutboxMessageEntity);

    await expect(
      service.deleteMessage("1", "actor-1", "corr-2"),
    ).rejects.toThrow(NotFoundException);
    expect(deleteMessage).not.toHaveBeenCalled();
  });
});
