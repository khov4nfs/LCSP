import { describe, expect, it, jest } from "@jest/globals";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  CLASSIFICATION_RERUN_STATUSES,
  SCAN_EVENT_TYPES,
} from "@lcsp/contracts/scan";
import { NotFoundException } from "@nestjs/common";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import type { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import { RerunClassificationCommand } from "./rerun-classification.command.js";
import { RerunClassificationHandler } from "./rerun-classification.handler.js";

type EvidenceReportFixture = {
  id: string;
  snapshotId: string;
  scanJobId: string;
} | null;

describe("RerunClassificationHandler", () => {
  const rbacContext = {
    userId: "user-1",
    sessionId: "session-1",
    role: AUTH_USER_ROLES.customer,
    scope: "assessment-1",
  };

  function createHandler(options?: { evidenceReport?: EvidenceReportFixture }) {
    const evidenceReport: EvidenceReportFixture =
      options?.evidenceReport === undefined
        ? {
            id: "ter-1",
            snapshotId: "snapshot-1",
            scanJobId: "scan-1",
          }
        : options.evidenceReport;
    const findEvidence = jest
      .fn<(args: unknown) => Promise<EvidenceReportFixture>>()
      .mockResolvedValue(evidenceReport);
    const prisma = {
      technicalEvidenceReport: {
        findFirst: findEvidence,
      },
      $transaction: jest.fn((callback: (tx: unknown) => Promise<unknown>) =>
        callback(prisma),
      ),
    } as unknown as jest.Mocked<PrismaService>;
    const enqueue = jest
      .fn<(...args: unknown[]) => Promise<void>>()
      .mockResolvedValue(undefined);
    const outbox = { enqueue } as unknown as jest.Mocked<OutboxRepository>;
    const writeInTx = jest
      .fn<(...args: unknown[]) => Promise<void>>()
      .mockResolvedValue(undefined);
    const auditWriter = {
      writeInTx,
    } as unknown as jest.Mocked<AuditWriterService>;

    return {
      handler: new RerunClassificationHandler(prisma, outbox, auditWriter),
      enqueue,
      writeInTx,
      findEvidence,
    };
  }

  it("replays the latest accepted TechnicalEvidenceReport without rescanning", async () => {
    const { handler, enqueue, writeInTx, findEvidence } = createHandler();

    const result = await handler.execute(
      new RerunClassificationCommand(
        "assessment-1",
        rbacContext,
        "correlation-1",
      ),
    );

    expect(result).toEqual({
      technical_evidence_report_id: "ter-1",
      status: CLASSIFICATION_RERUN_STATUSES.queued,
      correlationId: "correlation-1",
    });
    expect(findEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          assessmentId: "assessment-1",
        }),
        orderBy: { createdAt: "desc" },
      }),
    );
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        aggregateId: "ter-1",
        eventType: SCAN_EVENT_TYPES.evidenceAccepted,
        payload: expect.objectContaining({
          evidenceReportId: "ter-1",
          technicalEvidenceReportId: "ter-1",
          snapshotId: "snapshot-1",
          scanJobId: "scan-1",
          rerun: true,
        }),
      }),
      expect.anything(),
    );
    expect(writeInTx).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: SCAN_EVENT_TYPES.classificationRerunTriggeredAudit,
        resourceId: "ter-1",
      }),
      expect.anything(),
    );
  });

  it("rejects rerun when no accepted TechnicalEvidenceReport exists", async () => {
    const { handler } = createHandler({ evidenceReport: null });

    await expect(
      handler.execute(
        new RerunClassificationCommand(
          "assessment-1",
          rbacContext,
          "correlation-1",
        ),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it("allows a fresh rerun after prior assessment results because the pinned evidence is replayed", async () => {
    const { handler, enqueue } = createHandler();

    const first = await handler.execute(
      new RerunClassificationCommand(
        "assessment-1",
        rbacContext,
        "correlation-1",
      ),
    );
    const second = await handler.execute(
      new RerunClassificationCommand(
        "assessment-1",
        rbacContext,
        "correlation-2",
      ),
    );

    expect(first.technical_evidence_report_id).toBe("ter-1");
    expect(second.technical_evidence_report_id).toBe("ter-1");
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        eventType: SCAN_EVENT_TYPES.evidenceAccepted,
        idempotencyKey: expect.stringContaining("correlation-2"),
      }),
      expect.anything(),
    );
  });
});
