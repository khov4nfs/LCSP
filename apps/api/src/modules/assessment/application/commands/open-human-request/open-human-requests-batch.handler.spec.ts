import { describe, expect, it } from "@jest/globals";
import {
  ASSESSMENT_LIFECYCLE_STATES,
  DECISION_RESOLUTION_STATES,
} from "@lcsp/contracts/assessment";
import {
  HUMAN_RESOLUTION_CONTROL_TYPES,
  type OpenAssessmentHumanRequest,
} from "@lcsp/contracts/assessment-domain";
import { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";
import { OpenHumanRequestsBatchCommand } from "./open-human-requests-batch.command.js";
import { OpenHumanRequestsBatchHandler } from "./open-human-requests-batch.handler.js";

function fixture(selectedRuleIds: string[] | null = null) {
  const assessmentId = "assessment-1";
  const threadId = "thread-1";
  const requests: Record<string, unknown>[] = [];
  const registrations = new Map<string, Record<string, unknown>>();
  const transitions: unknown[] = [];
  const coverage = new Map<
    string,
    { assessmentRuleId: string; resolutionState: string }
  >([
    [
      "RULE-A",
      {
        assessmentRuleId: "RULE-A",
        resolutionState: DECISION_RESOLUTION_STATES.INVESTIGATING,
      },
    ],
    [
      "RULE-B",
      {
        assessmentRuleId: "RULE-B",
        resolutionState: DECISION_RESOLUTION_STATES.INVESTIGATING,
      },
    ],
  ]);
  const tx = {
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
      }) =>
        selectedRuleIds === null ||
        selectedRuleIds.includes(
          where.requestId_assessmentRuleId.assessmentRuleId,
        )
          ? Promise.resolve({
              assessmentRuleId:
                where.requestId_assessmentRuleId.assessmentRuleId,
            })
          : Promise.resolve(null),
    },
    assessmentRule: {
      findUniqueOrThrow: () => ({
        criteria: [{ criterionId: "C-1" }, { criterionId: "C-2" }],
      }),
    },
    assessmentHumanRequestRegistration: {
      findUnique: ({
        where,
      }: {
        where: {
          assessmentId_idempotencyKey: { idempotencyKey: string };
        };
      }) =>
        registrations.get(where.assessmentId_idempotencyKey.idempotencyKey) ??
        null,
      create: ({ data }: { data: Record<string, unknown> }) => {
        registrations.set(data.idempotencyKey as string, data);
        return data;
      },
    },
    assessmentHumanRequest: {
      findUnique: () => null,
      findFirst: () => null,
      create: ({ data }: { data: Record<string, unknown> }) => {
        requests.push(data);
        return data;
      },
    },
    assessmentHumanRequestDependency: {
      upsert: () => Promise.resolve({}),
    },
    assessmentRuleDecision: {
      updateMany: () => Promise.resolve({ count: 0 }),
    },
    assessmentDecisionCoverage: {
      update: () => Promise.resolve({}),
    },
  };
  const support = {
    lockCase: () => undefined,
    loadPins: () => ({
      caseRevision: 3,
      ruleSetVersionId: "ruleset-1",
      repositoryCommit: "a".repeat(40),
    }),
    requireCoverage: (_tx: unknown, _assessmentId: string, id: string) => {
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
  const handler = new OpenHumanRequestsBatchHandler(
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

  const makeRequest = (
    ruleId: string,
    key: string,
  ): OpenAssessmentHumanRequest => ({
    assessmentRuleId: ruleId,
    criterionIds: ["C-1"],
    question: `What is the operating entity for ${ruleId}?`,
    unresolvedFact: `The operating entity of ${ruleId}.`,
    decisionImpact: ["Determines applicability condition."],
    resolutionAttempts: ["Inspected repository manifests."],
    controlType: HUMAN_RESOLUTION_CONTROL_TYPES.FREE_TEXT,
    choices: [],
    expectedCaseRevision: 3,
    idempotencyKey: key,
  });

  return {
    assessmentId,
    handler,
    makeRequest,
    requests,
    registrations,
    transitions,
    coverage,
  };
}

describe("OpenHumanRequestsBatchHandler", () => {
  it("registers multiple questions atomically in one transaction and triggers single transition", async () => {
    const f = fixture();
    const req1 = f.makeRequest("RULE-A", "batch-key-1");
    const req2 = f.makeRequest("RULE-B", "batch-key-2");

    const command = new OpenHumanRequestsBatchCommand(
      f.assessmentId,
      "lease-token",
      { requests: [req1, req2] },
      "corr-1",
    );

    const result = await f.handler.execute(command);
    expect(result.requests).toHaveLength(2);
    expect(result.requests[0]?.caseRevision).toBe(3);
    expect(result.requests[1]?.caseRevision).toBe(3);

    // Persisted 2 requests
    expect(f.requests).toHaveLength(2);
    // Updated coverage for both rules to WAITING_FOR_INPUT
    expect(f.coverage.get("RULE-A")?.resolutionState).toBe(
      DECISION_RESOLUTION_STATES.WAITING_FOR_INPUT,
    );
    expect(f.coverage.get("RULE-B")?.resolutionState).toBe(
      DECISION_RESOLUTION_STATES.WAITING_FOR_INPUT,
    );

    // Exactly one lifecycle transition to WAITING_FOR_HUMAN
    expect(f.transitions).toHaveLength(1);
    expect(f.transitions[0]).toMatchObject({
      toState: ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_HUMAN,
    });
  });

  it("replays idempotently when requests are already registered", async () => {
    const f = fixture();
    const req1 = f.makeRequest("RULE-A", "batch-key-1");

    const command = new OpenHumanRequestsBatchCommand(
      f.assessmentId,
      "lease-token",
      { requests: [req1] },
      "corr-1",
    );

    const first = await f.handler.execute(command);
    expect(f.requests).toHaveLength(1);

    // Replay with identical payload
    const replay = await f.handler.execute(command);
    expect(replay.requests[0]?.requestId).toBe(first.requests[0]?.requestId);
    // No second request created
    expect(f.requests).toHaveLength(1);
  });

  it("rejects batch with 409 when expectedCaseRevision is stale", async () => {
    const f = fixture();
    const req1 = {
      ...f.makeRequest("RULE-A", "batch-key-1"),
      expectedCaseRevision: 2, // current is 3
    };

    const command = new OpenHumanRequestsBatchCommand(
      f.assessmentId,
      "lease-token",
      { requests: [req1] },
      "corr-1",
    );

    await expect(f.handler.execute(command)).rejects.toMatchObject({
      status: 409,
    });
  });

  it("rejects batch with 403 when a rule is outside selected audit membership", async () => {
    const f = fixture(["RULE-A"]); // only RULE-A selected
    const req1 = f.makeRequest("RULE-A", "batch-key-1");
    const req2 = f.makeRequest("RULE-B", "batch-key-2"); // unselected

    const command = new OpenHumanRequestsBatchCommand(
      f.assessmentId,
      "lease-token",
      { requests: [req1, req2] },
      "corr-1",
    );

    await expect(f.handler.execute(command)).rejects.toMatchObject({
      status: 403,
    });
    expect(f.requests).toHaveLength(0);
  });
});
