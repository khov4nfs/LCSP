import { randomUUID } from "node:crypto";
import { jest } from "@jest/globals";
import {
  AGENT_EXECUTION_STATES as Execution,
  ASSESSMENT_LIFECYCLE_STATES as Lifecycle,
  type AssessmentLifecycleState,
  HUMAN_RESOLUTION_REQUEST_STATUSES,
  assessmentEventSchema,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_ROOT_BOUNDARY,
  ASSESSMENT_AUDIT_MODES,
  RULE_AUDIT_STATUSES,
  claimAssessmentRootExecutionRequestSchema,
  assessmentRootClaimSchema,
} from "@lcsp/contracts/assessment-domain";
import { ASSESSMENT_RUNTIME_CONTROL_STATES as Controls } from "@lcsp/contracts/evidence";
import {
  AssessmentRuntimeAuthority,
  type SeparateCheckpointClient,
  resetSeparateCheckpointClientFactoryForTesting,
  setSeparateCheckpointClientFactoryForTesting,
} from "./assessment-runtime-authority.service.js";
import type { AppendAssessmentEventInput } from "./assessment-event-appender.service.js";

function fixture(
  lifecycleState: AssessmentLifecycleState = Lifecycle.ACTIVE,
  expired = false,
) {
  const assessmentId = randomUUID();
  const runtimeRunId = randomUUID();
  const ruleSetVersionId = randomUUID();
  const repositorySnapshotId = randomUUID();
  const repositoryCommit = "a".repeat(40);
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
    assessmentCase: {
      findUnique: jest
        .fn<
          () => Promise<{
            ruleSetVersionId: string;
            repositorySnapshotId: string;
            repositoryCommit: string;
          } | null>
        >()
        .mockResolvedValue({
          ruleSetVersionId,
          repositorySnapshotId,
          repositoryCommit,
        }),
    },
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
      findMany: jest
        .fn<() => Promise<Record<string, unknown>[]>>()
        .mockResolvedValue([]),
      updateMany: jest
        .fn<() => Promise<{ count: number }>>()
        .mockResolvedValue({ count: 1 }),
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
    { bindInTx: () => Promise.resolve(undefined) } as never,
  );
  return {
    authority,
    row,
    turn,
    tx,
    assessmentId,
    runtimeRunId,
    ruleSetVersionId,
    repositorySnapshotId,
    repositoryCommit,
    appendInTx,
  };
}

describe("persisted Agent Server run recovery", () => {
  afterEach(() => {
    resetSeparateCheckpointClientFactoryForTesting();
  });
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
        rule_set_version_id: f.ruleSetVersionId,
        repository_snapshot_id: f.repositorySnapshotId,
        repository_commit: f.repositoryCommit,
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
    ["another thread", { thread_id: randomUUID() }],
    ["mismatched rule set pin", { rule_set_version_id: randomUUID() }],
    ["mismatched snapshot pin", { repository_snapshot_id: randomUUID() }],
    ["mismatched commit pin", { repository_commit: "b".repeat(40) }],
    ["missing rule set pin", { rule_set_version_id: undefined }],
    ["missing snapshot pin", { repository_snapshot_id: undefined }],
    ["missing commit pin", { repository_commit: undefined }],
    ["malformed rule set pin", { rule_set_version_id: 12345 }],
    ["malformed snapshot pin", { repository_snapshot_id: null }],
    ["malformed commit pin", { repository_commit: ["invalid"] }],
  ])(
    "does not recover a native checkpoint with %s",
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
      const metadata: Record<string, unknown> = {
        assessment_id: f.assessmentId,
        lcsp_runtime_run_id: f.runtimeRunId,
        lcsp_boundary_name: "assessment_root_requested",
        lc_agent_name: "lcsp-assessment-root",
        rule_set_version_id: f.ruleSetVersionId,
        repository_snapshot_id: f.repositorySnapshotId,
        repository_commit: f.repositoryCommit,
        ...mismatch,
      };
      const overrides = mismatch as Record<string, unknown>;
      if (
        "rule_set_version_id" in overrides &&
        overrides.rule_set_version_id === undefined
      )
        delete metadata.rule_set_version_id;
      if (
        "repository_snapshot_id" in overrides &&
        overrides.repository_snapshot_id === undefined
      )
        delete metadata.repository_snapshot_id;
      if (
        "repository_commit" in overrides &&
        overrides.repository_commit === undefined
      )
        delete metadata.repository_commit;

      f.tx.$queryRaw
        .mockResolvedValueOnce([f.row])
        .mockResolvedValueOnce([f.row])
        .mockResolvedValueOnce([{ tableName: "checkpoints" }])
        .mockResolvedValueOnce([
          {
            checkpointId,
            serializedCheckpointId: checkpointId,
            checkpointTimestamp: "2026-10-26T16:33:19.748Z",
            metadata,
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

  it("does not recover a native checkpoint when AssessmentCase record is missing", async () => {
    const f = fixture();
    const checkpointId = randomUUID();
    Object.assign(f.row, {
      executionState: Execution.FAILED,
      checkpointId: null,
      leaseToken: null,
      leaseExpiresAt: null,
    });
    Object.assign(f.turn, { state: Controls.completed, checkpointJson: null });
    f.tx.assessmentCase.findUnique.mockResolvedValue(null);
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
            rule_set_version_id: f.ruleSetVersionId,
            repository_snapshot_id: f.repositorySnapshotId,
            repository_commit: f.repositoryCommit,
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

  it.each([
    ["null metadata", null],
    ["string metadata", "invalid-string-metadata"],
    ["array metadata", ["not", "an", "object"]],
  ])(
    "does not recover a native checkpoint with %s",
    async (_label, invalidMetadata) => {
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
            metadata: invalidMetadata,
          },
        ]);

      const claim = await f.authority.claimRoot({
        assessmentId: f.assessmentId,
        correlationId: randomUUID(),
      });

      expect(claim.resumeCheckpointId).toBeNull();
      expect(f.row.checkpointId).toBeNull();
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
      findUnique: jest
        .fn<
          () => Promise<{
            ruleSetVersionId: string;
            repositorySnapshotId: string;
            repositoryCommit: string;
          }>
        >()
        .mockResolvedValue({
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

    const mockConnect = jest
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined);
    const mockEnd = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const mockQuery = jest
      .fn<SeparateCheckpointClient["query"]>()
      .mockResolvedValueOnce({ rows: [{ tableName: "checkpoints" }] })
      .mockResolvedValueOnce({ rows: [nativeCheckpoint] });

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
      resetSeparateCheckpointClientFactoryForTesting();
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
      findUnique: jest
        .fn<
          () => Promise<{
            ruleSetVersionId: string;
            repositorySnapshotId: string;
            repositoryCommit: string;
          }>
        >()
        .mockResolvedValue({
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
      connect: () => Promise.resolve(),
      query: <R extends Record<string, unknown> = Record<string, unknown>>(
        text: string,
      ): Promise<{ rows: R[] }> => {
        if (text.includes("to_regclass")) {
          return Promise.resolve({
            rows: [{ tableName: "checkpoints" } as unknown as R],
          });
        }
        return Promise.resolve({ rows: [nativeCheckpoint as unknown as R] });
      },
      end: () => Promise.resolve(),
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
      resetSeparateCheckpointClientFactoryForTesting();
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
      connect: () => Promise.reject(new Error("Connection refused")),
      query: <R extends Record<string, unknown> = Record<string, unknown>>() =>
        Promise.resolve({ rows: [] as R[] }),
      end: () => Promise.resolve(),
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
      resetSeparateCheckpointClientFactoryForTesting();
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

describe("unknown response review on the existing native thread", () => {
  function reviewFixture() {
    const f = fixture(Lifecycle.WAITING_FOR_HUMAN);
    Object.assign(f.row, {
      executionState: Execution.INTERRUPTED,
      leaseToken: null,
      leaseExpiresAt: null,
    });
    Object.assign(f.turn, {
      state: Controls.completed,
      checkpointJson: { checkpointId: f.row.checkpointId },
    });
    const request = {
      assessmentId: f.assessmentId,
      threadId: f.row.threadId,
      requestId: randomUUID(),
      checkpointId: f.row.checkpointId,
      requestRevision: 1,
      status: HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
      resolvedFactId: null,
      answers: [
        {
          idempotencyKey: "unknown-response-1",
          requestDigest: "a".repeat(64),
          actorId: randomUUID(),
          answeredAt: new Date().toISOString(),
          caseRevision: 0,
          requestRevision: 1,
          doesNotKnow: true,
          answer: null,
          checkpointId: f.row.checkpointId,
        },
      ],
    };
    f.tx.assessmentHumanRequest.findMany.mockResolvedValue([request]);
    return { ...f, request };
  }

  it("issues review authority while preserving WAITING and the same thread/execution", async () => {
    const f = reviewFixture();
    const executionId = f.row.currentExecutionId;
    const checkpointId = f.row.checkpointId;
    const claim = await f.authority.claimRoot({
      assessmentId: f.assessmentId,
      correlationId: randomUUID(),
      runtimeRunId: randomUUID(),
    });
    expect(claim.humanAnswerReviewRequired).toBe(true);
    expect(claim.lifecycleState).toBe(Lifecycle.WAITING_FOR_HUMAN);
    expect(claim.executionId).toBe(executionId);
    expect(claim.resumeCheckpointId).toBe(checkpointId);
    expect(f.turn.contextJson).toMatchObject({
      humanAnswerReview: {
        checkpointId,
        requests: [{ requestId: f.request.requestId, requestRevision: 1 }],
      },
    });
    await expect(
      f.authority.authorize({
        assessmentId: f.assessmentId,
        leaseToken: claim.leaseToken,
        correlationId: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("rejects a claim when an open dependency has not answered the bound checkpoint", async () => {
    const f = reviewFixture();
    f.request.answers[0].checkpointId = randomUUID();
    await expect(
      f.authority.claimRoot({
        assessmentId: f.assessmentId,
        correlationId: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.tx.assessmentRuntime.update).not.toHaveBeenCalled();
  });

  it("allows the authorized review to rebind its unchanged request to the next native wait", async () => {
    const f = reviewFixture();
    const claim = await f.authority.claimRoot({
      assessmentId: f.assessmentId,
      correlationId: randomUUID(),
      runtimeRunId: randomUUID(),
    });
    const nextCheckpoint = randomUUID();
    await f.authority.finishExecution({
      assessmentId: f.assessmentId,
      leaseToken: claim.leaseToken,
      correlationId: randomUUID(),
      toState: Execution.INTERRUPTED,
      checkpointId: nextCheckpoint,
      requestIds: [f.request.requestId],
    });
    expect(f.tx.assessmentHumanRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { checkpointId: nextCheckpoint },
      }),
    );
    expect(f.row.lifecycleState).toBe(Lifecycle.WAITING_FOR_HUMAN);
    expect(f.row.executionState).toBe(Execution.INTERRUPTED);
  });

  it("does not relax checkpoint binding for an unreviewed request revision", async () => {
    const f = reviewFixture();
    const claim = await f.authority.claimRoot({
      assessmentId: f.assessmentId,
      correlationId: randomUUID(),
      runtimeRunId: randomUUID(),
    });
    f.request.requestRevision += 1;
    await expect(
      f.authority.finishExecution({
        assessmentId: f.assessmentId,
        leaseToken: claim.leaseToken,
        correlationId: randomUUID(),
        toState: Execution.INTERRUPTED,
        checkpointId: randomUUID(),
        requestIds: [f.request.requestId],
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("retries a gracefully failed review at its newer native checkpoint without losing the original UNKNOWN binding", async () => {
    const f = reviewFixture();
    const originalCheckpoint = f.row.checkpointId;
    const originalExecution = f.row.currentExecutionId;
    const review = await f.authority.claimRoot({
      assessmentId: f.assessmentId,
      correlationId: randomUUID(),
      runtimeRunId: randomUUID(),
    });
    const failedCheckpoint = randomUUID();
    await f.authority.finishExecution({
      assessmentId: f.assessmentId,
      leaseToken: review.leaseToken,
      correlationId: randomUUID(),
      toState: Execution.FAILED,
      checkpointId: failedCheckpoint,
    });
    const retry = await f.authority.claimRoot({
      assessmentId: f.assessmentId,
      correlationId: randomUUID(),
      runtimeRunId: randomUUID(),
    });
    expect(retry.executionId).not.toBe(originalExecution);
    expect(retry.threadId).toBe(f.row.threadId);
    expect(retry.resumeCheckpointId).toBe(failedCheckpoint);
    expect(retry.humanAnswerReviewCheckpointId).toBe(originalCheckpoint);
    expect(retry.humanAnswerReviewExecutionId).toBe(originalExecution);
    expect(retry.humanAnswerReviewRequired).toBe(true);
    expect(f.request.checkpointId).toBe(originalCheckpoint);
    expect(f.row.lifecycleState).toBe(Lifecycle.WAITING_FOR_HUMAN);
    expect(f.turn.contextJson).toMatchObject({
      humanAnswerReview: {
        checkpointId: originalCheckpoint,
        requests: [{ requestId: f.request.requestId, requestRevision: 1 }],
      },
    });
    const nextWait = randomUUID();
    await f.authority.finishExecution({
      assessmentId: f.assessmentId,
      leaseToken: retry.leaseToken,
      correlationId: randomUUID(),
      toState: Execution.INTERRUPTED,
      checkpointId: nextWait,
      requestIds: [f.request.requestId],
    });
    expect(f.tx.assessmentHumanRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { checkpointId: nextWait },
      }),
    );
  });

  it.each(["revision", "checkpoint", "set", "turn", "native"])(
    "rejects graceful failed review recovery when its %s authorization changed",
    async (mismatch) => {
      const f = reviewFixture();
      const review = await f.authority.claimRoot({
        assessmentId: f.assessmentId,
        correlationId: randomUUID(),
        runtimeRunId: randomUUID(),
      });
      await f.authority.finishExecution({
        assessmentId: f.assessmentId,
        leaseToken: review.leaseToken,
        correlationId: randomUUID(),
        toState: Execution.FAILED,
        checkpointId: randomUUID(),
      });
      if (mismatch === "revision") f.request.requestRevision += 1;
      if (mismatch === "checkpoint")
        f.request.answers[0].checkpointId = randomUUID();
      if (mismatch === "set")
        f.tx.assessmentHumanRequest.findMany.mockResolvedValue([
          f.request,
          { ...f.request, requestId: randomUUID() },
        ]);
      if (mismatch === "turn") f.turn.threadId = randomUUID();
      if (mismatch === "native")
        Object.assign(f.turn, {
          checkpointJson: { checkpointId: randomUUID() },
        });
      await expect(
        f.authority.claimRoot({
          assessmentId: f.assessmentId,
          correlationId: randomUUID(),
          runtimeRunId: randomUUID(),
        }),
      ).rejects.toMatchObject({ status: 409 });
    },
  );

  it("keeps the failed checkpoint producer across retry transport recovery and another graceful failure", async () => {
    const f = reviewFixture();
    const originalCheckpoint = f.row.checkpointId;
    const originalExecution = f.row.currentExecutionId;
    const initial = await f.authority.claimRoot({
      assessmentId: f.assessmentId,
      correlationId: randomUUID(),
      runtimeRunId: randomUUID(),
    });
    const failedCheckpoint = randomUUID();
    await f.authority.finishExecution({
      assessmentId: f.assessmentId,
      leaseToken: initial.leaseToken,
      correlationId: randomUUID(),
      toState: Execution.FAILED,
      checkpointId: failedCheckpoint,
    });
    const retryRun = randomUUID();
    const retry = await f.authority.claimRoot({
      assessmentId: f.assessmentId,
      correlationId: randomUUID(),
      runtimeRunId: retryRun,
    });
    // The fixture has one mutable turn; model the new retry row created by the real upsert.
    Object.assign(f.turn, { id: retry.executionId });
    const recovered = await f.authority.claimRoot({
      assessmentId: f.assessmentId,
      correlationId: randomUUID(),
      runtimeRunId: retryRun,
    });
    expect(recovered.executionId).toBe(retry.executionId);
    expect(recovered.recoveredExecution).toBe(true);
    expect(recovered.humanAnswerReviewExecutionId).toBe(originalExecution);
    expect(recovered.humanAnswerReviewCheckpointId).toBe(originalCheckpoint);
    expect(recovered.resumeCheckpointId).toBe(failedCheckpoint);
    await expect(
      f.authority.authorize({
        assessmentId: f.assessmentId,
        leaseToken: retry.leaseToken,
        correlationId: randomUUID(),
        requireActive: false,
      }),
    ).rejects.toMatchObject({ status: 403 });
    const secondFailure = randomUUID();
    await f.authority.finishExecution({
      assessmentId: f.assessmentId,
      leaseToken: recovered.leaseToken,
      correlationId: randomUUID(),
      toState: Execution.FAILED,
      checkpointId: secondFailure,
    });
    const third = await f.authority.claimRoot({
      assessmentId: f.assessmentId,
      correlationId: randomUUID(),
      runtimeRunId: randomUUID(),
    });
    expect(third.executionId).not.toBe(retry.executionId);
    expect(third.humanAnswerReviewExecutionId).toBe(retry.executionId);
    expect(third.humanAnswerReviewCheckpointId).toBe(originalCheckpoint);
    expect(third.resumeCheckpointId).toBe(secondFailure);
  });

  it("permits failed blocked-review checkpoint settlement without granting another UNKNOWN reasoning turn", async () => {
    const f = reviewFixture();
    const originalCheckpoint = f.row.checkpointId;
    const originalExecution = f.row.currentExecutionId;
    const review = await f.authority.claimRoot({
      assessmentId: f.assessmentId,
      correlationId: randomUUID(),
      runtimeRunId: randomUUID(),
    });
    Object.assign(f.row, {
      lifecycleState: Lifecycle.BLOCKED,
      blockerReason: "HUMAN_FACT_UNRESOLVABLE",
      blockerReference: { humanResolutionRequestId: f.request.requestId },
    });
    f.tx.assessmentHumanRequest.count.mockResolvedValue(1);
    const failedCheckpoint = randomUUID();
    await f.authority.finishExecution({
      assessmentId: f.assessmentId,
      leaseToken: review.leaseToken,
      correlationId: randomUUID(),
      toState: Execution.FAILED,
      checkpointId: failedCheckpoint,
    });
    const retry = await f.authority.claimRoot({
      assessmentId: f.assessmentId,
      correlationId: randomUUID(),
      runtimeRunId: randomUUID(),
    });
    expect(retry.humanAnswerReviewRequired).toBe(false);
    expect(retry.humanAnswerReviewCheckpointId).toBe(originalCheckpoint);
    expect(retry.humanAnswerReviewExecutionId).toBe(originalExecution);
    expect(retry.resumeCheckpointId).toBe(failedCheckpoint);
    expect(retry.lifecycleState).toBe(Lifecycle.BLOCKED);
  });
  function selectedReviewFixture() {
    const f = reviewFixture();
    const auditRequestId = randomUUID();
    Object.assign(f.row, { currentAuditRequestId: auditRequestId });
    Object.assign(f.turn.contextJson, {
      auditRequestId,
      checkpointThreadId: auditRequestId,
    });
    f.tx.assessmentCase.findUnique.mockResolvedValue(
      Object.assign(
        {
          ruleSetVersionId: f.ruleSetVersionId,
          repositorySnapshotId: f.repositorySnapshotId,
          repositoryCommit: f.repositoryCommit,
        },
        { auditMode: ASSESSMENT_AUDIT_MODES.CUSTOMER_SELECTED },
      ),
    );
    const audit = {
      requestId: auditRequestId,
      assessmentId: f.assessmentId,
      status: RULE_AUDIT_STATUSES.WAITING_FOR_CUSTOMER,
    };
    const membership = jest.fn(async () => [{ assessmentRuleId: "RULE-A" }]);
    Object.assign(f.tx, {
      assessmentRuleAuditItem: { findMany: membership },
      assessmentRuleAuditRequest: {
        findUnique: jest.fn(async () => audit),
        findUniqueOrThrow: jest.fn(async () => audit),
        update: jest.fn(async () => audit),
      },
    });
    return { ...f, auditRequestId, membership };
  }

  it("preserves selected audit thread identity through UNKNOWN review and the next wait", async () => {
    const f = selectedReviewFixture();
    const claim = await f.authority.claimRoot({
      assessmentId: f.assessmentId,
      correlationId: randomUUID(),
      runtimeRunId: randomUUID(),
    });
    expect(claim.humanAnswerReviewRequired).toBe(true);
    expect(claim.checkpointThreadId).toBe(f.auditRequestId);
    expect(f.turn.contextJson).toMatchObject({
      auditRequestId: f.auditRequestId,
      checkpointThreadId: f.auditRequestId,
    });
    await f.authority.finishExecution({
      assessmentId: f.assessmentId,
      leaseToken: claim.leaseToken,
      correlationId: randomUUID(),
      toState: Execution.INTERRUPTED,
      checkpointId: randomUUID(),
      requestIds: [f.request.requestId],
    });
    expect(f.tx.assessmentHumanRequest.updateMany).toHaveBeenCalledTimes(1);
  });

  it.each(["auditRequestId", "checkpointThreadId"])(
    "rejects UNKNOWN review carried from a different selected %s",
    async (field) => {
      const f = selectedReviewFixture();
      Object.assign(f.turn.contextJson, { [field]: randomUUID() });
      await expect(
        f.authority.claimRoot({
          assessmentId: f.assessmentId,
          correlationId: randomUUID(),
          runtimeRunId: randomUUID(),
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(f.tx.assessmentRuntime.update).not.toHaveBeenCalled();
    },
  );

  it.each(["auditRequestId", "checkpointThreadId"])(
    "does not rebind a wait from a turn with foreign %s metadata",
    async (field) => {
      const f = selectedReviewFixture();
      const claim = await f.authority.claimRoot({
        assessmentId: f.assessmentId,
        correlationId: randomUUID(),
        runtimeRunId: randomUUID(),
      });
      Object.assign(f.turn.contextJson, { [field]: randomUUID() });
      await expect(
        f.authority.finishExecution({
          assessmentId: f.assessmentId,
          leaseToken: claim.leaseToken,
          correlationId: randomUUID(),
          toState: Execution.INTERRUPTED,
          checkpointId: randomUUID(),
          requestIds: [f.request.requestId],
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(f.tx.assessmentHumanRequest.updateMany).not.toHaveBeenCalled();
    },
  );

  it("rejects a selected review when authoritative membership is missing", async () => {
    const f = selectedReviewFixture();
    f.membership.mockResolvedValueOnce([]);
    await expect(
      f.authority.claimRoot({
        assessmentId: f.assessmentId,
        correlationId: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.tx.assessmentRuntime.update).not.toHaveBeenCalled();
  });
});
