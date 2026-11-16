import { randomUUID } from "node:crypto";
import { describe, expect, it, jest } from "@jest/globals";
import {
  AssessmentFactNeedStatus,
  AssessmentFactNeedValueKind,
  type Prisma,
} from "@prisma/client";
import {
  AGENT_EXECUTION_STATES,
  ASSESSMENT_LIFECYCLE_STATES,
  HUMAN_RESOLUTION_REQUEST_STATUSES,
} from "@lcsp/contracts/assessment";
import { HUMAN_RESOLUTION_CONTROL_TYPES } from "@lcsp/contracts/assessment-domain";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { AnswerHumanRequestCommand } from "./answer-human-request.command.js";
import { AnswerHumanRequestHandler } from "./answer-human-request.handler.js";

function fixture(selectedRules = ["RULE-SELECTED"]) {
  const assessmentId = randomUUID();
  const requestId = randomUUID();
  const auditRequestId = randomUUID();
  const threadId = randomUUID();
  const checkpointId = randomUUID();
  const ownerId = randomUUID();
  const request = {
    assessmentId,
    requestId,
    threadId,
    checkpointId,
    assessmentRuleId: "RULE-HISTORICAL",
    criterionIds: ["criterion-1"],
    dependencies: [
      { assessmentRuleId: "RULE-HISTORICAL", criterionIds: ["criterion-1"] },
      { assessmentRuleId: "RULE-SELECTED", criterionIds: ["criterion-1"] },
    ],
    requestRevision: 0,
    status: HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN as string,
    controlType: HUMAN_RESOLUTION_CONTROL_TYPES.FREE_TEXT as string,
    choices: [] as Array<{ value: string; label: string }>,
    question: "Which entity operates this deployment?",
    answers: [] as Array<Record<string, unknown>>,
    resolvedFactId: null,
    factNeedId: null as string | null,
    factNeed: null as {
      valueKind: AssessmentFactNeedValueKind;
      allowedValues: string[];
    } | null,
  };
  const unrelatedRequest = {
    ...request,
    requestId: randomUUID(),
    assessmentRuleId: "RULE-UNSELECTED",
    dependencies: [],
    answers: [] as Array<Record<string, unknown>>,
  };
  const requests = [request, unrelatedRequest];
  type RequestRow = (typeof requests)[number];
  type RequestFilter = {
    assessmentId?: string;
    requestId?: string;
    status?: string;
    OR?: Array<{
      assessmentRuleId?: { in: string[] };
      dependencies?: { some: { assessmentRuleId: { in: string[] } } };
    }>;
  };
  const matching = (where: RequestFilter) =>
    requests.filter(
      (row) =>
        (!where.assessmentId || row.assessmentId === where.assessmentId) &&
        (!where.requestId || row.requestId === where.requestId) &&
        (!where.status || row.status === where.status) &&
        (!where.OR ||
          where.OR.some(
            (clause) =>
              clause.assessmentRuleId?.in.includes(row.assessmentRuleId) ||
              row.dependencies.some((dependency) =>
                clause.dependencies?.some.assessmentRuleId.in.includes(
                  dependency.assessmentRuleId,
                ),
              ),
          )),
    );
  const tx = {
    assessmentRuleAuditItem: {
      findMany: jest.fn(() =>
        Promise.resolve(
          selectedRules.map((assessmentRuleId) => ({ assessmentRuleId })),
        ),
      ),
    },
    assessmentHumanRequest: {
      findFirst: jest.fn(() => Promise.resolve(request)),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(Object.assign(request, data)),
      ),
      count: jest.fn(({ where }: { where: RequestFilter }) =>
        Promise.resolve(matching(where).length),
      ),
      findMany: jest.fn(({ where }: { where: RequestFilter }) =>
        Promise.resolve(matching(where)),
      ),
    },
    assessmentHumanRequestDependency: {
      count: jest.fn(
        ({
          where,
        }: {
          where: { assessmentRuleId: string; request: { status: string } };
        }) =>
          Promise.resolve(
            requests.filter(
              (row: RequestRow) =>
                row.status === where.request.status &&
                row.dependencies.some(
                  (dependency) =>
                    dependency.assessmentRuleId === where.assessmentRuleId,
                ),
            ).length,
          ),
      ),
    },
    assessmentCase: {
      update: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue({}),
    },
    assessmentEvidence: {
      create: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue({}),
    },
    assessmentCaseFact: {
      create: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue({}),
    },
    assessmentCaseFactEvidence: {
      create: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue({}),
    },
    assessmentFactNeed: {
      updateMany: jest
        .fn<(...args: unknown[]) => Promise<{ count: number }>>()
        .mockResolvedValue({ count: 1 }),
    },
    assessmentDecisionCoverage: {
      updateMany: jest
        .fn<
          (
            args: Prisma.AssessmentDecisionCoverageUpdateManyArgs,
          ) => Promise<{ count: number }>
        >()
        .mockResolvedValue({ count: 1 }),
    },
  };
  const outbox = { enqueue: jest.fn(() => Promise.resolve({})) };
  const coordinator = {
    transitionVerifiedInTx: jest.fn(() => Promise.resolve({})),
  };
  const handler = new AnswerHumanRequestHandler(
    { $transaction: (run: (value: typeof tx) => unknown) => run(tx) } as never,
    {
      requireOwner: () =>
        Promise.resolve({
          ownerId,
          lifecycleState: ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_HUMAN,
          lifecycleRevision: 1,
          blockerReason: null,
          blockerReference: null,
          runtime: {
            threadId,
            checkpointId,
            currentAuditRequestId: auditRequestId,
            executionState: AGENT_EXECUTION_STATES.INTERRUPTED,
          },
        }),
    } as never,
    {
      lockCase: () => Promise.resolve(undefined),
      loadPins: () =>
        Promise.resolve({
          caseRevision: 3,
          repositoryCommit: "a".repeat(40),
        }),
    } as never,
    { appendInTx: () => Promise.resolve(undefined) } as never,
    { invalidateCaseRevisionInTx: () => Promise.resolve([]) } as never,
    coordinator as never,
    outbox as never,
    { writeInTx: () => Promise.resolve(undefined) } as never,
  );
  const input = (doesNotKnow: boolean, answerText?: string) =>
    new AnswerHumanRequestCommand(
      assessmentId,
      requestId,
      {
        userId: ownerId,
        role: AUTH_USER_ROLES.customer,
        sessionId: randomUUID(),
        scope: "all",
      },
      {
        expectedRequestRevision: 0,
        expectedCaseRevision: 3,
        idempotencyKey: randomUUID(),
        ...(doesNotKnow
          ? { doesNotKnow: true as const }
          : {
              doesNotKnow: false as const,
              answer:
                answerText ?? "The deployment is operated by Example Ltd.",
            }),
      },
      randomUUID(),
    );
  return { handler, input, tx, outbox, coordinator, request, unrelatedRequest };
}

describe("shared human answers inside a selected audit", () => {
  it("accepts a shared answer through its selected dependency and resumes without unrelated historical blockers", async () => {
    const f = fixture();
    const result = await f.handler.execute(f.input(false));
    expect(result.status).toBe(HUMAN_RESOLUTION_REQUEST_STATUSES.RESOLVED);
    expect(result.resumed).toBe(true);
    expect(f.tx.assessmentDecisionCoverage.updateMany).toHaveBeenCalledTimes(1);
    expect(f.tx.assessmentDecisionCoverage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ assessmentRuleId: "RULE-SELECTED" }),
      }),
    );
    expect(f.unrelatedRequest.status).toBe(
      HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
    );
    expect(f.coordinator.transitionVerifiedInTx).toHaveBeenCalledTimes(1);
    expect(f.outbox.enqueue).toHaveBeenCalledTimes(1);
  });

  it("schedules UNKNOWN review only for current selected dependencies and creates no accepted fact", async () => {
    const f = fixture();
    const result = await f.handler.execute(f.input(true));
    expect(result.status).toBe(HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN);
    expect(result.factId).toBeNull();
    expect(result.resumed).toBe(true);
    expect(f.tx.assessmentCase.update).not.toHaveBeenCalled();
    expect(f.tx.assessmentEvidence.create).not.toHaveBeenCalled();
    expect(f.tx.assessmentCaseFact.create).not.toHaveBeenCalled();
    expect(f.tx.assessmentFactNeed.updateMany).not.toHaveBeenCalled();
    expect(f.tx.assessmentDecisionCoverage.updateMany).not.toHaveBeenCalled();
    expect(f.coordinator.transitionVerifiedInTx).not.toHaveBeenCalled();
    expect(f.outbox.enqueue).toHaveBeenCalledTimes(1);
  });

  it("resolves a linked FactNeed to the accepted fact in the same transaction", async () => {
    const f = fixture();
    f.request.factNeedId = randomUUID();

    const result = await f.handler.execute(f.input(false));

    expect(result.factId).not.toBeNull();
    expect(f.tx.assessmentFactNeed.updateMany).toHaveBeenCalledWith({
      where: {
        factNeedId: f.request.factNeedId,
        assessmentId: f.request.assessmentId,
        status: AssessmentFactNeedStatus.OPEN,
      },
      data: {
        status: AssessmentFactNeedStatus.RESOLVED,
        resolvedFactId: result.factId,
        resolvedAt: expect.any(Date),
      },
    });
  });

  it("normalizes a typed FactNeed answer while preserving the raw answer", async () => {
    const f = fixture();
    f.request.factNeedId = randomUUID();
    f.request.factNeed = {
      valueKind: AssessmentFactNeedValueKind.BOOLEAN,
      allowedValues: [],
    };

    await f.handler.execute(f.input(false, "TRUE"));

    expect(f.tx.assessmentEvidence.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payload: expect.objectContaining({
            answer: "TRUE",
            normalizedAnswer: {
              kind: AssessmentFactNeedValueKind.BOOLEAN,
              value: true,
            },
          }),
        }),
      }),
    );
    expect(f.request.answers[0]).toMatchObject({
      answer: "TRUE",
      normalizedAnswer: {
        kind: AssessmentFactNeedValueKind.BOOLEAN,
        value: true,
      },
    });
  });

  it("rejects an invalid typed answer before creating evidence or advancing the case", async () => {
    const f = fixture();
    f.request.factNeedId = randomUUID();
    f.request.factNeed = {
      valueKind: AssessmentFactNeedValueKind.BOOLEAN,
      allowedValues: [],
    };

    await expect(
      f.handler.execute(f.input(false, "maybe")),
    ).rejects.toMatchObject({ status: 422 });

    expect(f.tx.assessmentCase.update).not.toHaveBeenCalled();
    expect(f.tx.assessmentEvidence.create).not.toHaveBeenCalled();
    expect(f.tx.assessmentFactNeed.updateMany).not.toHaveBeenCalled();
  });

  it("rejects an ambiguous material answer before factual acceptance", async () => {
    const f = fixture();
    f.request.question =
      "Has any serious AI-system incident occurred during operation of the chatbot?";

    await expect(
      f.handler.execute(
        f.input(
          false,
          "No serious incident has occurred, but the incident status remains unknown.",
        ),
      ),
    ).rejects.toMatchObject({ status: 422 });

    expect(f.tx.assessmentCase.update).not.toHaveBeenCalled();
    expect(f.tx.assessmentEvidence.create).not.toHaveBeenCalled();
  });

  it("rejects a material answer that conflicts with accepted human history", async () => {
    const f = fixture();
    const question =
      "Has any serious AI-system incident occurred during operation of the chatbot?";
    f.request.question = question;
    f.unrelatedRequest.question = question;
    f.unrelatedRequest.status = HUMAN_RESOLUTION_REQUEST_STATUSES.RESOLVED;
    f.unrelatedRequest.answers = [
      {
        idempotencyKey: "prior-answer",
        requestDigest: "a".repeat(64),
        actorId: "customer-owner",
        answeredAt: "2026-11-15T10:00:00.000Z",
        caseRevision: 2,
        requestRevision: 1,
        doesNotKnow: false,
        answer: "Incident history remains unknown.",
        selectedChoice: null,
      },
    ];

    await expect(
      f.handler.execute(
        f.input(false, "No serious incident has occurred since go-live."),
      ),
    ).rejects.toMatchObject({ status: 422 });

    expect(f.tx.assessmentCase.update).not.toHaveBeenCalled();
    expect(f.tx.assessmentEvidence.create).not.toHaveBeenCalled();
  });

  it("rejects a shared request whose dependencies are all outside the current audit", async () => {
    const f = fixture(["RULE-OTHER-AUDIT"]);
    await expect(f.handler.execute(f.input(false))).rejects.toMatchObject({
      status: 403,
    });
    expect(f.tx.assessmentHumanRequest.update).not.toHaveBeenCalled();
    expect(f.tx.assessmentCaseFact.create).not.toHaveBeenCalled();
    expect(f.outbox.enqueue).not.toHaveBeenCalled();
  });

  it("preserves typed choice value and canonical label in evidence payload and fact statement", async () => {
    const f = fixture();
    f.request.controlType = HUMAN_RESOLUTION_CONTROL_TYPES.SINGLE_SELECT;
    f.request.choices = [
      { value: "DEV_ONLY", label: "Development environment only" },
      { value: "PROD", label: "Production environment" },
    ];
    const result = await f.handler.execute(f.input(false, "DEV_ONLY"));

    expect(result.status).toBe(HUMAN_RESOLUTION_REQUEST_STATUSES.RESOLVED);
    expect(f.tx.assessmentEvidence.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payload: expect.objectContaining({
            answer: "DEV_ONLY",
            selectedChoice: {
              value: "DEV_ONLY",
              label: "Development environment only",
            },
            controlType: HUMAN_RESOLUTION_CONTROL_TYPES.SINGLE_SELECT,
          }),
        }),
      }),
    );
    expect(f.tx.assessmentCaseFact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          statement: expect.stringContaining(
            "Customer answer: Development environment only (DEV_ONLY)",
          ),
        }),
      }),
    );
  });
});
