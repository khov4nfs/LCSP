import { randomUUID } from "node:crypto";

import { describe, expect, it, jest } from "@jest/globals";
import { ASSESSMENT_LIFECYCLE_STATES } from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_AUDIT_MODES,
  ASSESSMENT_DISCOVERY_COMMAND_TYPES,
} from "@lcsp/contracts/assessment-domain";
import { AssessmentDiscoveryRunStatus } from "@prisma/client";

import { AssessmentDiscoveryRunService } from "./assessment-discovery-run.service.js";
import type { AssessmentRepositoryDiscoveryService } from "./assessment-repository-discovery.service.js";
import type { AssessmentCaseSupport } from "../../infrastructure/persistence/assessment-case-support.service.js";
import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import type { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";

const assessmentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ownerId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const correlationId = "corr-discovery-test";
const repositoryCommit = "a".repeat(40);
const pins = {
  assessmentId,
  caseRevision: 0,
  ruleSetVersionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  repositorySnapshotId: "snapshot-1",
  repositoryId: "repository-1",
  repositoryScanJobId: "scan-job-1",
  repositoryCommit,
  sourcePathPrefix: null,
};

type TestRun = {
  runId: string;
  assessmentId: string;
  requestedBy: string;
  idempotencyKey: string;
  requestDigest: string;
  status: AssessmentDiscoveryRunStatus;
  attempt: number;
  repositorySnapshotId: string;
  repositoryId: string;
  repositoryCommit: string;
  sourcePathPrefix: string | null;
  repositoryScanJobId: string;
  threadId: string;
  leaseToken: string | null;
  leaseExpiresAt: Date | null;
  discoveryRecordId: string | null;
  workerContentDigest: string | null;
  errorCode: string | null;
  requestedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
};

function fixture() {
  const rows = new Map<string, TestRun>();
  let currentOwner = ownerId;
  let currentAuditRequestId: string | null = null;
  let currentLifecycle: (typeof ASSESSMENT_LIFECYCLE_STATES)[keyof typeof ASSESSMENT_LIFECYCLE_STATES] =
    ASSESSMENT_LIFECYCLE_STATES.ACTIVE;
  const runQueries = {
    findUnique: jest.fn(
      ({
        where,
      }: {
        where: {
          runId?: string;
          assessmentId_idempotencyKey?: {
            assessmentId: string;
            idempotencyKey: string;
          };
        };
      }) => {
        if (where.runId) return Promise.resolve(rows.get(where.runId) ?? null);
        const input = where.assessmentId_idempotencyKey;
        return Promise.resolve(
          [...rows.values()].find(
            (r) =>
              r.assessmentId === input?.assessmentId &&
              r.idempotencyKey === input?.idempotencyKey,
          ) ?? null,
        );
      },
    ),
    findFirst: jest.fn(() =>
      Promise.resolve(
        [...rows.values()].find(
          (r) =>
            r.status === AssessmentDiscoveryRunStatus.QUEUED ||
            r.status === AssessmentDiscoveryRunStatus.RUNNING,
        ) ?? null,
      ),
    ),
    create: jest.fn(
      ({
        data,
      }: {
        data: Omit<
          TestRun,
          | "status"
          | "attempt"
          | "leaseToken"
          | "leaseExpiresAt"
          | "discoveryRecordId"
          | "workerContentDigest"
          | "errorCode"
          | "requestedAt"
          | "startedAt"
          | "completedAt"
          | "failedAt"
        >;
      }) => {
        const row: TestRun = {
          ...data,
          status: AssessmentDiscoveryRunStatus.QUEUED,
          attempt: 1,
          leaseToken: null,
          leaseExpiresAt: null,
          discoveryRecordId: null,
          workerContentDigest: null,
          errorCode: null,
          requestedAt: new Date("2026-11-17T00:00:00.000Z"),
          startedAt: null,
          completedAt: null,
          failedAt: null,
        };
        rows.set(row.runId, row);
        return Promise.resolve(row);
      },
    ),
    update: jest.fn(
      ({
        where,
        data,
      }: {
        where: { runId: string };
        data: Record<string, unknown>;
      }) => {
        const row = rows.get(where.runId);
        if (!row) throw new Error("missing fixture run");
        for (const [key, value] of Object.entries(data)) {
          if (
            key === "attempt" &&
            value &&
            typeof value === "object" &&
            "increment" in value
          ) {
            row.attempt += Number(value.increment);
          } else {
            Object.assign(row, { [key]: value });
          }
        }
        return Promise.resolve(row);
      },
    ),
  };
  const tx = {
    assessment: {
      findUnique: jest.fn(() =>
        Promise.resolve({
          ownerId: currentOwner,
          lifecycleState: currentLifecycle,
          domainCase: { auditMode: ASSESSMENT_AUDIT_MODES.CUSTOMER_SELECTED },
        }),
      ),
    },
    assessmentRuntime: {
      findUnique: jest.fn(() => Promise.resolve({ currentAuditRequestId })),
    },
    assessmentDiscoveryRun: runQueries,
  };
  const prisma = {
    $transaction: jest.fn((callback: (client: unknown) => Promise<unknown>) =>
      callback(tx),
    ),
  };
  const outbox = {
    enqueue: jest.fn((command: unknown, transaction: unknown) => {
      void command;
      void transaction;
      return Promise.resolve("outbox-1");
    }),
  };
  const support = {
    lockCase: jest.fn(() => Promise.resolve(undefined)),
    loadPins: jest.fn(() => Promise.resolve(pins)),
  };
  const discoveries = {
    getOwnerSummary: jest.fn(() =>
      Promise.resolve({
        available: false,
        discovery: null,
      }),
    ),
    saveAuthorizedInTx: jest.fn(() =>
      Promise.resolve({
        recordId: randomUUID(),
        replayed: false,
      }),
    ),
  };
  const service = new AssessmentDiscoveryRunService(
    prisma as unknown as PrismaService,
    outbox as unknown as OutboxRepository,
    support as unknown as AssessmentCaseSupport,
    discoveries as unknown as AssessmentRepositoryDiscoveryService,
  );
  return {
    service,
    rows,
    tx,
    runQueries,
    outbox,
    support,
    discoveries,
    setOwner: (value: string) => {
      currentOwner = value;
    },
    setAuditRequest: (value: string | null) => {
      currentAuditRequestId = value;
    },
    setLifecycle: (value: typeof currentLifecycle) => {
      currentLifecycle = value;
    },
  };
}

function request(key = randomUUID()) {
  return { assessmentId, ownerId, correlationId, idempotencyKey: key };
}

describe("AssessmentDiscoveryRunService pre-scope authority", () => {
  it("creates an authorized queued run and durable command without opening an audit", async () => {
    const { service, rows, outbox, tx } = fixture();
    const result = await service.start(request());
    expect(result.status).toBe(AssessmentDiscoveryRunStatus.QUEUED);
    expect(result.discovery.available).toBe(false);
    expect(rows.size).toBe(1);
    expect(tx.assessmentRuntime.findUnique).toHaveBeenCalled();
    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: ASSESSMENT_DISCOVERY_COMMAND_TYPES.DISCOVERY_REQUESTED,
        payload: expect.objectContaining({ assessmentId, runId: result.runId }),
      }),
      expect.anything(),
    );
  });

  it("replays a matching idempotency key without enqueuing twice", async () => {
    const { service, outbox } = fixture();
    const original = request();
    const first = await service.start(original);
    const second = await service.start(original);
    expect(second.runId).toBe(first.runId);
    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
  });

  it("preserves an authorized discovery history after an assessment changes lifecycle", async () => {
    const { service, setLifecycle, setAuditRequest, outbox } = fixture();
    const original = request();
    const run = await service.start(original);
    setLifecycle(ASSESSMENT_LIFECYCLE_STATES.PAUSED);
    setAuditRequest("later-selected-audit");
    const historical = await service.get({
      assessmentId,
      ownerId,
      correlationId,
      runId: run.runId,
    });
    expect(historical.runId).toBe(run.runId);
    const latest = await service.latest({
      assessmentId,
      ownerId,
      correlationId,
    });
    expect(latest.available).toBe(true);
    if (latest.available) expect(latest.run.runId).toBe(run.runId);
    const replay = await service.start(original);
    expect(replay.runId).toBe(run.runId);
    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
  });

  it("rejects foreign owners, inactive assessments and already selected scopes", async () => {
    const { service, outbox, setOwner, setAuditRequest, setLifecycle } =
      fixture();
    setOwner("foreign-owner");
    await expect(service.start(request())).rejects.toThrow();
    setOwner(ownerId);
    setLifecycle(ASSESSMENT_LIFECYCLE_STATES.PAUSED);
    await expect(service.start(request())).rejects.toThrow();
    setLifecycle(ASSESSMENT_LIFECYCLE_STATES.ACTIVE);
    setAuditRequest("rule-audit");
    await expect(service.start(request())).rejects.toThrow();
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it("grants one scan lease and denies a concurrent worker", async () => {
    const { service, rows } = fixture();
    const result = await service.start(request());
    const claim = await service.claim({
      assessmentId,
      runId: result.runId,
      correlationId,
    });
    expect(claim.alreadyCompleted).toBe(false);
    expect(claim.repositoryCommit).toBe(repositoryCommit);
    expect(rows.get(result.runId)?.status).toBe(
      AssessmentDiscoveryRunStatus.RUNNING,
    );
    await expect(
      service.claim({ assessmentId, runId: result.runId, correlationId }),
    ).rejects.toThrow();
  });

  it("fails closed on invalid worker leases without saving discovery", async () => {
    const { service, discoveries } = fixture();
    const result = await service.start(request());
    await service.claim({ assessmentId, runId: result.runId, correlationId });
    await expect(
      service.complete({
        assessmentId,
        runId: result.runId,
        correlationId,
        leaseToken: randomUUID(),
        discovery: {} as never,
      }),
    ).rejects.toThrow();
    expect(discoveries.saveAuthorizedInTx).not.toHaveBeenCalled();
  });

  it("settles only a current failed run and allows an owner to retry with a new request key", async () => {
    const { service, rows, outbox } = fixture();
    const first = await service.start(request());
    const claim = await service.claim({
      assessmentId,
      runId: first.runId,
      correlationId,
    });
    await service.fail({
      assessmentId,
      runId: first.runId,
      correlationId,
      leaseToken: claim.leaseToken,
      errorCode: "DISCOVERY_SCAN_FAILED",
    });
    expect(rows.get(first.runId)?.status).toBe(
      AssessmentDiscoveryRunStatus.FAILED,
    );
    const second = await service.start(request());
    expect(second.runId).not.toBe(first.runId);
    expect(outbox.enqueue).toHaveBeenCalledTimes(2);
  });

  it("accepts one scan result and replays only the identical worker digest", async () => {
    const { service, rows, discoveries } = fixture();
    const started = await service.start(request());
    const claim = await service.claim({
      assessmentId,
      runId: started.runId,
      correlationId,
    });
    const discovery = {
      contentDigest: `sha256:${"a".repeat(64)}`,
    } as never;
    const saved = await service.complete({
      assessmentId,
      runId: started.runId,
      correlationId,
      leaseToken: claim.leaseToken,
      discovery,
    });
    expect(saved.replayed).toBe(false);
    const row = rows.get(started.runId);
    expect(row?.status).toBe(AssessmentDiscoveryRunStatus.COMPLETED);
    expect(row?.workerContentDigest).toBe(`sha256:${"a".repeat(64)}`);
    const replayed = await service.complete({
      assessmentId,
      runId: started.runId,
      correlationId,
      leaseToken: claim.leaseToken,
      discovery,
    });
    expect(replayed).toEqual({
      recordId: saved.recordId,
      replayed: true,
    });
    expect(discoveries.saveAuthorizedInTx).toHaveBeenCalledTimes(1);
  });

  it("denies scan result after the pinned source coordinates have changed", async () => {
    const { service, support, discoveries } = fixture();
    const started = await service.start(request());
    const claim = await service.claim({
      assessmentId,
      runId: started.runId,
      correlationId,
    });
    support.loadPins.mockResolvedValue({
      ...pins,
      repositoryCommit: "b".repeat(40),
    });
    await expect(
      service.complete({
        assessmentId,
        runId: started.runId,
        correlationId,
        leaseToken: claim.leaseToken,
        discovery: { contentDigest: `sha256:${"a".repeat(64)}` } as never,
      }),
    ).rejects.toThrow();
    expect(discoveries.saveAuthorizedInTx).not.toHaveBeenCalled();
  });

  it("rejects a different result after the original scan lease has completed", async () => {
    const { service, rows } = fixture();
    const result = await service.start(request());
    const claim = await service.claim({
      assessmentId,
      runId: result.runId,
      correlationId,
    });
    const original = rows.get(result.runId);
    if (!original) throw new Error("run fixture not created");
    original.status = AssessmentDiscoveryRunStatus.COMPLETED;
    original.discoveryRecordId = randomUUID();
    original.workerContentDigest = `sha256:${"a".repeat(64)}`;
    await expect(
      service.complete({
        assessmentId,
        runId: result.runId,
        correlationId,
        leaseToken: claim.leaseToken,
        discovery: { contentDigest: `sha256:${"b".repeat(64)}` } as never,
      }),
    ).rejects.toThrow();
  });
});
