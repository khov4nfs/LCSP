import { expect, it, jest } from "@jest/globals";
import {
  AGENTIC_ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_EVENT_ACTOR_TYPES,
  ASSESSMENT_ACTIVITY_KINDS,
} from "@lcsp/contracts/assessment";
import type { Prisma } from "@prisma/client";
import type { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";
import { ROOT_AUDIT_ACTOR } from "../../infrastructure/persistence/assessment-case-support.service.js";
import { AssessmentEventAppender } from "./assessment-event-appender.service.js";

it("commits identical trusted usage in the canonical event and outbox and deduplicates replay", async () => {
  const enqueue = jest
    .fn<OutboxRepository["enqueue"]>()
    .mockResolvedValue("outbox");
  let stored: Record<string, unknown> | null = null;
  const create = jest.fn(
    async ({ data }: { data: Record<string, unknown> }) => {
      stored = data;
      return data;
    },
  );
  const update = jest.fn(async () => ({}));
  const tx = {
    assessmentEvent: { findUnique: async () => stored, create },
    assessmentRuntime: { update },
    $queryRaw: async () => [
      { threadId: "33333333-3333-4333-8333-333333333333", eventSequence: 10 },
    ],
  } as unknown as Prisma.TransactionClient;
  const appender = new AssessmentEventAppender({
    enqueue,
  } as unknown as OutboxRepository);
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
});
