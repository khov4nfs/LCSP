import { randomUUID } from "node:crypto";
import { jest } from "@jest/globals";
import {
  AGENT_EXECUTION_STATES,
  ASSESSMENT_LIFECYCLE_STATES,
  DECISION_RESOLUTION_STATES,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_AUDIT_MODES,
  ASSESSMENT_DECISION_RECORD_STATES,
  RULE_AUDIT_PROGRESS_STATES,
  RULE_AUDIT_SCOPE_MODES,
  RULE_AUDIT_STATUSES,
  type SubmitRuleAudit,
} from "@lcsp/contracts/assessment-domain";
import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import type { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";
import type { AssessmentCaseSupport } from "../../infrastructure/persistence/assessment-case-support.service.js";
import { AssessmentRuleAuditService } from "./assessment-rule-audit.service.js";

const ASSESSMENT = randomUUID();
const OWNER = randomUUID();
const RULE_SET = randomUUID();
const SNAPSHOT = randomUUID();
const COMMIT = "a".repeat(40);
const REQUEST = randomUUID();
const DECISION = randomUUID();
const rules = Array.from({ length: 20 }, (_, index) => ({
  assessmentRuleId: `Rule-${index + 1}`,
  assessmentRuleVersion: "v1",
}));

function submission(ruleIds: string[]): SubmitRuleAudit {
  return {
    idempotencyKey: randomUUID(),
    expectedAuditRevision: 0,
    ruleSetVersionId: RULE_SET,
    ruleSetDigest: "digest",
    repositorySnapshotId: SNAPSHOT,
    repositoryCommit: COMMIT,
    scopeMode: RULE_AUDIT_SCOPE_MODES.SELECTED_RULES,
    rules: rules.filter((rule) => ruleIds.includes(rule.assessmentRuleId)),
  };
}

function submitFixture() {
  const created = jest
    .fn<(input: unknown) => Promise<unknown>>()
    .mockResolvedValue({});
  const coverageCreated = jest
    .fn<(input: unknown) => Promise<unknown>>()
    .mockResolvedValue({ count: 1 });
  const enqueued = jest
    .fn<(input: unknown, tx: unknown) => Promise<string>>()
    .mockResolvedValue("outbox-id");
  const requestFind = jest
    .fn<(input: unknown) => Promise<unknown>>()
    .mockResolvedValue(null);
  const tx = {
    $queryRaw: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([1]),
    assessment: {
      findUnique: jest.fn<() => Promise<unknown>>().mockResolvedValue({
        id: ASSESSMENT,
        ownerId: OWNER,
        lifecycleState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
        domainCase: {
          assessmentId: ASSESSMENT,
          auditMode: ASSESSMENT_AUDIT_MODES.CUSTOMER_SELECTED,
          auditRequestRevision: 0,
          caseRevision: 0,
          ruleSetVersionId: RULE_SET,
          repositorySnapshotId: SNAPSHOT,
          repositoryCommit: COMMIT,
        },
      }),
    },
    complianceRuleSetVersion: {
      findUnique: jest.fn<() => Promise<unknown>>().mockResolvedValue({
        id: RULE_SET,
        ruleSetDigest: "digest",
      }),
    },
    assessmentRuleAuditRequest: {
      findUnique: requestFind,
      findFirst: jest.fn<() => Promise<unknown>>().mockResolvedValue(null),
      create: created,
      update: jest.fn<() => Promise<unknown>>().mockResolvedValue({}),
    },
    assessmentRule: {
      findMany: jest.fn<() => Promise<unknown>>().mockResolvedValue(rules),
    },
    assessmentRuntime: {
      findUniqueOrThrow: jest.fn<() => Promise<unknown>>().mockResolvedValue({
        leaseToken: null,
        executionState: AGENT_EXECUTION_STATES.QUEUED,
      }),
      update: jest.fn<() => Promise<unknown>>().mockResolvedValue({}),
    },
    assessmentDecisionCoverage: {
      findMany: jest.fn<() => Promise<unknown>>().mockResolvedValue([]),
      createMany: coverageCreated,
    },
    assessmentCase: {
      update: jest.fn<() => Promise<unknown>>().mockResolvedValue({}),
    },
    outboxMessage: {
      upsert: jest.fn<() => Promise<unknown>>().mockResolvedValue({}),
    },
  };
  const prisma = {
    $transaction: (callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
  };
  const service = new AssessmentRuleAuditService(
    prisma as unknown as PrismaService,
    { enqueue: enqueued } as unknown as OutboxRepository,
    {} as AssessmentCaseSupport,
  );
  jest
    .spyOn(service, "request")
    .mockImplementation(
      async (_assessment, _owner, _correlation, requestId) =>
        ({ requestId }) as never,
    );
  return { service, tx, created, coverageCreated, enqueued, requestFind };
}

it("freezes only Rule 3 from a 20-rule catalog and dispatches Root once", async () => {
  const f = submitFixture();
  const result = await f.service.submit(
    ASSESSMENT,
    OWNER,
    randomUUID(),
    submission(["Rule-3"]),
  );

  expect(result.requestId).toBeDefined();
  const created = f.created.mock.calls[0][0] as {
    data: { rules: { create: typeof rules } };
  };
  const coverage = f.coverageCreated.mock.calls[0][0] as {
    data: typeof rules;
  };
  expect(
    created.data.rules.create.map((rule) => rule.assessmentRuleId),
  ).toEqual(["Rule-3"]);
  expect(coverage.data.map((rule) => rule.assessmentRuleId)).toEqual([
    "Rule-3",
  ]);
  expect(f.enqueued).toHaveBeenCalledTimes(1);
});

it("rejects duplicate, foreign and stale selections before any dispatch", async () => {
  for (const body of [
    { ...submission(["Rule-3"]), rules: [rules[2], rules[2]] },
    {
      ...submission(["Rule-3"]),
      rules: [{ assessmentRuleId: "foreign", assessmentRuleVersion: "v1" }],
    },
    { ...submission(["Rule-3"]), expectedAuditRevision: 1 },
  ]) {
    const f = submitFixture();
    await expect(
      f.service.submit(ASSESSMENT, OWNER, randomUUID(), body),
    ).rejects.toThrow();
    expect(f.created).not.toHaveBeenCalled();
    expect(f.enqueued).not.toHaveBeenCalled();
  }
});

it("replays the same selection key without duplicate rows or Root work", async () => {
  const f = submitFixture();
  const body = submission(["Rule-3", "Rule-9"]);
  const first = await f.service.submit(ASSESSMENT, OWNER, randomUUID(), body);
  const data = (
    f.created.mock.calls[0][0] as { data: { requestDigest: string } }
  ).data;
  f.requestFind.mockResolvedValue({
    requestId: first.requestId,
    requestDigest: data.requestDigest,
  });

  await f.service.submit(ASSESSMENT, OWNER, randomUUID(), body);

  expect(f.created).toHaveBeenCalledTimes(1);
  expect(f.coverageCreated).toHaveBeenCalledTimes(1);
  expect(f.enqueued).toHaveBeenCalledTimes(1);
});

it("versions a later Rule 9 request and reuses an unchanged accepted Rule 3 decision", async () => {
  const f = submitFixture();
  f.tx.assessment.findUnique.mockResolvedValue({
    id: ASSESSMENT,
    ownerId: OWNER,
    lifecycleState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
    domainCase: {
      assessmentId: ASSESSMENT,
      auditMode: ASSESSMENT_AUDIT_MODES.CUSTOMER_SELECTED,
      auditRequestRevision: 1,
      caseRevision: 0,
      ruleSetVersionId: RULE_SET,
      repositorySnapshotId: SNAPSHOT,
      repositoryCommit: COMMIT,
    },
  });
  f.tx.assessmentRuleAuditRequest.findFirst.mockResolvedValue({
    status: RULE_AUDIT_STATUSES.COMPLETED,
  });
  f.tx.assessmentDecisionCoverage.findMany.mockResolvedValue([
    {
      assessmentRuleId: "Rule-3",
      assessmentRuleVersion: "v1",
      resolutionState: DECISION_RESOLUTION_STATES.RESOLVED,
      currentDecision: {
        decisionId: DECISION,
        state: ASSESSMENT_DECISION_RECORD_STATES.ACCEPTED,
        caseRevision: 0,
        repositoryCommit: COMMIT,
        ruleSetVersionId: RULE_SET,
      },
    },
  ]);
  const body = {
    ...submission(["Rule-3", "Rule-9"]),
    expectedAuditRevision: 1,
  };

  await f.service.submit(ASSESSMENT, OWNER, randomUUID(), body);

  const created = f.created.mock.calls[0]![0] as {
    data: {
      requestRevision: number;
      rules: {
        create: Array<{
          assessmentRuleId: string;
          reusedDecisionId: string | null;
        }>;
      };
    };
  };
  expect(created.data.requestRevision).toBe(2);
  expect(
    created.data.rules.create.map((rule) => [
      rule.assessmentRuleId,
      rule.reusedDecisionId,
    ]),
  ).toEqual([
    ["Rule-3", DECISION],
    ["Rule-9", null],
  ]);
  expect(f.enqueued).toHaveBeenCalledTimes(1);
});

it("retries a failed frozen request once without clearing its execution checkpoint", async () => {
  const f = submitFixture();
  const key = randomUUID();
  f.tx.assessment.findUnique.mockResolvedValue({
    id: ASSESSMENT,
    ownerId: OWNER,
    lifecycleState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
    domainCase: {
      assessmentId: ASSESSMENT,
      auditMode: ASSESSMENT_AUDIT_MODES.CUSTOMER_SELECTED,
      auditRequestRevision: 1,
      caseRevision: 0,
      ruleSetVersionId: RULE_SET,
      repositorySnapshotId: SNAPSHOT,
      repositoryCommit: COMMIT,
    },
  });
  f.requestFind.mockResolvedValue({
    requestId: REQUEST,
    assessmentId: ASSESSMENT,
    requestRevision: 1,
    status: RULE_AUDIT_STATUSES.FAILED,
    lastRetryKey: null,
    ruleSetVersionId: RULE_SET,
    ruleSetDigest: "digest",
    repositorySnapshotId: SNAPSHOT,
    repositoryCommit: COMMIT,
  });
  f.tx.assessmentRuntime.findUniqueOrThrow.mockResolvedValue({
    leaseToken: null,
    executionState: AGENT_EXECUTION_STATES.FAILED,
    currentAuditRequestId: REQUEST,
    checkpointId: randomUUID(),
  });

  await f.service.retry(ASSESSMENT, OWNER, randomUUID(), REQUEST, key);

  expect(f.tx.assessmentRuleAuditRequest.update).toHaveBeenCalledTimes(1);
  expect(f.tx.assessmentRuntime.update).not.toHaveBeenCalled();
  expect(f.enqueued).toHaveBeenCalledTimes(1);
  f.requestFind.mockResolvedValue({
    requestId: REQUEST,
    assessmentId: ASSESSMENT,
    requestRevision: 1,
    status: RULE_AUDIT_STATUSES.QUEUED,
    lastRetryKey: key,
  });
  await f.service.retry(ASSESSMENT, OWNER, randomUUID(), REQUEST, key);
  expect(f.enqueued).toHaveBeenCalledTimes(1);
});

it("shows Rule 3 ready while Rule 9 investigates or awaits a customer answer", async () => {
  let waiting = false;
  const row = {
    requestId: REQUEST,
    assessmentId: ASSESSMENT,
    requestRevision: 1,
    scopeMode: RULE_AUDIT_SCOPE_MODES.SELECTED_RULES,
    status: RULE_AUDIT_STATUSES.RUNNING,
    ruleSetVersionId: RULE_SET,
    ruleSetDigest: "digest",
    repositorySnapshotId: SNAPSHOT,
    repositoryCommit: COMMIT,
    requestedAt: new Date(),
    completedAt: null,
    assessmentCase: { assessment: { ownerId: OWNER } },
    rules: [
      { ...rules[2], ordinal: 0, reusedDecisionId: null },
      { ...rules[8], ordinal: 1, reusedDecisionId: null },
    ],
  };
  const prisma = {
    assessmentRuleAuditRequest: { findUnique: async () => row },
    assessmentRule: { count: async () => 20 },
    assessmentDecisionCoverage: {
      findMany: async () => [
        {
          assessmentRuleId: "Rule-3",
          resolutionState: DECISION_RESOLUTION_STATES.RESOLVED,
          currentDecisionId: DECISION,
          currentDecision: {
            state: ASSESSMENT_DECISION_RECORD_STATES.ACCEPTED,
          },
        },
        {
          assessmentRuleId: "Rule-9",
          resolutionState: waiting
            ? DECISION_RESOLUTION_STATES.WAITING_FOR_INPUT
            : DECISION_RESOLUTION_STATES.INVESTIGATING,
          currentDecisionId: null,
          currentDecision: null,
        },
      ],
    },
    assessmentHumanRequest: {
      findMany: async () => (waiting ? [{ assessmentRuleId: "Rule-9" }] : []),
    },
    assessmentRuleAuditItem: { findMany: async () => row.rules },
    assessmentRuleDecision: {
      findMany: async () => [
        {
          assessmentRuleId: "Rule-3",
          decisionId: DECISION,
          state: ASSESSMENT_DECISION_RECORD_STATES.ACCEPTED,
        },
      ],
    },
  };
  const service = new AssessmentRuleAuditService(
    prisma as unknown as PrismaService,
    {} as OutboxRepository,
    {} as AssessmentCaseSupport,
  );

  const first = await service.request(ASSESSMENT, OWNER, randomUUID(), REQUEST);
  expect([first.ready, first.requested, first.notRequested]).toEqual([
    1, 2, 18,
  ]);
  expect(first.rules.map((rule) => rule.progress)).toEqual([
    RULE_AUDIT_PROGRESS_STATES.RESULT_READY,
    RULE_AUDIT_PROGRESS_STATES.INVESTIGATING,
  ]);
  waiting = true;
  const second = await service.request(
    ASSESSMENT,
    OWNER,
    randomUUID(),
    REQUEST,
  );
  expect(second.rules.map((rule) => rule.progress)).toEqual([
    RULE_AUDIT_PROGRESS_STATES.RESULT_READY,
    RULE_AUDIT_PROGRESS_STATES.WAITING_FOR_CUSTOMER,
  ]);
  expect(second.rules[0]?.decisionId).toBe(DECISION);
  row.rules.pop();
  const laterScope = await service.request(
    ASSESSMENT,
    OWNER,
    randomUUID(),
    REQUEST,
  );
  expect([
    laterScope.requested,
    laterScope.notRequested,
    laterScope.totalPinned,
  ]).toEqual([1, 19, 20]);
});
