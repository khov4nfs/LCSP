import { randomUUID } from "node:crypto";
import { describe, expect, it, jest } from "@jest/globals";
import {
  ASSESSMENT_LIFECYCLE_STATES,
  DECISION_RESOLUTION_STATES,
  HUMAN_RESOLUTION_REQUEST_STATUSES,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_DECISION_SCOPE,
  HUMAN_RESOLUTION_CONTROL_TYPES,
  RULE_AUDIT_SCOPE_MODES,
  RULE_AUDIT_STATUSES,
} from "@lcsp/contracts/assessment-domain";
import { DEFAULT_RESPONSE_LANGUAGE } from "@lcsp/contracts/shared/locale";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AssessmentCaseSupport } from "../../../infrastructure/persistence/assessment-case-support.service.js";
import type { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";
import { GetRootContextHandler } from "./get-root-context.handler.js";
import { GetRootContextQuery } from "./get-root-context.query.js";

describe("GetRootContextHandler locale authority", () => {
  const assessmentId = randomUUID();
  const threadId = randomUUID();
  const leaseToken = randomUUID();
  const correlationId = "corr-1";

  const pins = {
    caseRevision: 1,
    ruleSetVersionId: randomUUID(),
    repositorySnapshotId: randomUUID(),
    repositoryScanJobId: randomUUID(),
    repositoryCommit: "a".repeat(40),
  };

  function createFixture(
    options: {
      executionId?: string;
      auditRequestId?: string | null;
      auditRequest?: Record<string, unknown> | null;
      sourcePathPrefix?: string | null;
      currentTurnContext?: Record<string, unknown> | null;
      latestTurnContext?: Record<string, unknown> | null;
      outboxPayload?: Record<string, unknown> | null;
      eventPayload?: Record<string, unknown> | null;
      blockerReference?: Record<string, unknown> | null;
    } = {},
  ) {
    const executionId = options.executionId ?? randomUUID();
    const tx = {
      assessmentRuleAuditRequest: {
        findUnique: jest
          .fn<() => Promise<Record<string, unknown> | null>>()
          .mockResolvedValue(options.auditRequest ?? null),
      },
      assessmentDecisionCoverage: {
        findMany: jest.fn<() => Promise<any[]>>().mockResolvedValue([]),
      },
      assessmentCaseFact: {
        findMany: jest.fn<() => Promise<any[]>>().mockResolvedValue([]),
      },
      assessmentEvidence: {
        findMany: jest.fn<() => Promise<any[]>>().mockResolvedValue([]),
      },
      assessmentHumanRequest: {
        findMany: jest.fn<() => Promise<any[]>>().mockResolvedValue([]),
      },
      assessmentRuntimeTurn: {
        findMany: jest.fn<() => Promise<any[]>>().mockResolvedValue([]),
        findUnique: jest
          .fn<() => Promise<{ contextJson: any } | null>>()
          .mockResolvedValue(
            options.currentTurnContext !== undefined
              ? options.currentTurnContext
                ? { contextJson: options.currentTurnContext }
                : null
              : null,
          ),
        findFirst: jest
          .fn<() => Promise<{ contextJson: any } | null>>()
          .mockResolvedValue(
            options.latestTurnContext !== undefined
              ? options.latestTurnContext
                ? { contextJson: options.latestTurnContext }
                : null
              : null,
          ),
      },
      outboxMessage: {
        findFirst: jest
          .fn<() => Promise<{ payload: any } | null>>()
          .mockResolvedValue(
            options.outboxPayload !== undefined
              ? options.outboxPayload
                ? { payload: options.outboxPayload }
                : null
              : null,
          ),
      },
      assessmentEvent: {
        count: jest.fn<() => Promise<number>>().mockResolvedValue(0),
        findFirst: jest
          .fn<() => Promise<{ payload: any } | null>>()
          .mockResolvedValue(
            options.eventPayload !== undefined
              ? options.eventPayload
                ? { payload: options.eventPayload }
                : null
              : null,
          ),
      },
      llmUsageEvent: {
        aggregate: jest.fn<() => Promise<any>>().mockResolvedValue(null),
      },
    };

    const prisma = {
      $transaction: jest.fn((callback: (t: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as unknown as PrismaService;

    const authority = {
      authorizeInTx: jest.fn(() =>
        Promise.resolve({
          assessmentId,
          threadId,
          executionId,
          auditRequestId: options.auditRequestId ?? null,
          lifecycleState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
          lifecycleRevision: 1,
          blockerReason: null,
          blockerReference: options.blockerReference ?? null,
        }),
      ),
    } as unknown as AssessmentRuntimeAuthority;

    const support = {
      loadPins: jest.fn(() =>
        Promise.resolve({
          ...pins,
          sourcePathPrefix: options.sourcePathPrefix ?? null,
        }),
      ),
    } as unknown as AssessmentCaseSupport;

    const handler = new GetRootContextHandler(prisma, authority, support);

    return { handler, tx, authority, executionId };
  }

  it("returns the immutable repository source prefix supplied by the authoritative pins", async () => {
    const { handler } = createFixture({ sourcePathPrefix: "chatbot" });
    const result = await handler.execute(
      new GetRootContextQuery(assessmentId, leaseToken, correlationId),
    );
    expect(result.sourcePathPrefix).toBe("chatbot");
  });

  it("resolves default application locale (vi) when no saved selection exists in server state", async () => {
    const { handler } = createFixture();

    const result = await handler.execute(
      new GetRootContextQuery(assessmentId, leaseToken, correlationId),
    );

    expect(result.responseLanguage).toBe(DEFAULT_RESPONSE_LANGUAGE);
    expect(result.responseLanguage).toBe("vi");
    expect(result.decisionScopeId).toBe(ASSESSMENT_DECISION_SCOPE);
  });

  it("resolves authoritative English selection when turn contextJson specifies responseLanguage: en", async () => {
    const { handler } = createFixture({
      currentTurnContext: { responseLanguage: "en" },
    });

    const result = await handler.execute(
      new GetRootContextQuery(assessmentId, leaseToken, correlationId),
    );

    expect(result.responseLanguage).toBe("en");
  });

  it("resolves authoritative English selection from latest outbox message when current turn has no locale", async () => {
    const { handler } = createFixture({
      currentTurnContext: {},
      outboxPayload: {
        assessmentId,
        responseLanguage: "en",
      },
    });

    const result = await handler.execute(
      new GetRootContextQuery(assessmentId, leaseToken, correlationId),
    );

    expect(result.responseLanguage).toBe("en");
  });

  it("resolves authoritative Vietnamese selection from latest outbox message when selected", async () => {
    const { handler } = createFixture({
      currentTurnContext: {},
      outboxPayload: {
        assessmentId,
        responseLanguage: "vi",
      },
    });

    const result = await handler.execute(
      new GetRootContextQuery(assessmentId, leaseToken, correlationId),
    );

    expect(result.responseLanguage).toBe("vi");
  });

  it("resolves English from latest assessment event if outbox and turn context lack locale", async () => {
    const { handler } = createFixture({
      currentTurnContext: null,
      outboxPayload: null,
      eventPayload: { locale: "en" },
    });

    const result = await handler.execute(
      new GetRootContextQuery(assessmentId, leaseToken, correlationId),
    );

    expect(result.responseLanguage).toBe("en");
  });

  it("switches language on the SAME thread between successive turns (EN -> VI -> EN)", async () => {
    // Turn 1 on thread: user has English selection persisted
    const turn1ExecId = randomUUID();
    const fixtureTurn1 = createFixture({
      executionId: turn1ExecId,
      currentTurnContext: { responseLanguage: "en" },
    });
    const result1 = await fixtureTurn1.handler.execute(
      new GetRootContextQuery(assessmentId, leaseToken, correlationId),
    );
    expect(result1.responseLanguage).toBe("en");
    expect(result1.threadId).toBe(threadId);

    // Turn 2 on SAME thread: user switched to Vietnamese, saved to server state
    const turn2ExecId = randomUUID();
    const fixtureTurn2 = createFixture({
      executionId: turn2ExecId,
      currentTurnContext: { responseLanguage: "vi" },
    });
    const result2 = await fixtureTurn2.handler.execute(
      new GetRootContextQuery(assessmentId, leaseToken, correlationId),
    );
    expect(result2.responseLanguage).toBe("vi");
    expect(result2.threadId).toBe(threadId);

    // Turn 3 on SAME thread: user switched back to English, saved to server state
    const turn3ExecId = randomUUID();
    const fixtureTurn3 = createFixture({
      executionId: turn3ExecId,
      currentTurnContext: { responseLanguage: "en" },
    });
    const result3 = await fixtureTurn3.handler.execute(
      new GetRootContextQuery(assessmentId, leaseToken, correlationId),
    );
    expect(result3.responseLanguage).toBe("en");
    expect(result3.threadId).toBe(threadId);
  });

  it("respects explicit input responseLanguage when provided", async () => {
    const { handler } = createFixture({
      currentTurnContext: { responseLanguage: "vi" },
    });

    const result = await handler.execute(
      new GetRootContextQuery(assessmentId, leaseToken, correlationId, "en"),
    );

    expect(result.responseLanguage).toBe("en");
  });
  it.each(["missing", "foreign", "empty"])(
    "rejects a %s selected audit instead of widening Root context",
    async (mode) => {
      const auditRequestId = randomUUID();
      const f = createFixture({
        auditRequestId,
        auditRequest:
          mode === "missing"
            ? null
            : {
                requestId: auditRequestId,
                assessmentId: mode === "foreign" ? randomUUID() : assessmentId,
                rules: mode === "empty" ? [] : [{ assessmentRuleId: "RULE-A" }],
              },
      });
      await expect(
        f.handler.execute(
          new GetRootContextQuery(assessmentId, leaseToken, correlationId),
        ),
      ).rejects.toMatchObject({ status: 403 });
      expect(f.tx.assessmentDecisionCoverage.findMany).not.toHaveBeenCalled();
    },
  );

  it("exposes only selected coverage and human requests whose shared dependencies belong to the current audit", async () => {
    const auditRequestId = randomUUID();
    const f = createFixture({
      auditRequestId,
      sourcePathPrefix: "source",
      auditRequest: {
        requestId: auditRequestId,
        assessmentId,
        scopeMode: RULE_AUDIT_SCOPE_MODES.SELECTED_RULES,
        status: RULE_AUDIT_STATUSES.RUNNING,
        rules: [{ assessmentRuleId: "RULE-SELECTED" }],
      },
    });
    f.tx.assessmentDecisionCoverage.findMany.mockResolvedValue(
      ["RULE-SELECTED", "RULE-OUTSIDE"].map((assessmentRuleId) => ({
        assessmentRuleId,
        assessmentRuleVersion: "1",
        resolutionState: DECISION_RESOLUTION_STATES.PENDING,
        currentDecisionId: null,
        decisionRevision: 0,
      })),
    );
    const sharedRequest = {
      requestId: randomUUID(),
      requestRevision: 0,
      caseRevision: pins.caseRevision,
      status: HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
      assessmentRuleId: "RULE-HISTORICAL",
      criterionIds: ["criterion-1"],
      question: "Which entity operates this deployment?",
      unresolvedFact: "The deployment operator has not been confirmed.",
      decisionImpact: ["Operator identity determines the factual scope."],
      resolutionAttempts: ["Inspected the source configuration."],
      controlType: HUMAN_RESOLUTION_CONTROL_TYPES.FREE_TEXT,
      choices: [],
      checkpointId: null,
      resolvedFactId: null,
      answers: [],
      dependencies: [
        { assessmentRuleId: "RULE-SELECTED", criterionIds: ["criterion-1"] },
      ],
    };
    f.tx.assessmentHumanRequest.findMany.mockResolvedValue([
      sharedRequest,
      {
        ...sharedRequest,
        requestId: randomUUID(),
        assessmentRuleId: "RULE-OUTSIDE",
        dependencies: [],
      },
    ]);
    const result = await f.handler.execute(
      new GetRootContextQuery(assessmentId, leaseToken, correlationId),
    );
    expect(result.sourcePathPrefix).toBe("source");
    expect(result.auditRequest?.requestId).toBe(auditRequestId);
    expect(result.coverage.map((row) => row.assessmentRuleId)).toEqual([
      "RULE-SELECTED",
    ]);
    expect(result.openHumanRequestIds).toEqual([sharedRequest.requestId]);
    expect(result.humanRequests?.map((row) => row.requestId)).toEqual([
      sharedRequest.requestId,
    ]);
  });

  it("computes durable cumulative budget state from llmUsageEvent", async () => {
    const f = createFixture();
    f.tx.llmUsageEvent = {
      aggregate: jest.fn<() => Promise<any>>().mockResolvedValue({
        _count: { id: 5 },
        _sum: {
          inputTokens: 50_000n,
          outputTokens: 2_500n,
          totalTokens: 52_500n,
        },
      }),
    };
    const result = await f.handler.execute(
      new GetRootContextQuery(assessmentId, leaseToken, correlationId),
    );
    expect(result.budgetState).toBeDefined();
    expect(result.budgetState?.workloadScope).toBe("ASSESSMENT_ROOT");
    expect(result.budgetState?.cumulativeUsage.modelCalls).toBe(5);
    expect(result.budgetState?.cumulativeUsage.inputTokens).toBe(50_000);
    expect(result.budgetState?.cumulativeUsage.outputTokens).toBe(2_500);
    expect(result.budgetState?.cumulativeUsage.totalTokens).toBe(52_500);
    expect(result.budgetState?.status).toBe("ADMITTED");
  });

  it("evaluates NO_PROGRESS status when configured limit (15) is reached", async () => {
    const originalEnv = process.env.LCSP_ASSESSMENT_NO_PROGRESS_LIMIT;
    process.env.LCSP_ASSESSMENT_NO_PROGRESS_LIMIT = "15";
    try {
      const f = createFixture();
      const turns = Array.from({ length: 15 }, (_, i) => ({
        id: `turn-${i}`,
        contextJson: { progressMade: false },
        createdAt: new Date(Date.now() - i * 1000),
      }));
      f.tx.assessmentRuntimeTurn.findMany = jest
        .fn<() => Promise<any[]>>()
        .mockResolvedValue(turns);

      const result = await f.handler.execute(
        new GetRootContextQuery(assessmentId, leaseToken, correlationId),
      );
      expect(result.budgetState).toBeDefined();
      expect(
        result.budgetState?.cumulativeUsage.consecutiveTurnsWithoutProgress,
      ).toBe(15);
      expect(result.budgetState?.limits.noProgressLimit).toBe(15);
      expect(result.budgetState?.status).toBe("NO_PROGRESS");
    } finally {
      if (originalEnv !== undefined) {
        process.env.LCSP_ASSESSMENT_NO_PROGRESS_LIMIT = originalEnv;
      } else {
        delete process.env.LCSP_ASSESSMENT_NO_PROGRESS_LIMIT;
      }
    }
  });

  it("admits ordinary execution when no explicit limits are configured even with 15 turns without progress", async () => {
    const originalEnv = process.env.LCSP_ASSESSMENT_NO_PROGRESS_LIMIT;
    delete process.env.LCSP_ASSESSMENT_NO_PROGRESS_LIMIT;
    try {
      const f = createFixture();
      const turns = Array.from({ length: 15 }, (_, i) => ({
        id: `turn-${i}`,
        contextJson: { progressMade: false },
        createdAt: new Date(Date.now() - i * 1000),
      }));
      f.tx.assessmentRuntimeTurn.findMany = jest
        .fn<() => Promise<any[]>>()
        .mockResolvedValue(turns);

      const result = await f.handler.execute(
        new GetRootContextQuery(assessmentId, leaseToken, correlationId),
      );
      expect(result.budgetState).toBeDefined();
      expect(result.budgetState?.limits.noProgressLimit).toBeNull();
      expect(result.budgetState?.limits.maxModelCalls).toBeNull();
      expect(result.budgetState?.status).toBe("ADMITTED");
    } finally {
      if (originalEnv !== undefined) {
        process.env.LCSP_ASSESSMENT_NO_PROGRESS_LIMIT = originalEnv;
      }
    }
  });

  it("resets consecutiveTurnsWithoutProgress to 0 when recent completed turn made progress", async () => {
    const f = createFixture();
    const turns = [
      {
        id: "turn-latest",
        contextJson: { progressMade: true },
        createdAt: new Date(),
      },
      {
        id: "turn-old-1",
        contextJson: { progressMade: false },
        createdAt: new Date(Date.now() - 1000),
      },
      {
        id: "turn-old-2",
        contextJson: { progressMade: false },
        createdAt: new Date(Date.now() - 2000),
      },
    ];
    f.tx.assessmentRuntimeTurn.findMany = jest
      .fn<() => Promise<any[]>>()
      .mockResolvedValue(turns);

    const result = await f.handler.execute(
      new GetRootContextQuery(assessmentId, leaseToken, correlationId),
    );
    expect(
      result.budgetState?.cumulativeUsage.consecutiveTurnsWithoutProgress,
    ).toBe(0);
    expect(result.budgetState?.status).toBe("ADMITTED");
  });

  it("admits execution when blockerReference sets overrideNoProgress: true despite 15 consecutive turns without progress", async () => {
    const f = createFixture({
      blockerReference: { overrideNoProgress: true },
    });
    const turns = Array.from({ length: 15 }, (_, i) => ({
      id: `turn-${i}`,
      contextJson: { progressMade: false },
      createdAt: new Date(Date.now() - i * 1000),
    }));
    f.tx.assessmentRuntimeTurn.findMany = jest
      .fn<() => Promise<any[]>>()
      .mockResolvedValue(turns);

    const result = await f.handler.execute(
      new GetRootContextQuery(assessmentId, leaseToken, correlationId),
    );
    expect(
      result.budgetState?.cumulativeUsage.consecutiveTurnsWithoutProgress,
    ).toBe(15);
    expect(result.budgetState?.limits.noProgressLimit).toBeNull();
    expect(result.budgetState?.status).toBe("ADMITTED");
  });

  it("falls back to domain events when progressMade flag is absent on turn context", async () => {
    const f = createFixture();
    const turns = [
      { id: "turn-no-flag", contextJson: {}, createdAt: new Date() },
    ];
    f.tx.assessmentRuntimeTurn.findMany = jest
      .fn<() => Promise<any[]>>()
      .mockResolvedValue(turns);
    f.tx.assessmentEvent.count = jest
      .fn<() => Promise<number>>()
      .mockResolvedValue(1);

    const result = await f.handler.execute(
      new GetRootContextQuery(assessmentId, leaseToken, correlationId),
    );
    expect(
      result.budgetState?.cumulativeUsage.consecutiveTurnsWithoutProgress,
    ).toBe(0);
    expect(result.budgetState?.status).toBe("ADMITTED");
  });
});
