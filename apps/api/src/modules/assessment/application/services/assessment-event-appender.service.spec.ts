import { expect, it, jest } from "@jest/globals";
import {
  AGENTIC_ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_EVENT_ACTOR_TYPES,
  ASSESSMENT_ACTIVITY_KINDS,
} from "@lcsp/contracts/assessment";
import type { Prisma } from "@prisma/client";
import type { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";
import type { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";
import { ROOT_AUDIT_ACTOR } from "../../infrastructure/persistence/assessment-case-support.service.js";
import { AssessmentEventAppender } from "./assessment-event-appender.service.js";

it("[RED][ASM-AUDIT-01] commits material event, canonical audit and outbox atomically while deduplicating replay", async () => {
  const enqueue = jest
    .fn<OutboxRepository["enqueue"]>()
    .mockResolvedValue("outbox");
  let stored: Record<string, unknown> | null = null;
  const create = jest.fn(({ data }: { data: Record<string, unknown> }) => {
    stored = data;
    return Promise.resolve(data);
  });
  const update = jest
    .fn<(...args: unknown[]) => Promise<object>>()
    .mockResolvedValue({});
  const tx = {
    assessmentEvent: { findUnique: () => Promise.resolve(stored), create },
    assessmentRuntime: { update },
    $queryRaw: () =>
      Promise.resolve([
        { threadId: "33333333-3333-4333-8333-333333333333", eventSequence: 10 },
      ]),
  } as unknown as Prisma.TransactionClient;
  const writeInTx = jest
    .fn<AuditWriterService["writeInTx"]>()
    .mockResolvedValue(undefined);
  const AppenderWithAudit = AssessmentEventAppender as unknown as new (
    outbox: OutboxRepository,
    auditWriter: AuditWriterService,
  ) => AssessmentEventAppender;
  const appender = new AppenderWithAudit(
    { enqueue } as unknown as OutboxRepository,
    { writeInTx } as unknown as AuditWriterService,
  );
  const tokenUsage = {
    invocationId: "successful-invocation",
    promptTokens: 5,
    completionTokens: 2,
    totalTokens: 7,
  };
  const input = {
    assessmentId: "22222222-2222-4222-8222-222222222222",
    eventId: "44444444-4444-4444-8444-444444444444",
    correlationId: "test",
    eventType: AGENTIC_ASSESSMENT_EVENT_TYPES.ACTIVITY_RECORDED,
    actorType: ASSESSMENT_EVENT_ACTOR_TYPES.ASSESSMENT_ROOT,
    payload: {
      kind: ASSESSMENT_ACTIVITY_KINDS.MODEL,
      labelKey: "assessment.activity.modelStepCompleted",
    },
    tokenUsage,
    auditActor: ROOT_AUDIT_ACTOR,
  };
  await appender.appendInTx(tx, input);
  await appender.appendInTx(tx, input);
  expect(create).toHaveBeenCalledTimes(1);
  expect(update).toHaveBeenCalledTimes(1);
  expect(create.mock.calls[0]?.[0].data.tokenUsage).toEqual(tokenUsage);
  expect(enqueue.mock.calls[0]?.[0].payload).toMatchObject({
    assessmentEvent: { tokenUsage, sequence: 11 },
  });

  // [RED][ASM-AUDIT-01] Material domain events and their canonical audit
  // evidence must share the same transaction so neither can commit alone.
  expect(writeInTx).toHaveBeenCalledTimes(1);
  expect(writeInTx.mock.calls[0]?.[0]).toEqual(
    expect.objectContaining({
      assessmentId: input.assessmentId,
      correlationId: input.correlationId,
      causationId: input.eventId,
    }),
  );
  // Avoid expanding Prisma's deeply recursive TransactionClient type inside
  // Jest's asymmetric matcher while still proving exact transaction identity.
  expect(writeInTx.mock.calls[0]?.[1] === tx).toBe(true);
});

it("propagates canonical audit failure so the caller transaction rolls back domain and outbox writes", async () => {
  const enqueue = jest
    .fn<OutboxRepository["enqueue"]>()
    .mockResolvedValue("outbox");
  const tx = {
    assessmentEvent: {
      findUnique: () => Promise.resolve(null),
      create: jest
        .fn<() => Promise<Record<string, never>>>()
        .mockResolvedValue({}),
    },
    assessmentRuntime: {
      update: jest
        .fn<() => Promise<Record<string, never>>>()
        .mockResolvedValue({}),
    },
    $queryRaw: () =>
      Promise.resolve([
        { threadId: "33333333-3333-4333-8333-333333333333", eventSequence: 4 },
      ]),
  } as unknown as Prisma.TransactionClient;
  const writeInTx = jest
    .fn<AuditWriterService["writeInTx"]>()
    .mockRejectedValue(new Error("canonical audit unavailable"));
  const AppenderWithAudit = AssessmentEventAppender as unknown as new (
    outbox: OutboxRepository,
    auditWriter: AuditWriterService,
  ) => AssessmentEventAppender;
  const appender = new AppenderWithAudit(
    { enqueue } as unknown as OutboxRepository,
    { writeInTx } as unknown as AuditWriterService,
  );

  await expect(
    appender.appendInTx(tx, {
      assessmentId: "22222222-2222-4222-8222-222222222222",
      eventId: "55555555-5555-4555-8555-555555555555",
      correlationId: "corr-rollback",
      eventType: AGENTIC_ASSESSMENT_EVENT_TYPES.ACTIVITY_RECORDED,
      actorType: ASSESSMENT_EVENT_ACTOR_TYPES.ASSESSMENT_ROOT,
      payload: {
        kind: ASSESSMENT_ACTIVITY_KINDS.MODEL,
        labelKey: "assessment.activity.modelStepCompleted",
      },
      auditActor: ROOT_AUDIT_ACTOR,
    }),
  ).rejects.toThrow("canonical audit unavailable");
  // The appender never masks the failure; the owning Prisma transaction can
  // therefore atomically roll back the already-issued domain and outbox writes.
  expect(writeInTx).toHaveBeenCalledTimes(1);
});
