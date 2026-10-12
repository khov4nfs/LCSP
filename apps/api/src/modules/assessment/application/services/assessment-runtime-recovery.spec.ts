import { randomUUID } from "node:crypto";
import { jest } from "@jest/globals";
import {
  AGENT_EXECUTION_STATES as Execution,
  ASSESSMENT_LIFECYCLE_STATES as Lifecycle,
  type AssessmentLifecycleState,
  assessmentEventSchema,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_ROOT_BOUNDARY,
  claimAssessmentRootExecutionRequestSchema,
  assessmentRootClaimSchema,
} from "@lcsp/contracts/assessment-domain";
import { ASSESSMENT_RUNTIME_CONTROL_STATES as Controls } from "@lcsp/contracts/evidence";
import { AssessmentRuntimeAuthority } from "./assessment-runtime-authority.service.js";
import type { AppendAssessmentEventInput } from "./assessment-event-appender.service.js";

function fixture(
  lifecycleState: AssessmentLifecycleState = Lifecycle.ACTIVE,
  expired = false,
) {
  const assessmentId = randomUUID();
  const runtimeRunId = randomUUID();
  const row = {
    lifecycleState,
    lifecycleRevision: 3,
    blockerReason: null,
    blockerReference: null,
    threadId: randomUUID(),
    checkpointNamespace: assessmentId,
    checkpointId: randomUUID(),
    currentExecutionId: randomUUID(),
    executionState: Execution.RUNNING,
    leaseToken: randomUUID(),
    leaseExpiresAt: new Date(Date.now() + (expired ? -60000 : 600000)),
  };
  const turn = {
    id: row.currentExecutionId,
    assessmentId,
    threadId: row.threadId,
    boundary: ASSESSMENT_ROOT_BOUNDARY,
    contextJson: { runtimeRunId },
    state: Controls.running,
  };
  const tx = {
    $queryRaw: jest
      .fn<() => Promise<(typeof row)[]>>()
      .mockResolvedValue([row]),
    assessmentRuntime: {
      update: jest.fn(({ data }: { data: Partial<typeof row> }) =>
        Promise.resolve(Object.assign(row, data)),
      ),
    },
    assessmentRuntimeTurn: {
      findUnique: jest.fn<() => Promise<typeof turn>>().mockResolvedValue(turn),
      findFirst: jest.fn<() => Promise<null>>().mockResolvedValue(null),
      upsert: jest.fn(({ update }: { update: Partial<typeof turn> }) =>
        Promise.resolve(Object.assign(turn, update)),
      ),
      update: jest.fn(({ data }: { data: Partial<typeof turn> }) =>
        Promise.resolve(Object.assign(turn, data)),
      ),
    },
    assessmentHumanRequest: {
      count: jest.fn<() => Promise<number>>().mockResolvedValue(0),
    },
  };
  const appendInTx = jest.fn(
    (_tx: unknown, input: AppendAssessmentEventInput) => {
      const event = assessmentEventSchema.parse({
        eventId: randomUUID(),
        assessmentId,
        threadId: row.threadId,
        sequence: 1,
        timestamp: new Date().toISOString(),
        eventType: input.eventType,
        actorType: input.actorType,
        payload: input.payload,
        executionId: input.executionId,
      });
      return Promise.resolve(event);
    },
  );
  const authority = new AssessmentRuntimeAuthority(
    { $transaction: (fn: (tx: unknown) => unknown) => fn(tx) } as never,
    { appendInTx } as never,
    {} as never,
  );
  return { authority, row, turn, tx, assessmentId, runtimeRunId, appendInTx };
}

describe("persisted Agent Server run recovery", () => {
  it.each([false, true])(
    "reattaches the same run with a fresh fenced lease, expired=%p",
    async (expired) => {
      const f = fixture(Lifecycle.ACTIVE, expired);
      const oldLease = f.row.leaseToken;
      const executionId = f.row.currentExecutionId;
      const claim = await f.authority.claimRoot({
        assessmentId: f.assessmentId,
        runtimeRunId: f.runtimeRunId,
        correlationId: randomUUID(),
      });
      expect(assessmentRootClaimSchema.safeParse(claim).success).toBe(true);
      expect(claim.executionId).toBe(executionId);
      expect(claim.threadId).toBe(f.row.threadId);
      expect(claim.recoveredExecution).toBe(true);
      expect(claim.leaseToken).not.toBe(oldLease);
      expect(f.appendInTx).not.toHaveBeenCalled();
      await expect(
        f.authority.authorize({
          assessmentId: f.assessmentId,
          leaseToken: oldLease,
          correlationId: randomUUID(),
        }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        f.authority.authorize({
          assessmentId: f.assessmentId,
          leaseToken: claim.leaseToken,
          correlationId: randomUUID(),
        }),
      ).resolves.toMatchObject({ executionId });
    },
  );

  it("keeps a different transport run fenced by the held lease", async () => {
    const f = fixture();
    await expect(
      f.authority.claimRoot({
        assessmentId: f.assessmentId,
        runtimeRunId: randomUUID(),
        correlationId: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.tx.assessmentRuntime.update).not.toHaveBeenCalled();
  });

  it("allows only the same unfinished carrier to acknowledge an already COMPLETE assessment", async () => {
    const f = fixture(Lifecycle.COMPLETE, true);
    await expect(
      f.authority.claimRoot({
        assessmentId: f.assessmentId,
        runtimeRunId: randomUUID(),
        correlationId: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 409 });
    const claim = await f.authority.claimRoot({
      assessmentId: f.assessmentId,
      runtimeRunId: f.runtimeRunId,
      correlationId: randomUUID(),
    });
    expect(claim.lifecycleState).toBe(Lifecycle.COMPLETE);
    expect(claim.recoveredExecution).toBe(true);
    await f.authority.finishExecution({
      assessmentId: f.assessmentId,
      leaseToken: claim.leaseToken,
      correlationId: randomUUID(),
      toState: Execution.SUCCEEDED,
    });
    expect(f.row.lifecycleState).toBe(Lifecycle.COMPLETE);
    expect(f.row.executionState).toBe(Execution.SUCCEEDED);
    expect(f.row.leaseToken).toBeNull();
  });

  it("reattaches interrupted human-wait persistence without resolving the question", async () => {
    const f = fixture(Lifecycle.WAITING_FOR_HUMAN);
    const claim = await f.authority.claimRoot({
      assessmentId: f.assessmentId,
      runtimeRunId: f.runtimeRunId,
      correlationId: randomUUID(),
    });
    expect(claim.lifecycleState).toBe(Lifecycle.WAITING_FOR_HUMAN);
    expect(claim.recoveredExecution).toBe(true);
    expect(f.row.lifecycleState).toBe(Lifecycle.WAITING_FOR_HUMAN);
  });

  it("rejects model or transport input pretending to supply an execution, thread or lease", () => {
    expect(
      claimAssessmentRootExecutionRequestSchema.safeParse({
        runtimeRunId: "not-a-uuid",
      }).success,
    ).toBe(false);
    expect(
      claimAssessmentRootExecutionRequestSchema.safeParse({
        runtimeRunId: randomUUID(),
        threadId: randomUUID(),
      }).success,
    ).toBe(false);
    expect(
      claimAssessmentRootExecutionRequestSchema.safeParse({
        runtimeRunId: randomUUID(),
      }).success,
    ).toBe(true);
  });
});
