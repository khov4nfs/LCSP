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
import {
  AssessmentRuntimeAuthority,
  type SeparateCheckpointClient,
  setSeparateCheckpointClientFactoryForTesting,
} from "./assessment-runtime-authority.service.js";
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
    checkpointJson: null,
    state: Controls.running,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2027-01-01T00:00:00.000Z"),
  };
  const tx = {
    $queryRaw: jest
      .fn<(query: unknown) => Promise<unknown[]>>()
      .mockResolvedValue([row]),
    assessmentRuntime: {
      update: jest.fn(({ data }: { data: Partial<typeof row> }) =>
        Promise.resolve(Object.assign(row, data)),
      ),
    },
    assessmentRuntimeTurn: {
      findUnique: jest.fn<() => Promise<typeof turn>>().mockResolvedValue(turn),
      findFirst: jest.fn<() => Promise<null>>().mockResolvedValue(null),
      upsert: jest.fn(
        ({
          update,
        }: {
          create: Record<string, unknown>;
          update: Partial<typeof turn>;
        }) => Promise.resolve(Object.assign(turn, update)),
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

  it("authorizes a failed-run checkpoint only when the server row and failed turn bind it to this thread", async () => {
    const f = fixture();
    const checkpointId = randomUUID();
    const failedExecutionId = f.row.currentExecutionId;
    Object.assign(f.row, {
      executionState: Execution.FAILED,
      checkpointId,
      leaseToken: null,
      leaseExpiresAt: null,
    });
    Object.assign(f.turn, {
      state: Controls.completed,
      checkpointJson: { checkpointId },
    });

    const claim = await f.authority.claimRoot({
      assessmentId: f.assessmentId,
      correlationId: randomUUID(),
    });

    expect(claim.executionId).not.toBe(failedExecutionId);
    expect(claim.threadId).toBe(f.row.threadId);
    expect(claim.resumeCheckpointId).toBe(checkpointId);
  });

  it("does not infer checkpoint authority for a failed run whose API checkpoint is absent", async () => {
    const f = fixture();
    Object.assign(f.row, {
      executionState: Execution.FAILED,
      checkpointId: null,
      leaseToken: null,
      leaseExpiresAt: null,
    });
    Object.assign(f.turn, {
      state: Controls.completed,
      checkpointJson: null,
    });

    const claim = await f.authority.claimRoot({
      assessmentId: f.assessmentId,
      correlationId: randomUUID(),
    });

    expect(claim.resumeCheckpointId).toBeNull();
  });

  it("recovers a null API checkpoint only from the latest native checkpoint bound to the failed Root turn", async () => {
    const f = fixture();
    const checkpointId = randomUUID();
    const runtimeRunId = f.runtimeRunId;
    Object.assign(f.row, {
      executionState: Execution.FAILED,
      checkpointId: null,
      leaseToken: null,
      leaseExpiresAt: null,
    });
    Object.assign(f.turn, {
      state: Controls.completed,
      checkpointJson: null,
    });
    const nativeCheckpoint = {
      checkpointId,
      serializedCheckpointId: checkpointId,
      checkpointTimestamp: "2026-10-26T16:33:19.748Z",
      metadata: {
        assessment_id: f.assessmentId,
        lcsp_runtime_run_id: runtimeRunId,
        lcsp_boundary_name: "assessment_root_requested",
        lc_agent_name: "lcsp-assessment-root",
      },
    };
    f.tx.$queryRaw
      .mockResolvedValueOnce([f.row])
      .mockResolvedValueOnce([f.row])
      .mockResolvedValueOnce([{ tableName: "checkpoints" }])
      .mockResolvedValueOnce([nativeCheckpoint]);

    const claim = await f.authority.claimRoot({
      assessmentId: f.assessmentId,
      correlationId: randomUUID(),
    });

    expect(claim.resumeCheckpointId).toBe(checkpointId);
    expect(f.row.checkpointId).toBe(checkpointId);
    const newTurn = f.tx.assessmentRuntimeTurn.upsert.mock.calls[0]?.[0];
    expect(newTurn?.create.checkpointJson).toEqual({
      checkpointId,
      resumedFromExecutionId: f.turn.id,
      recoverySource: "NATIVE_CHECKPOINT_METADATA",
    });
    expect(newTurn?.create.contextJson).toMatchObject({
      nativeCheckpointRecovery: {
        checkpointId,
        checkpointTimestamp: "2026-10-26T16:33:19.748Z",
        resumedFromExecutionId: f.turn.id,
        recoverySource: "NATIVE_CHECKPOINT_METADATA",
      },
    });
    const nativeQuery = f.tx.$queryRaw.mock.calls[3]?.[0] as
      { sql?: string; values?: unknown[] } | undefined;
    expect(nativeQuery?.sql).toContain('ORDER BY "checkpoint_id" DESC');
    expect(nativeQuery?.values?.includes(f.row.threadId)).toBe(true);
    expect(nativeQuery?.values?.includes("")).toBe(true);
    expect(f.turn.checkpointJson).toBeNull();
  });

  it.each([
    ["another assessment", { assessment_id: randomUUID() }],
    ["another transport run", { lcsp_runtime_run_id: randomUUID() }],
    ["another boundary", { lcsp_boundary_name: "command.other.v1" }],
    ["another agent", { lc_agent_name: "another-agent" }],
  ])(
    "does not recover a native checkpoint attributed to %s",
    async (_label, mismatch) => {
      const f = fixture();
      const checkpointId = randomUUID();
      Object.assign(f.row, {
        executionState: Execution.FAILED,
        checkpointId: null,
        leaseToken: null,
        leaseExpiresAt: null,
      });
      Object.assign(f.turn, {
        state: Controls.completed,
        checkpointJson: null,
      });
      f.tx.$queryRaw
        .mockResolvedValueOnce([f.row])
        .mockResolvedValueOnce([f.row])
        .mockResolvedValueOnce([{ tableName: "checkpoints" }])
        .mockResolvedValueOnce([
          {
            checkpointId,
            serializedCheckpointId: checkpointId,
            checkpointTimestamp: "2026-10-26T16:33:19.748Z",
            metadata: {
              assessment_id: f.assessmentId,
              lcsp_runtime_run_id: f.runtimeRunId,
              lcsp_boundary_name: "assessment_root_requested",
              lc_agent_name: "lcsp-assessment-root",
              ...mismatch,
            },
          },
        ]);

      const claim = await f.authority.claimRoot({
        assessmentId: f.assessmentId,
        correlationId: randomUUID(),
      });

      expect(claim.resumeCheckpointId).toBeNull();
      expect(f.row.checkpointId).toBeNull();
      expect(f.turn.checkpointJson).toBeNull();
    },
  );

  it("does not resume a native checkpoint written after the failed Root turn ended", async () => {
    const f = fixture();
    const checkpointId = randomUUID();
    Object.assign(f.row, {
      executionState: Execution.FAILED,
      checkpointId: null,
      leaseToken: null,
      leaseExpiresAt: null,
    });
    Object.assign(f.turn, { state: Controls.completed, checkpointJson: null });
    f.tx.$queryRaw
      .mockResolvedValueOnce([f.row])
      .mockResolvedValueOnce([f.row])
      .mockResolvedValueOnce([{ tableName: "checkpoints" }])
      .mockResolvedValueOnce([
        {
          checkpointId,
          serializedCheckpointId: checkpointId,
          checkpointTimestamp: "2027-01-01T00:00:00.001Z",
          metadata: {
            assessment_id: f.assessmentId,
            lcsp_runtime_run_id: f.runtimeRunId,
            lcsp_boundary_name: "assessment_root_requested",
            lc_agent_name: "lcsp-assessment-root",
          },
        },
      ]);

    const claim = await f.authority.claimRoot({
      assessmentId: f.assessmentId,
      correlationId: randomUUID(),
    });

    expect(claim.resumeCheckpointId).toBeNull();
    expect(f.row.checkpointId).toBeNull();
  });

  it("does not resume a native checkpoint whose payload ID differs from its stored identity", async () => {
    const f = fixture();
    const checkpointId = randomUUID();
    Object.assign(f.row, {
      executionState: Execution.FAILED,
      checkpointId: null,
      leaseToken: null,
      leaseExpiresAt: null,
    });
    Object.assign(f.turn, { state: Controls.completed, checkpointJson: null });
    f.tx.$queryRaw
      .mockResolvedValueOnce([f.row])
      .mockResolvedValueOnce([f.row])
      .mockResolvedValueOnce([{ tableName: "checkpoints" }])
      .mockResolvedValueOnce([
        {
          checkpointId,
          serializedCheckpointId: randomUUID(),
          checkpointTimestamp: "2026-10-26T16:33:19.748Z",
          metadata: {
            assessment_id: f.assessmentId,
            lcsp_runtime_run_id: f.runtimeRunId,
            lcsp_boundary_name: "assessment_root_requested",
            lc_agent_name: "lcsp-assessment-root",
          },
        },
      ]);

    const claim = await f.authority.claimRoot({
      assessmentId: f.assessmentId,
      correlationId: randomUUID(),
    });

    expect(claim.resumeCheckpointId).toBeNull();
    expect(f.row.checkpointId).toBeNull();
  });

  it("does not recover from an unavailable native checkpoint store", async () => {
    const f = fixture();
    Object.assign(f.row, {
      executionState: Execution.FAILED,
      checkpointId: null,
      leaseToken: null,
      leaseExpiresAt: null,
    });
    Object.assign(f.turn, { state: Controls.completed, checkpointJson: null });
    f.tx.$queryRaw
      .mockResolvedValueOnce([f.row])
      .mockResolvedValueOnce([f.row])
      .mockResolvedValueOnce([{ tableName: null }]);

    const claim = await f.authority.claimRoot({
      assessmentId: f.assessmentId,
      correlationId: randomUUID(),
    });

    expect(claim.resumeCheckpointId).toBeNull();
    const newTurn = f.tx.assessmentRuntimeTurn.upsert.mock.calls[0]?.[0];
    expect(newTurn?.create.checkpointJson).toBeUndefined();
  });

  it("does not authorize a failed checkpoint when the runtime and turn bindings disagree", async () => {
    const f = fixture();
    const runtimeCheckpointId = randomUUID();
    Object.assign(f.row, {
      executionState: Execution.FAILED,
      checkpointId: runtimeCheckpointId,
      leaseToken: null,
      leaseExpiresAt: null,
    });
    Object.assign(f.turn, {
      state: Controls.completed,
      checkpointJson: { checkpointId: randomUUID() },
    });

    const claim = await f.authority.claimRoot({
      assessmentId: f.assessmentId,
      correlationId: randomUUID(),
    });

    expect(claim.resumeCheckpointId).toBeNull();
  });

  it("recovers a null API checkpoint from a separate native checkpoint database when configured", async () => {
    const f = fixture();
    const checkpointId = randomUUID();
    const runtimeRunId = f.runtimeRunId;
    const ruleSetVersionId = randomUUID();
    const repositorySnapshotId = randomUUID();
    const repositoryCommit = "a".repeat(40);
    Object.assign(f.row, {
      executionState: Execution.FAILED,
      checkpointId: null,
      leaseToken: null,
      leaseExpiresAt: null,
    });
    Object.assign(f.turn, {
      state: Controls.completed,
      checkpointJson: null,
    });
    const nativeCheckpoint = {
      checkpointId,
      serializedCheckpointId: checkpointId,
      checkpointTimestamp: "2026-10-26T16:33:19.748Z",
      metadata: {
        assessment_id: f.assessmentId,
        lcsp_runtime_run_id: runtimeRunId,
        lcsp_boundary_name: "assessment_root_requested",
        lc_agent_name: "lcsp-assessment-root",
        rule_set_version_id: ruleSetVersionId,
        repository_snapshot_id: repositorySnapshotId,
        repository_commit: repositoryCommit,
      },
    };
    (f.tx as Record<string, unknown>).assessmentCase = {
      findUnique: jest.fn<
        () => Promise<{
          ruleSetVersionId: string;
          repositorySnapshotId: string;
          repositoryCommit: string;
        }>
      >().mockResolvedValue({
        ruleSetVersionId,
        repositorySnapshotId,
        repositoryCommit,
      }),
    };
    f.tx.$queryRaw
      .mockResolvedValueOnce([f.row])
      .mockResolvedValueOnce([f.row])
      .mockResolvedValueOnce([{ tableName: null }]); // table absent in co-located API db

    const prevUrl = process.env.LANGGRAPH_CHECKPOINT_DATABASE_URL;
    process.env.LANGGRAPH_CHECKPOINT_DATABASE_URL =
      "postgresql://postgres:postgres@127.0.0.1:55441/separate_checkpoints";

    const mockConnect = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const mockEnd = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const mockQuery = jest.fn<SeparateCheckpointClient["query"]>()
      .mockResolvedValueOnce({ rows: [{ tableName: "checkpoints" }] } as never)
      .mockResolvedValueOnce({ rows: [nativeCheckpoint] } as never);

    setSeparateCheckpointClientFactoryForTesting(() => ({
      connect: mockConnect,
      query: mockQuery as unknown as SeparateCheckpointClient["query"],
      end: mockEnd,
    }));

    try {
      const claim = await f.authority.claimRoot({
        assessmentId: f.assessmentId,
        correlationId: randomUUID(),
      });

      expect(claim.resumeCheckpointId).toBe(checkpointId);
      expect(f.row.checkpointId).toBe(checkpointId);
      expect(mockConnect).toHaveBeenCalled();
      expect(mockEnd).toHaveBeenCalled();
    } finally {
      if (prevUrl === undefined) {
        delete process.env.LANGGRAPH_CHECKPOINT_DATABASE_URL;
      } else {
        process.env.LANGGRAPH_CHECKPOINT_DATABASE_URL = prevUrl;
      }
      setSeparateCheckpointClientFactoryForTesting((url: string) => ({
        connect: async () => {},
        query: async <R extends Record<string, unknown> = Record<string, unknown>>() => ({ rows: [] as R[] }),
        end: async () => {},
      }));
    }
  });

  it("does not recover from a separate native checkpoint database when case pins mismatch", async () => {
    const f = fixture();
    const checkpointId = randomUUID();
    const runtimeRunId = f.runtimeRunId;
    Object.assign(f.row, {
      executionState: Execution.FAILED,
      checkpointId: null,
      leaseToken: null,
      leaseExpiresAt: null,
    });
    Object.assign(f.turn, {
      state: Controls.completed,
      checkpointJson: null,
    });
    const nativeCheckpoint = {
      checkpointId,
      serializedCheckpointId: checkpointId,
      checkpointTimestamp: "2026-10-26T16:33:19.748Z",
      metadata: {
        assessment_id: f.assessmentId,
        lcsp_runtime_run_id: runtimeRunId,
        lcsp_boundary_name: "assessment_root_requested",
        lc_agent_name: "lcsp-assessment-root",
        rule_set_version_id: randomUUID(),
        repository_snapshot_id: randomUUID(),
        repository_commit: "b".repeat(40), // mismatched pin
      },
    };
    (f.tx as Record<string, unknown>).assessmentCase = {
      findUnique: jest.fn<
        () => Promise<{
          ruleSetVersionId: string;
          repositorySnapshotId: string;
          repositoryCommit: string;
        }>
      >().mockResolvedValue({
        ruleSetVersionId: randomUUID(),
        repositorySnapshotId: randomUUID(),
        repositoryCommit: "a".repeat(40),
      }),
    };
    f.tx.$queryRaw
      .mockResolvedValueOnce([f.row])
      .mockResolvedValueOnce([f.row])
      .mockResolvedValueOnce([{ tableName: null }]);

    const prevUrl = process.env.LANGGRAPH_CHECKPOINT_DATABASE_URL;
    process.env.LANGGRAPH_CHECKPOINT_DATABASE_URL =
      "postgresql://postgres:postgres@127.0.0.1:55441/separate_checkpoints";

    setSeparateCheckpointClientFactoryForTesting(() => ({
      connect: async () => {},
      query: async <R extends Record<string, unknown> = Record<string, unknown>>(
        text: string,
      ): Promise<{ rows: R[] }> => {
        if (text.includes("to_regclass")) {
          return { rows: [{ tableName: "checkpoints" } as unknown as R] };
        }
        return { rows: [nativeCheckpoint as unknown as R] };
      },
      end: async () => {},
    }));

    try {
      const claim = await f.authority.claimRoot({
        assessmentId: f.assessmentId,
        correlationId: randomUUID(),
      });

      expect(claim.resumeCheckpointId).toBeNull();
      expect(f.row.checkpointId).toBeNull();
    } finally {
      if (prevUrl === undefined) {
        delete process.env.LANGGRAPH_CHECKPOINT_DATABASE_URL;
      } else {
        process.env.LANGGRAPH_CHECKPOINT_DATABASE_URL = prevUrl;
      }
      setSeparateCheckpointClientFactoryForTesting((url: string) => ({
        connect: async () => {},
        query: async <R extends Record<string, unknown> = Record<string, unknown>>() => ({ rows: [] as R[] }),
        end: async () => {},
      }));
    }
  });

  it("does not recover when separate native checkpoint database connection fails", async () => {
    const f = fixture();
    Object.assign(f.row, {
      executionState: Execution.FAILED,
      checkpointId: null,
      leaseToken: null,
      leaseExpiresAt: null,
    });
    Object.assign(f.turn, {
      state: Controls.completed,
      checkpointJson: null,
    });
    f.tx.$queryRaw
      .mockResolvedValueOnce([f.row])
      .mockResolvedValueOnce([f.row])
      .mockResolvedValueOnce([{ tableName: null }]);

    const prevUrl = process.env.LANGGRAPH_CHECKPOINT_DATABASE_URL;
    process.env.LANGGRAPH_CHECKPOINT_DATABASE_URL =
      "postgresql://postgres:postgres@127.0.0.1:55441/separate_checkpoints";

    setSeparateCheckpointClientFactoryForTesting(() => ({
      connect: async () => {
        throw new Error("Connection refused");
      },
      query: async <R extends Record<string, unknown> = Record<string, unknown>>() => ({ rows: [] as R[] }),
      end: async () => {},
    }));

    try {
      const claim = await f.authority.claimRoot({
        assessmentId: f.assessmentId,
        correlationId: randomUUID(),
      });

      expect(claim.resumeCheckpointId).toBeNull();
      expect(f.row.checkpointId).toBeNull();
    } finally {
      if (prevUrl === undefined) {
        delete process.env.LANGGRAPH_CHECKPOINT_DATABASE_URL;
      } else {
        process.env.LANGGRAPH_CHECKPOINT_DATABASE_URL = prevUrl;
      }
      setSeparateCheckpointClientFactoryForTesting((url: string) => ({
        connect: async () => {},
        query: async <R extends Record<string, unknown> = Record<string, unknown>>() => ({ rows: [] as R[] }),
        end: async () => {},
      }));
    }
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
