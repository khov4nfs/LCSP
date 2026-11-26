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
const web = {
  repositoryKey: "web",
  ordinal: 0,
  connectionId: "connection-1",
  repositoryId: "repository-1",
  repositoryFullName: "acme/web",
  repositorySnapshotId: "snapshot-1",
  repositoryScanJobId: "scan-job-1",
  repositoryCommit,
  sourcePathPrefix: null,
};
const api = {
  repositoryKey: "api",
  ordinal: 1,
  connectionId: "connection-2",
  repositoryId: "repository-2",
  repositoryFullName: "acme/api",
  repositorySnapshotId: "snapshot-2",
  repositoryScanJobId: "scan-job-2",
  repositoryCommit: "b".repeat(40),
  sourcePathPrefix: "services/billing",
};
const pins = {
  assessmentId,
  caseRevision: 0,
  ruleSetVersionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  repositorySnapshotId: web.repositorySnapshotId,
  repositoryId: web.repositoryId,
  repositoryScanJobId: web.repositoryScanJobId,
  repositoryCommit,
  sourcePathPrefix: null,
  repositorySetDigest: `sha256:${"1".repeat(64)}`,
  repositories: [web],
  repositorySetRecorded: true,
};
const pairPins = {
  ...pins,
  repositorySetDigest: `sha256:${"2".repeat(64)}`,
  repositories: [web, api],
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
  repositoryKey: string | null;
  discoveryBatchId: string | null;
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
    findMany: jest.fn(
      ({
        where,
      }: {
        where: { idempotencyKey?: { in: string[] }; OR?: unknown };
      }) => {
        const all = [...rows.values()];
        // Idempotency lookups filter by key; the "latest" lookup lists runs newest first.
        return Promise.resolve(
          where.idempotencyKey
            ? all.filter((r) =>
                where.idempotencyKey?.in.includes(r.idempotencyKey),
              )
            : [...all].reverse(),
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
    loadPins: jest.fn(() => Promise.resolve<typeof pairPins>(pins)),
  };
  const discoveries = {
    getOwnerSummary: jest.fn(() =>
      Promise.resolve({
        available: false,
        discovery: null,
      }),
    ),
    saveAuthorizedInTx: jest.fn((tx: unknown, input: unknown) => {
      void tx;
      void input;
      return Promise.resolve({
        recordId: randomUUID(),
        replayed: false,
      });
    }),
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
    const batch = await service.start(request());
    const result = batch.run;
    expect(result.status).toBe(AssessmentDiscoveryRunStatus.QUEUED);
    expect(result.discovery.available).toBe(false);
    expect(batch.runs).toHaveLength(1);
    expect(result.repositoryKey).toBe("web");
    expect(rows.size).toBe(1);
    expect(tx.assessmentRuntime.findUnique).toHaveBeenCalled();
    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: ASSESSMENT_DISCOVERY_COMMAND_TYPES.DISCOVERY_REQUESTED,
        payload: expect.objectContaining({
          assessmentId,
          runId: result.runId,
        }),
      }),
      expect.anything(),
    );
  });

  it("replays a matching idempotency key without enqueuing twice", async () => {
    const { service, outbox } = fixture();
    const original = request();
    const first = await service.start(original);
    const second = await service.start(original);
    expect(second.run.runId).toBe(first.run.runId);
    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
  });

  it("preserves an authorized discovery history after an assessment changes lifecycle", async () => {
    const { service, setLifecycle, setAuditRequest, outbox } = fixture();
    const original = request();
    const run = (await service.start(original)).run;
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
    if (latest.available) expect(latest.runs).toHaveLength(1);
    const replay = await service.start(original);
    expect(replay.run.runId).toBe(run.runId);
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
    const result = (await service.start(request())).run;
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
    const result = (await service.start(request())).run;
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
    const first = (await service.start(request())).run;
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
    const second = (await service.start(request())).run;
    expect(second.runId).not.toBe(first.runId);
    expect(outbox.enqueue).toHaveBeenCalledTimes(2);
  });

  it("accepts one scan result and replays only the identical worker digest", async () => {
    const { service, rows, discoveries } = fixture();
    const started = (await service.start(request())).run;
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
    const started = (await service.start(request())).run;
    const claim = await service.claim({
      assessmentId,
      runId: started.runId,
      correlationId,
    });
    support.loadPins.mockResolvedValue({
      ...pins,
      repositoryCommit: "b".repeat(40),
      repositories: [{ ...web, repositoryCommit: "b".repeat(40) }],
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
    const result = (await service.start(request())).run;
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

describe("AssessmentDiscoveryRunService repository sets", () => {
  it("starts one run per pinned repository in a shared batch with one command each", async () => {
    const { service, rows, outbox, support } = fixture();
    support.loadPins.mockResolvedValue(pairPins);
    const batch = await service.start(request());
    expect(batch.runs.map((run) => run.repositoryKey)).toEqual(["web", "api"]);
    expect(batch.run.repositoryKey).toBe("web");
    expect(new Set(batch.runs.map((run) => run.discoveryBatchId)).size).toBe(1);
    expect(batch.batchId).toBe(batch.run.discoveryBatchId);
    expect(rows.size).toBe(2);
    expect(outbox.enqueue).toHaveBeenCalledTimes(2);
    const [first, second] = [...rows.values()];
    expect(first?.idempotencyKey).not.toBe(second?.idempotencyKey);
    expect(second?.repositorySnapshotId).toBe("snapshot-2");
    expect(second?.sourcePathPrefix).toBe("services/billing");
    expect(second?.repositoryScanJobId).toBe("scan-job-2");
  });

  it("replays a repository-set batch without creating or enqueuing again", async () => {
    const { service, rows, outbox, support } = fixture();
    support.loadPins.mockResolvedValue(pairPins);
    const original = request();
    const first = await service.start(original);
    const replay = await service.start(original);
    expect(replay.runs.map((run) => run.runId)).toEqual(
      first.runs.map((run) => run.runId),
    );
    expect(rows.size).toBe(2);
    expect(outbox.enqueue).toHaveBeenCalledTimes(2);
  });

  it("refuses to reuse a key after the pinned set changed", async () => {
    const { service, support } = fixture();
    support.loadPins.mockResolvedValue(pairPins);
    const original = request();
    await service.start(original);
    support.loadPins.mockResolvedValue({
      ...pairPins,
      repositorySetDigest: `sha256:${"3".repeat(64)}`,
    });
    await expect(service.start(original)).rejects.toThrow();
  });

  it("claims each run with its own repository coordinates and settles it against that pin", async () => {
    const { service, support, discoveries } = fixture();
    support.loadPins.mockResolvedValue(pairPins);
    const batch = await service.start(request());
    const second = batch.runs[1];
    const claim = await service.claim({
      assessmentId,
      runId: second.runId,
      correlationId,
    });
    expect(claim).toMatchObject({
      repositoryKey: "api",
      repositorySnapshotId: "snapshot-2",
      repositoryId: "repository-2",
      repositoryCommit: "b".repeat(40),
      sourcePathPrefix: "services/billing",
      repositoryScanJobId: "scan-job-2",
    });
    const discovery = { contentDigest: `sha256:${"a".repeat(64)}` } as never;
    await service.complete({
      assessmentId,
      runId: second.runId,
      correlationId,
      leaseToken: claim.leaseToken,
      discovery,
    });
    expect(discoveries.saveAuthorizedInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ repositoryKey: "api", discovery }),
    );
  });

  it("denies a run of one repository once only that repository's pin has changed", async () => {
    const { service, support, discoveries } = fixture();
    support.loadPins.mockResolvedValue(pairPins);
    const batch = await service.start(request());
    const second = batch.runs[1];
    const claim = await service.claim({
      assessmentId,
      runId: second.runId,
      correlationId,
    });
    support.loadPins.mockResolvedValue({
      ...pairPins,
      repositories: [web, { ...api, repositoryCommit: "c".repeat(40) }],
    });
    await expect(
      service.complete({
        assessmentId,
        runId: second.runId,
        correlationId,
        leaseToken: claim.leaseToken,
        discovery: { contentDigest: `sha256:${"a".repeat(64)}` } as never,
      }),
    ).rejects.toThrow();
    expect(discoveries.saveAuthorizedInTx).not.toHaveBeenCalled();
    // The untouched repository's run is still claimable.
    await expect(
      service.claim({
        assessmentId,
        runId: batch.runs[0].runId,
        correlationId,
      }),
    ).resolves.toMatchObject({ repositoryKey: "web" });
  });

  it("restores the whole newest batch, primary repository first", async () => {
    const { service, support } = fixture();
    support.loadPins.mockResolvedValue(pairPins);
    const batch = await service.start(request());
    const latest = await service.latest({
      assessmentId,
      ownerId,
      correlationId,
    });
    expect(latest.available).toBe(true);
    if (latest.available) {
      expect(latest.runs.map((run) => run.runId)).toEqual(
        batch.runs.map((run) => run.runId),
      );
      expect(latest.run.repositoryKey).toBe("web");
    }
  });

  it("does not show a run whose repository is no longer pinned", async () => {
    const { service, support } = fixture();
    support.loadPins.mockResolvedValue(pairPins);
    const batch = await service.start(request());
    support.loadPins.mockResolvedValue(pins);
    await expect(
      service.get({
        assessmentId,
        ownerId,
        correlationId,
        runId: batch.runs[1].runId,
      }),
    ).rejects.toThrow();
  });
});
