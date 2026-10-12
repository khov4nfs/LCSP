import { describe, expect, it, jest } from "@jest/globals";
import {
  AGENT_EXECUTION_STATES,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import { ASSESSMENT_AGENT_STREAM_EVENT_TYPES } from "@lcsp/contracts/evidence";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AssessmentRuntimeEventService } from "../../../../../platform/runtime-events/assessment-runtime-event.service.js";
import { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";
import { AssessmentEventAppender } from "../../services/assessment-event-appender.service.js";
import { AssessmentLifecycleCoordinator } from "../../services/assessment-lifecycle-coordinator.service.js";
import { PublishAgentStreamEventCommand } from "./publish-agent-stream-event.command.js";
import { PublishAgentStreamEventHandler } from "./publish-agent-stream-event.handler.js";

const payload = {
  assessment_id: "assessment-a",
  run_id: "execution-a",
  event_type: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallCompleted,
  data: { runtimeRunId: "native-transport-run" },
};

function fixture(overrides: Record<string, unknown> = {}) {
  const query = jest.fn<() => Promise<unknown[]>>().mockResolvedValue([
    {
      lifecycleState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
      lifecycleRevision: 1,
      blockerReason: null,
      blockerReference: null,
      threadId: "thread-a",
      currentExecutionId: payload.run_id,
      executionState: AGENT_EXECUTION_STATES.RUNNING,
      leaseToken: "lease-a",
      leaseExpiresAt: new Date(Date.now() + 60_000),
      ...overrides,
    },
  ]);
  const tx = { $queryRaw: query } as unknown as Prisma.TransactionClient;
  const prisma = {
    $transaction: async (
      work: (tx: Prisma.TransactionClient) => Promise<unknown>,
    ) => work(tx),
  } as PrismaService;
  const authority = new AssessmentRuntimeAuthority(
    prisma,
    {} as AssessmentEventAppender,
    {} as AssessmentLifecycleCoordinator,
  );
  const publish = jest
    .fn<AssessmentRuntimeEventService["publishAgentStreamEvent"]>()
    .mockResolvedValue(null);
  const append = jest
    .fn<AssessmentEventAppender["appendInTx"]>()
    .mockResolvedValue({
      eventId: "canonical",
      sequence: 1,
      threadId: "thread-a",
    });
  const findUsage = jest
    .fn<(args: unknown) => Promise<unknown>>()
    .mockResolvedValue({ inputTokens: 5n, outputTokens: 2n, totalTokens: 7n });
  Object.assign(tx, { llmUsageEvent: { findFirst: findUsage } });
  const handler = new PublishAgentStreamEventHandler(
    {
      publishAgentStreamEvent: publish,
    } as unknown as AssessmentRuntimeEventService,
    prisma,
    authority,
    { appendInTx: append } as unknown as AssessmentEventAppender,
  );
  return { handler, publish, tx, append, findUsage };
}

describe("Root stream execution authorization", () => {
  it("projects persisted usage only and uses a stable canonical identity on callback replay", async () => {
    const { handler, publish, append, findUsage } = fixture();
    publish.mockResolvedValue({
      assessmentId: payload.assessment_id,
      runId: payload.run_id,
      eventId: "transport-event",
      eventType: payload.event_type,
      data: {
        invocation_id: "invocation-a",
        usage: { input_tokens: 999999 },
        content: "private source",
      },
    } as never);
    const command = new PublishAgentStreamEventCommand(
      payload,
      "correlation",
      "lease-a",
    );
    await handler.execute(command);
    await handler.execute(command);
    expect(findUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          assessmentId: payload.assessment_id,
          runId: payload.run_id,
          invocationId: "invocation-a",
        },
      }),
    );
    expect(append.mock.calls[0]?.[1]).toMatchObject({
      tokenUsage: {
        invocationId: "invocation-a",
        promptTokens: 5,
        completionTokens: 2,
        totalTokens: 7,
      },
    });
    expect(append.mock.calls[0]?.[1].eventId).toBe(
      append.mock.calls[1]?.[1].eventId,
    );
    expect(JSON.stringify(append.mock.calls[0]?.[1])).not.toContain(
      "private source",
    );
  });

  it("does not invent usage for an unknown invocation or incomplete provider metrics", async () => {
    const { handler, publish, append, findUsage } = fixture();
    publish.mockResolvedValue({
      assessmentId: payload.assessment_id,
      eventId: "transport-event",
      eventType: payload.event_type,
      data: { invocation_id: "foreign-invocation" },
    } as never);
    for (const usage of [
      null,
      { inputTokens: 5n, outputTokens: null, totalTokens: null },
    ]) {
      findUsage.mockResolvedValue(usage);
      await handler.execute(
        new PublishAgentStreamEventCommand(payload, "correlation", "lease-a"),
      );
    }
    expect(
      append.mock.calls.every(([, input]) => input.tokenUsage === undefined),
    ).toBe(true);
  });

  it("publishes only after checking the canonical lease and replaces transport metadata", async () => {
    const { handler, publish, tx } = fixture();
    await handler.execute(
      new PublishAgentStreamEventCommand(payload, "correlation", "lease-a"),
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        assessmentId: payload.assessment_id,
        runId: payload.run_id,
        data: { runtimeRunId: payload.run_id },
      }),
      expect.anything(),
    );
    expect(publish.mock.calls[0]?.[1] === tx).toBe(true);
  });

  it.each([
    { leaseToken: "other-tenant-lease" },
    { leaseExpiresAt: new Date(0) },
    { executionState: AGENT_EXECUTION_STATES.PAUSED },
    { executionState: AGENT_EXECUTION_STATES.FAILED },
    { currentExecutionId: "replacement-execution" },
  ])(
    "refuses stale, stopped, expired and unrelated executions before publishing: %p",
    async (row) => {
      const { handler, publish } = fixture(row);
      await expect(
        handler.execute(
          new PublishAgentStreamEventCommand(payload, "correlation", "lease-a"),
        ),
      ).rejects.toThrow();
      expect(publish).not.toHaveBeenCalled();
    },
  );

  it("refuses a missing lease before publishing", async () => {
    const { handler, publish } = fixture();
    await expect(
      handler.execute(
        new PublishAgentStreamEventCommand(payload, "correlation"),
      ),
    ).rejects.toThrow();
    expect(publish).not.toHaveBeenCalled();
  });
});
