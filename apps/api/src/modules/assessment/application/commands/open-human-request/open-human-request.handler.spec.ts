import { describe, expect, it } from "@jest/globals";
import {
  DECISION_RESOLUTION_STATES,
  HUMAN_RESOLUTION_REQUEST_STATUSES,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_EVIDENCE_TYPES,
  ASSESSMENT_FACT_AUTHORITIES,
  ASSESSMENT_RECORD_STATES,
  FACT_NEED_ENVIRONMENTS,
  FACT_NEED_SUBJECT_KINDS,
  FACT_NEED_TIMEFRAME_KINDS,
  FACT_NEED_VALUE_KINDS,
  HUMAN_RESOLUTION_CONTROL_TYPES,
} from "@lcsp/contracts/assessment-domain";
import { OpenHumanRequestHandler } from "./open-human-request.handler.js";
import { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";

const assessmentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const threadId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const sourceRequestId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function fixture(options: { selectedRuleIds?: string[] } = {}) {
  const selectedRuleIds =
    options.selectedRuleIds === undefined
      ? null
      : new Set(options.selectedRuleIds);
  const dependencyWrites: string[] = [];
  const requests: Array<Record<string, unknown>> = [];
  const factNeeds: Array<Record<string, unknown>> = [];
  const dependencies: Array<Record<string, unknown>> = [];
  const receipts: Array<Record<string, unknown>> = [];
  const coverage = new Map<
    string,
    { assessmentRuleId: string; resolutionState: string }
  >(
    ["RULE-A", "RULE-B", "RULE-C"].map((id) => [
      id,
      {
        assessmentRuleId: id,
        resolutionState: DECISION_RESOLUTION_STATES.PENDING,
      },
    ]),
  );
  const invalidations: unknown[] = [];
  const transitions: unknown[] = [];
  let factState: string = ASSESSMENT_RECORD_STATES.ACCEPTED;
  let evidenceState: string = ASSESSMENT_RECORD_STATES.ACCEPTED;
  const tx = {
    assessment: {
      findUniqueOrThrow: () => ({ ownerId: "tenant-owner-1" }),
    },
    assessmentEvidence: {
      count: () => 0,
    },
    assessmentFactNeed: {
      findUnique: ({
        where,
      }: {
        where: {
          assessmentId_identityDigest: {
            assessmentId: string;
            identityDigest: string;
          };
        };
      }) => {
        const key = where.assessmentId_identityDigest;
        const row = factNeeds.find(
          (entry) =>
            entry.assessmentId === key.assessmentId &&
            entry.identityDigest === key.identityDigest,
        );
        if (!row) return null;
        const request = requests.find(
          (entry) => entry.factNeedId === row.factNeedId,
        );
        return {
          ...row,
          humanRequest: request ? { requestId: request.requestId } : null,
        };
      },
      create: ({ data }: { data: Record<string, unknown> }) => {
        factNeeds.push(data);
        return data;
      },
      update: ({
        where,
        data,
      }: {
        where: { factNeedId: string };
        data: Record<string, unknown>;
      }) => {
        const row = factNeeds.find(
          (entry) => entry.factNeedId === where.factNeedId,
        )!;
        Object.assign(row, data);
        return row;
      },
    },
    assessmentRuleAuditItem: {
      findUnique: ({
        where,
      }: {
        where: {
          requestId_assessmentRuleId: {
            requestId: string;
            assessmentRuleId: string;
          };
        };
      }) => {
        const key = where.requestId_assessmentRuleId;
        return key.requestId === "audit-current" &&
          selectedRuleIds?.has(key.assessmentRuleId)
          ? { assessmentRuleId: key.assessmentRuleId }
          : null;
      },
    },
    assessmentHumanRequest: {
      findUnique: ({ where }: { where: Record<string, unknown> }) => {
        if (typeof where.requestId === "string") {
          return (
            requests.find((row) => row.requestId === where.requestId) ?? null
          );
        }
        const key = where.assessmentId_idempotencyKey as
          { idempotencyKey: string } | undefined;
        return (
          requests.find((row) => row.idempotencyKey === key?.idempotencyKey) ??
          null
        );
      },
      findFirst: ({
        where,
      }: {
        where: { requestId: string; assessmentId: string };
      }) => {
        const row = requests.find(
          (entry) =>
            entry.requestId === where.requestId &&
            entry.assessmentId === where.assessmentId,
        );
        return row
          ? {
              ...row,
              dependencies: dependencies.filter(
                (entry) => entry.requestId === row.requestId,
              ),
            }
          : null;
      },
      create: ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          ...data,
          status: HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
          requestRevision: 0,
        };
        requests.push(row);
        return row;
      },
      update: ({
        where,
        data,
      }: {
        where: { requestId: string };
        data: Record<string, unknown>;
      }) => {
        const row = requests.find(
          (entry) => entry.requestId === where.requestId,
        )!;
        Object.assign(row, data);
        return row;
      },
    },
    assessmentHumanRequestDependency: {
      upsert: ({
        where,
        create,
        update,
      }: {
        where: {
          requestId_assessmentRuleId: {
            requestId: string;
            assessmentRuleId: string;
          };
        };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const key = where.requestId_assessmentRuleId;
        dependencyWrites.push(key.assessmentRuleId);
        const row = dependencies.find(
          (entry) =>
            entry.requestId === key.requestId &&
            entry.assessmentRuleId === key.assessmentRuleId,
        );
        if (row) Object.assign(row, update);
        else dependencies.push(create);
        return row ?? create;
      },
      findMany: () => dependencies,
    },
    assessmentHumanRequestRegistration: {
      findUnique: ({
        where,
      }: {
        where: { assessmentId_idempotencyKey: { idempotencyKey: string } };
      }) =>
        receipts.find(
          (row) =>
            row.idempotencyKey ===
            where.assessmentId_idempotencyKey.idempotencyKey,
        ) ?? null,
      create: ({ data }: { data: Record<string, unknown> }) => {
        receipts.push(data);
        return data;
      },
    },
    assessmentRule: {
      findUniqueOrThrow: () => ({
        criteria: [{ criterionId: "C-1", statement: "A criterion" }],
      }),
    },
    assessmentRuleDecision: {
      updateMany: (value: unknown) => {
        invalidations.push(value);
        return { count: 1 };
      },
    },
    assessmentDecisionCoverage: {
      update: ({
        where,
        data,
      }: {
        where: { assessmentId_assessmentRuleId: { assessmentRuleId: string } };
        data: { resolutionState: string };
      }) =>
        Object.assign(
          coverage.get(where.assessmentId_assessmentRuleId.assessmentRuleId)!,
          data,
        ),
    },
    assessmentCaseFact: {
      findFirst: () => ({
        assessmentId,
        caseRevision: 2,
        state: factState,
        authority: ASSESSMENT_FACT_AUTHORITIES.HUMAN_PROVIDED,
        evidenceLinks: [
          {
            evidence: {
              assessmentId,
              type: ASSESSMENT_EVIDENCE_TYPES.HUMAN_ANSWER,
              state: evidenceState,
              repositoryCommit: "a".repeat(40),
            },
          },
        ],
      }),
    },
    $queryRaw: () => [],
  };
  const support = {
    lockCase: () => undefined,
    loadPins: () => ({
      caseRevision: 3,
      ruleSetVersionId: "ruleset",
      repositoryCommit: "a".repeat(40),
    }),
    requireCoverage: (_tx: unknown, _assessment: string, id: string) => {
      const row = coverage.get(id);
      if (!row) throw new Error("RULE_NOT_IN_RULE_SET");
      return row;
    },
    ruleSetIdentifiers: () => [],
    moveCoverageToWaiting: (
      _tx: unknown,
      input: { assessmentRuleId: string },
    ) => {
      coverage.get(input.assessmentRuleId)!.resolutionState =
        DECISION_RESOLUTION_STATES.WAITING_FOR_INPUT;
    },
  };
  const handler = new OpenHumanRequestHandler(
    {
      $transaction: (fn: (value: typeof tx) => unknown) => fn(tx),
    } as never,
    {
      requireSelectedRuleMembershipInTx: (
        ...args: Parameters<
          AssessmentRuntimeAuthority["requireSelectedRuleMembershipInTx"]
        >
      ) =>
        AssessmentRuntimeAuthority.prototype.requireSelectedRuleMembershipInTx(
          ...args,
        ),
      authorizeInTx: () => ({
        assessmentId,
        auditRequestId: selectedRuleIds === null ? null : "audit-current",
        threadId,
        executionId: "execution",
        lifecycleState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
        lifecycleRevision: 1,
      }),
    } as never,
    support as never,
    { appendInTx: () => undefined } as never,
    { writeInTx: () => undefined } as never,
    {
      transitionVerifiedInTx: (value: unknown) => {
        transitions.push(value);
      },
    } as never,
  );
  const request = {
    assessmentRuleId: "RULE-A",
    criterionIds: ["C-1"],
    question: "What is the operating entity?",
    unresolvedFact: "The legal identity of this deployment's operating entity.",
    decisionImpact: ["Determines the entity condition."],
    resolutionAttempts: ["Inspected deployment configuration."],
    controlType: HUMAN_RESOLUTION_CONTROL_TYPES.FREE_TEXT,
    choices: [],
    expectedCaseRevision: 3,
    idempotencyKey: "open-1",
  };
  const input = (overrides: Record<string, unknown> = {}) =>
    ({
      assessmentId,
      correlationId: "correlation",
      leaseToken: "lease",
      request: { ...request, ...overrides },
    }) as never;
  const factNeed = (deploymentKey = "prod-eu-1") => ({
    subject: {
      kind: FACT_NEED_SUBJECT_KINDS.deployment,
      key: "customer-ai-service",
    },
    predicate: "OPERATOR_LEGAL_IDENTITY",
    operationalScope: "CUSTOMER_FACING_INFERENCE",
    environment: {
      kind: FACT_NEED_ENVIRONMENTS.production,
      deploymentKey,
    },
    timeframe: {
      kind: FACT_NEED_TIMEFRAME_KINDS.current,
      from: null,
      to: null,
    },
    valueSchema: {
      kind: FACT_NEED_VALUE_KINDS.text,
      schemaVersion: "v1",
      allowedValues: [],
    },
    sourceInvestigationAttempts: ["Inspected deployment configuration."],
    acceptedEvidenceIds: [],
    investigatedRangeIds: [],
  });
  const source = (status: string = HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN) => {
    requests.push({
      ...request,
      requestId: sourceRequestId,
      assessmentId,
      threadId,
      caseRevision: 3,
      requestRevision: 0,
      status,
      resolvedFactId:
        status === HUMAN_RESOLUTION_REQUEST_STATUSES.RESOLVED ? "fact" : null,
      factNeedId: null,
    });
    // The populated-upgrade migration backfills the primary dependency.
    dependencies.push({
      requestId: sourceRequestId,
      assessmentId,
      assessmentRuleId: request.assessmentRuleId,
      criterionIds: request.criterionIds,
    });
  };
  return {
    handler,
    input,
    requests,
    dependencies,
    dependencyWrites,
    selectedRuleIds,
    receipts,
    factNeeds,
    coverage,
    invalidations,
    transitions,
    source,
    factNeed,
    invalidateFact: () => {
      factState = ASSESSMENT_RECORD_STATES.INVALIDATED;
    },
    invalidateEvidence: () => {
      evidenceState = ASSESSMENT_RECORD_STATES.INVALIDATED;
    },
  };
}

describe("shared human-request dependencies", () => {
  it("stores a single request with independent primary and additional rule dependencies", async () => {
    const f = fixture();
    await f.handler.execute(
      f.input({
        dependencies: [{ assessmentRuleId: "RULE-B", criterionIds: ["C-1"] }],
      }),
    );
    expect(f.requests).toHaveLength(1);
    expect(f.dependencies.map((row) => row.assessmentRuleId).sort()).toEqual([
      "RULE-A",
      "RULE-B",
    ]);
    expect(f.coverage.get("RULE-A")?.resolutionState).toBe(
      DECISION_RESOLUTION_STATES.WAITING_FOR_INPUT,
    );
    expect(f.coverage.get("RULE-B")?.resolutionState).toBe(
      DECISION_RESOLUTION_STATES.WAITING_FOR_INPUT,
    );
    expect(f.coverage.get("RULE-C")?.resolutionState).toBe(
      DECISION_RESOLUTION_STATES.PENDING,
    );
  });

  it("validates every rule and criterion before persisting the request", async () => {
    for (const dependency of [
      { assessmentRuleId: "FOREIGN-RULE", criterionIds: ["C-1"] },
      { assessmentRuleId: "RULE-B", criterionIds: ["FOREIGN-CRITERION"] },
    ]) {
      const f = fixture();
      await expect(
        f.handler.execute(f.input({ dependencies: [dependency] })),
      ).rejects.toThrow();
      expect(f.requests).toHaveLength(0);
      expect(f.dependencies).toHaveLength(0);
    }
  });

  it("explicitly attaches an open source without creating a second question", async () => {
    const f = fixture();
    f.source();
    const result = await f.handler.execute(
      f.input({
        assessmentRuleId: "RULE-B",
        sourceRequestId,
        idempotencyKey: "attach",
      }),
    );
    expect(result.requestId).toBe(sourceRequestId);
    expect(f.requests).toHaveLength(1);
    expect(f.coverage.get("RULE-B")?.resolutionState).toBe(
      DECISION_RESOLUTION_STATES.WAITING_FOR_INPUT,
    );
  });

  it("reuses one typed FactNeed across different wording and rule dependencies", async () => {
    const f = fixture();
    const first = await f.handler.execute(
      f.input({ factNeed: f.factNeed(), idempotencyKey: "typed-need-a" }),
    );
    const second = await f.handler.execute(
      f.input({
        assessmentRuleId: "RULE-B",
        question: "Who is the legal operator of this production deployment?",
        unresolvedFact: "Production deployment operator identity.",
        factNeed: f.factNeed(),
        idempotencyKey: "typed-need-b",
      }),
    );

    expect(second.requestId).toBe(first.requestId);
    expect(second.factNeedId).toBe(first.factNeedId);
    expect(f.factNeeds).toHaveLength(1);
    expect(f.requests).toHaveLength(1);
    expect(f.dependencies.map((row) => row.assessmentRuleId).sort()).toEqual([
      "RULE-A",
      "RULE-B",
    ]);
  });

  it("does not merge FactNeeds from different deployments", async () => {
    const f = fixture();
    await f.handler.execute(
      f.input({ factNeed: f.factNeed("prod-eu-1"), idempotencyKey: "need-eu" }),
    );
    await f.handler.execute(
      f.input({
        assessmentRuleId: "RULE-B",
        factNeed: f.factNeed("prod-us-1"),
        idempotencyKey: "need-us",
      }),
    );

    expect(f.factNeeds).toHaveLength(2);
    expect(f.requests).toHaveLength(2);
  });

  it("reuses an accepted resolved fact without waiting or creating facts or lifecycle transitions", async () => {
    const f = fixture();
    f.source(HUMAN_RESOLUTION_REQUEST_STATUSES.RESOLVED);
    f.requests[0].caseRevision = 1;
    f.coverage.get("RULE-B")!.resolutionState =
      DECISION_RESOLUTION_STATES.RESOLVED;
    const result = await f.handler.execute(
      f.input({
        assessmentRuleId: "RULE-B",
        sourceRequestId,
        idempotencyKey: "attach",
      }),
    );
    expect(result).toMatchObject({
      requestId: sourceRequestId,
      caseRevision: 3,
    });
    expect(f.requests).toHaveLength(1);
    expect(f.coverage.get("RULE-B")?.resolutionState).toBe(
      DECISION_RESOLUTION_STATES.INVESTIGATING,
    );
    expect(f.invalidations).toHaveLength(1);
    expect(f.transitions).toHaveLength(0);
  });

  it("preserves an existing dependency and accumulates later registrations without reopening its decision", async () => {
    const f = fixture();
    f.source(HUMAN_RESOLUTION_REQUEST_STATUSES.RESOLVED);
    f.requests[0].caseRevision = 1;
    f.coverage.get("RULE-A")!.resolutionState =
      DECISION_RESOLUTION_STATES.RESOLVED;
    const existing = await f.handler.execute(
      f.input({ sourceRequestId, idempotencyKey: "same-primary" }),
    );
    expect(existing.requestId).toBe(sourceRequestId);
    expect(f.coverage.get("RULE-A")?.resolutionState).toBe(
      DECISION_RESOLUTION_STATES.RESOLVED,
    );
    expect(f.invalidations).toHaveLength(0);
    await f.handler.execute(
      f.input({
        assessmentRuleId: "RULE-B",
        sourceRequestId,
        idempotencyKey: "attach-b",
      }),
    );
    await f.handler.execute(
      f.input({
        assessmentRuleId: "RULE-C",
        sourceRequestId,
        idempotencyKey: "attach-c",
      }),
    );
    expect(
      f.dependencies.map((entry) => entry.assessmentRuleId).sort(),
    ).toEqual(["RULE-A", "RULE-B", "RULE-C"]);
    expect(f.requests).toHaveLength(1);
    expect(f.transitions).toHaveLength(0);
  });

  it("rejects source scope, assessment, thread, open revision and invalidated accepted authority", async () => {
    const changes = [
      (f: ReturnType<typeof fixture>) => {
        f.requests[0].question = "A different question";
      },
      (f: ReturnType<typeof fixture>) => {
        f.requests[0].unresolvedFact = "Different deployment";
      },
      (f: ReturnType<typeof fixture>) => {
        f.requests[0].controlType =
          HUMAN_RESOLUTION_CONTROL_TYPES.SINGLE_SELECT;
      },
      (f: ReturnType<typeof fixture>) => {
        f.requests[0].choices = [{ value: "A", label: "A" }];
      },
      (f: ReturnType<typeof fixture>) => {
        f.requests[0].status = HUMAN_RESOLUTION_REQUEST_STATUSES.CANCELLED;
      },
      (f: ReturnType<typeof fixture>) => {
        f.requests[0].status = HUMAN_RESOLUTION_REQUEST_STATUSES.SUPERSEDED;
      },
      (f: ReturnType<typeof fixture>) => {
        f.requests[0].assessmentId = "other";
      },
      (f: ReturnType<typeof fixture>) => {
        f.requests[0].threadId = "other";
      },
      (f: ReturnType<typeof fixture>) => {
        f.requests[0].caseRevision = 1;
      },
      (f: ReturnType<typeof fixture>) => {
        f.requests[0].status = HUMAN_RESOLUTION_REQUEST_STATUSES.RESOLVED;
        f.requests[0].resolvedFactId = "fact";
        f.invalidateFact();
      },
      (f: ReturnType<typeof fixture>) => {
        f.requests[0].status = HUMAN_RESOLUTION_REQUEST_STATUSES.RESOLVED;
        f.requests[0].resolvedFactId = "fact";
        f.invalidateEvidence();
      },
    ];
    for (const change of changes) {
      const f = fixture();
      f.source();
      change(f);
      await expect(
        f.handler.execute(
          f.input({
            assessmentRuleId: "RULE-B",
            sourceRequestId,
            idempotencyKey: "attach",
          }),
        ),
      ).rejects.toThrow();
      expect(f.dependencies).toHaveLength(1);
      expect(f.dependencyWrites).toHaveLength(0);
    }
  });

  it("replays a source registration exactly and rejects a conflicting registration key", async () => {
    const f = fixture();
    f.source();
    const request = f.input({
      assessmentRuleId: "RULE-B",
      sourceRequestId,
      idempotencyKey: "attach",
    });
    const original = await f.handler.execute(request);
    expect(await f.handler.execute(request)).toEqual(original);
    expect(f.receipts).toHaveLength(1);
    expect(f.dependencies).toHaveLength(2);
    await expect(
      f.handler.execute(
        f.input({
          assessmentRuleId: "RULE-C",
          sourceRequestId,
          idempotencyKey: "attach",
        }),
      ),
    ).rejects.toThrow();
  });
  it("rejects a nonmember shared dependency before any request or receipt is persisted", async () => {
    const f = fixture({ selectedRuleIds: ["RULE-A"] });
    await expect(
      f.handler.execute(
        f.input({
          dependencies: [{ assessmentRuleId: "RULE-B", criterionIds: ["C-1"] }],
        }),
      ),
    ).rejects.toThrow();
    expect(f.requests).toHaveLength(0);
    expect(f.receipts).toHaveLength(0);
    expect(f.dependencyWrites).toHaveLength(0);
  });

  it("rechecks every dependency before replay under a changed selected audit", async () => {
    const f = fixture({ selectedRuleIds: ["RULE-A", "RULE-B"] });
    const input = f.input({
      dependencies: [{ assessmentRuleId: "RULE-B", criterionIds: ["C-1"] }],
    });
    await f.handler.execute(input);
    f.selectedRuleIds!.delete("RULE-B");
    await expect(f.handler.execute(input)).rejects.toThrow();
    expect(f.receipts).toHaveLength(1);
    expect(f.requests).toHaveLength(1);
  });

  it("reuses a resolved factual source without mutating its unselected historical dependency", async () => {
    const f = fixture({ selectedRuleIds: ["RULE-B"] });
    f.source(HUMAN_RESOLUTION_REQUEST_STATUSES.RESOLVED);
    f.requests[0].caseRevision = 1;
    f.coverage.get("RULE-A")!.resolutionState =
      DECISION_RESOLUTION_STATES.RESOLVED;
    await f.handler.execute(
      f.input({
        assessmentRuleId: "RULE-B",
        sourceRequestId,
        idempotencyKey: "selected-reuse",
      }),
    );
    expect(f.dependencyWrites).toEqual(["RULE-B"]);
    expect(f.coverage.get("RULE-A")!.resolutionState).toBe(
      DECISION_RESOLUTION_STATES.RESOLVED,
    );
    expect(f.coverage.get("RULE-B")!.resolutionState).toBe(
      DECISION_RESOLUTION_STATES.INVESTIGATING,
    );
    expect(f.transitions).toHaveLength(0);
  });
});
