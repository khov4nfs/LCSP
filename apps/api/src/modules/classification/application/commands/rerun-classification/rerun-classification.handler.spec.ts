import { describe, expect, it, jest } from "@jest/globals";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { AUDIT_ACTOR_TYPES } from "@lcsp/contracts/audit";
import {
  CLASSIFICATION_RERUN_STATUSES,
  SCAN_EVENT_TYPES,
} from "@lcsp/contracts/scan";
import { ASSESSMENT_PIPELINE_LIVENESS_WINDOW_SECONDS } from "@lcsp/contracts/evidence";
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

  function createHandler(options?: {
    evidenceReport?: EvidenceReportFixture;
    pending?: boolean;
  }) {
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
    const dispatches: Array<{ publishedAt: number; payload: unknown }> = [];
    const prisma = {
      technicalEvidenceReport: {
        findFirst: findEvidence,
      },
      $executeRaw: jest.fn<() => Promise<number>>().mockResolvedValue(1),
      outboxMessage: {
        findFirst: jest.fn<() => Promise<unknown>>().mockImplementation(() => {
          const last = dispatches.at(-1);
          return Promise.resolve(
            last &&
              (options?.pending ||
                Date.now() - last.publishedAt <
                  ASSESSMENT_PIPELINE_LIVENESS_WINDOW_SECONDS * 1000)
              ? { payload: last.payload }
              : null,
          );
        }),
      },
      $transaction: jest.fn((callback: (tx: unknown) => Promise<unknown>) =>
        callback(prisma),
      ),
    } as unknown as jest.Mocked<PrismaService>;
    const enqueue = jest
      .fn<(...args: unknown[]) => Promise<void>>()
      .mockImplementation((input) => {
        dispatches.push({
          publishedAt: Date.now(),
          payload: (input as { payload: unknown }).payload,
        });
        return Promise.resolve();
      });
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

  it("records an automatic rerun as a service action", async () => {
    const { handler, enqueue, writeInTx } = createHandler();
    await handler.execute(
      new RerunClassificationCommand(
        "assessment-1",
        { ...rbacContext, userId: "assessment-pipeline-reconciliation" },
        "reconciliation-1",
        undefined,
        AUDIT_ACTOR_TYPES.service,
      ),
    );
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: {
          id: "assessment-pipeline-reconciliation",
          type: AUDIT_ACTOR_TYPES.service,
        },
      }),
      expect.anything(),
    );
    expect(writeInTx).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: {
          id: "assessment-pipeline-reconciliation",
          type: AUDIT_ACTOR_TYPES.service,
        },
      }),
      expect.anything(),
    );
  });

  it("reuses a recent dispatch of the same pinned evidence", async () => {
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
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  // Regression: AssessmentPipelineContinuationService.continuePipeline only
  // rejects a duplicate dispatch once the worker has posted its first
  // runtime event; between "API decided to dispatch" and that event landing
  // (an outbox poll tick + RabbitMQ delivery + worker startup), a second
  // continuePipeline call for the SAME still-unchanged confirmed context
  // (an impatient repeat click, or the reconciliation service racing a
  // manual click) previously minted a fresh idempotencyKey every time — a
  // genuinely distinct Planner+Investigator+Gate dispatch, every time.
  it("does not mint a distinct dispatch for the same evidence report within the same short window", async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date("2026-09-27T00:00:00.000Z"));
      const { handler, enqueue } = createHandler();

      await handler.execute(
        new RerunClassificationCommand(
          "assessment-1",
          rbacContext,
          "correlation-1",
        ),
      );
      jest.setSystemTime(new Date("2026-09-27T00:00:05.000Z"));
      await handler.execute(
        new RerunClassificationCommand(
          "assessment-1",
          rbacContext,
          "correlation-2",
        ),
      );

      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(enqueue.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          payload: expect.objectContaining({ correlationId: "correlation-1" }),
        }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it("deduplicates clicks crossing a minute boundary by 200ms", async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date("2026-09-27T00:00:59.900Z"));
      const { handler, enqueue } = createHandler();
      await handler.execute(
        new RerunClassificationCommand("assessment-1", rbacContext, "first"),
      );
      jest.setSystemTime(new Date("2026-09-27T00:01:00.100Z"));
      const replay = await handler.execute(
        new RerunClassificationCommand("assessment-1", rbacContext, "second"),
      );
      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(replay.correlationId).toBe("first");
    } finally {
      jest.useRealTimers();
    }
  });

  it("reuses publication still pending beyond the recovery window", async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date("2026-09-27T00:00:00.000Z"));
      const { handler, enqueue } = createHandler({ pending: true });
      await handler.execute(
        new RerunClassificationCommand("assessment-1", rbacContext, "first"),
      );
      jest.advanceTimersByTime(
        (ASSESSMENT_PIPELINE_LIVENESS_WINDOW_SECONDS + 1) * 1000,
      );
      const replay = await handler.execute(
        new RerunClassificationCommand("assessment-1", rbacContext, "second"),
      );
      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(replay.correlationId).toBe("first");
    } finally {
      jest.useRealTimers();
    }
  });

  it("does mint a distinct dispatch once the dedup window has passed, so a real stalled-pipeline retry still fires", async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date("2026-09-27T00:00:00.000Z"));
      const { handler, enqueue } = createHandler();

      await handler.execute(
        new RerunClassificationCommand(
          "assessment-1",
          rbacContext,
          "correlation-1",
        ),
      );
      jest.setSystemTime(new Date("2026-09-27T00:01:30.001Z"));
      await handler.execute(
        new RerunClassificationCommand(
          "assessment-1",
          rbacContext,
          "correlation-2",
        ),
      );

      expect(enqueue).toHaveBeenCalledTimes(2);
      const firstKey = (enqueue.mock.calls[0][0] as { idempotencyKey: string })
        .idempotencyKey;
      const secondKey = (enqueue.mock.calls[1][0] as { idempotencyKey: string })
        .idempotencyKey;
      expect(secondKey).not.toBe(firstKey);
    } finally {
      jest.useRealTimers();
    }
  });
});
