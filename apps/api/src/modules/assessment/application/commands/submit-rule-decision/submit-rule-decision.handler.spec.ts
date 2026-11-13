import { randomUUID } from "node:crypto";
import { describe, expect, it, jest } from "@jest/globals";
import {
  ASSESSMENT_LIFECYCLE_STATES,
  DECISION_RESOLUTION_STATES,
  HUMAN_RESOLUTION_REQUEST_STATUSES,
  RULE_DECISION_APPLICABILITIES,
  RULE_DECISION_COMPLIANCE_OUTCOMES,
  RULE_DECISION_CRITERION_OUTCOMES,
  RULE_DECISION_REFERENCE_TYPES,
  ruleDecisionSchema,
  type RuleDecision,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_DECISION_RECORD_STATES,
  ASSESSMENT_DECISION_SCOPE,
  ASSESSMENT_DOMAIN_ERROR_CODES,
  ASSESSMENT_EVIDENCE_TYPES,
} from "@lcsp/contracts/assessment-domain";
import { HttpStatus } from "@nestjs/common";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { SubmitRuleDecisionCommand } from "./submit-rule-decision.command.js";
import { SubmitRuleDecisionHandler } from "./submit-rule-decision.handler.js";

function buildDecision(params: {
  assessmentRuleId?: string;
  ruleSetVersionId?: string;
  repositorySnapshotId?: string;
  repositoryCommit?: string;
  evidenceId?: string;
}): RuleDecision {
  const reference = {
    type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
    evidenceId: params.evidenceId ?? randomUUID(),
  };
  return ruleDecisionSchema.parse({
    assessmentRuleId: params.assessmentRuleId ?? "RULE-1",
    assessmentRuleVersion: "1.0.0",
    scopeId: ASSESSMENT_DECISION_SCOPE,
    ruleSetVersionId: params.ruleSetVersionId ?? randomUUID(),
    repositorySnapshotId: params.repositorySnapshotId ?? randomUUID(),
    repositoryCommit: params.repositoryCommit ?? "a".repeat(40),
    caseRevision: 1,
    legalContextRefs: [{ legalContextId: "legal-1" }],
    applicability: RULE_DECISION_APPLICABILITIES.APPLICABLE,
    compliance: RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT,
    rationale: "Rule requirement verified by accepted repository evidence.",
    references: [reference],
    criteria: [
      {
        criterionId: "crit-1",
        outcome: RULE_DECISION_CRITERION_OUTCOMES.MET,
        rationale: "Criterion satisfied by source evidence.",
        references: [reference],
      },
    ],
  });
}

describe("SubmitRuleDecisionHandler", () => {
  const assessmentId = randomUUID();
  const leaseToken = "lease-token-123";
  const correlationId = "corr-submit-test";
  const auditRequestId = randomUUID();
  const ruleId = "RULE-1";

  function createFixture(overrides: {
    authorityThrows?: boolean;
    coverageState?: string;
    openHumanRequest?: boolean;
    reusedDecisionId?: string | null;
    reusedDecisionState?: string;
    replayDecision?: Record<string, unknown> | null;
    previousDecisionRevision?: number;
    previousDecisionState?: string;
  } = {}) {
    const evidenceId = randomUUID();
    const decision = buildDecision({
      assessmentRuleId: ruleId,
      evidenceId,
    });
    const pins = {
      caseRevision: 1,
      ruleSetVersionId: decision.ruleSetVersionId,
      repositorySnapshotId: decision.repositorySnapshotId,
      repositoryCommit: decision.repositoryCommit,
      repositoryScanJobId: randomUUID(),
      sourcePathPrefix: null,
    };

    const createdDecisions: unknown[] = [];
    const updatedDecisions: unknown[] = [];
    const updatedCoverages: unknown[] = [];

    const tx = {
      assessmentRuleAuditItem: {
        findUnique: jest.fn(() =>
          Promise.resolve(
            overrides.reusedDecisionId !== undefined
              ? { reusedDecisionId: overrides.reusedDecisionId }
              : null,
          ),
        ),
      },
      assessmentHumanRequest: {
        findFirst: jest.fn(() =>
          Promise.resolve(
            overrides.openHumanRequest
              ? { requestId: randomUUID(), assessmentRuleId: ruleId }
              : null,
          ),
        ),
      },
      assessmentRuleDecision: {
        findUnique: jest.fn<
          (args?: {
            where?: {
              decisionId?: string;
              assessmentId_idempotencyKey?: unknown;
            };
          }) => Promise<unknown>
        >(() => Promise.resolve(overrides.replayDecision ?? null)),
        findFirst: jest.fn(() =>
          Promise.resolve(
            overrides.previousDecisionRevision !== undefined
              ? {
                  decisionId: randomUUID(),
                  decisionRevision: overrides.previousDecisionRevision,
                  state:
                    overrides.previousDecisionState ??
                    ASSESSMENT_DECISION_RECORD_STATES.ACCEPTED,
                }
              : null,
          ),
        ),
        create: jest.fn((args: unknown) => {
          createdDecisions.push(args);
          return Promise.resolve(args);
        }),
        update: jest.fn((args: unknown) => {
          updatedDecisions.push(args);
          return Promise.resolve(args);
        }),
      },
      assessmentDecisionCoverage: {
        update: jest.fn((args: unknown) => {
          updatedCoverages.push(args);
          return Promise.resolve(args);
        }),
      },
    };

    const authority = {
      authorizeInTx: jest.fn(() => {
        if (overrides.authorityThrows) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.NOT_ACTIVE,
            correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }
        return Promise.resolve({
          assessmentId,
          threadId: randomUUID(),
          executionId: randomUUID(),
          auditRequestId,
          lifecycleState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
          lifecycleRevision: 1,
          blockerReason: null,
          blockerReference: null,
        });
      }),
      requireSelectedRuleMembershipInTx: jest.fn(() => Promise.resolve()),
    };

    const support = {
      loadPins: jest.fn(() => Promise.resolve(pins)),
      lockCase: jest.fn(() => Promise.resolve()),
      requireCoverage: jest.fn(() =>
        Promise.resolve({
          assessmentId,
          assessmentRuleId: ruleId,
          resolutionState:
            overrides.coverageState ?? DECISION_RESOLUTION_STATES.INVESTIGATING,
          currentDecisionId: overrides.reusedDecisionId ?? randomUUID(),
          decisionRevision: overrides.previousDecisionRevision ?? 0,
        }),
      ),
      buildValidationContext: jest.fn(() =>
        Promise.resolve({
          caseRevision: 1,
          pins,
          rule: {
            assessmentRuleId: ruleId,
            assessmentRuleVersion: "1.0.0",
            criterionIds: new Set(["crit-1"]),
            legalContextIds: new Set(["legal-1"]),
            declaredElements: new Map(),
          },
          evidence: new Map([
            [
              evidenceId,
              {
                state: "ACCEPTED",
                repositoryCommit: decision.repositoryCommit,
                type: ASSESSMENT_EVIDENCE_TYPES.REPOSITORY_SOURCE,
                payload: {},
              },
            ],
          ]),
          facts: new Map(),
        }),
      ),
      advanceCoverageToResolved: jest.fn(() => Promise.resolve()),
    };

    const events = {
      appendInTx: jest.fn(() => Promise.resolve()),
    };

    const audit = {
      writeAuditRecord: jest.fn(() => Promise.resolve()),
      writeInTx: jest.fn(() => Promise.resolve()),
    };

    const handler = new SubmitRuleDecisionHandler(
      {
        $transaction: async (cb: (client: typeof tx) => Promise<unknown>) =>
          cb(tx),
      } as never,
      authority as never,
      support as never,
      events as never,
      audit as never,
    );

    return {
      handler,
      decision,
      createdDecisions,
      updatedDecisions,
      updatedCoverages,
      tx,
      support,
    };
  }

  it("C01: blocks post-open WAITING submit when lifecycle is WAITING_FOR_HUMAN with zero writes", async () => {
    const { handler, decision, createdDecisions } = createFixture({
      authorityThrows: true,
    });

    const command = new SubmitRuleDecisionCommand(
      assessmentId,
      leaseToken,
      {
        expectedDecisionRevision: 0,
        idempotencyKey: `idemp-${randomUUID()}`,
        decision,
      },
      correlationId,
    );

    await expect(handler.execute(command)).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
    });
    expect(createdDecisions).toHaveLength(0);
  });

  it("C02: blocks submit when injected ACTIVE but an open human request exists on the rule", async () => {
    const { handler, decision, createdDecisions } = createFixture({
      openHumanRequest: true,
    });

    const command = new SubmitRuleDecisionCommand(
      assessmentId,
      leaseToken,
      {
        expectedDecisionRevision: 0,
        idempotencyKey: `idemp-${randomUUID()}`,
        decision,
      },
      correlationId,
    );

    await expect(handler.execute(command)).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
    });
    expect(createdDecisions).toHaveLength(0);
  });

  it("blocks submit when coverage is WAITING_FOR_INPUT with zero writes", async () => {
    const { handler, decision, createdDecisions } = createFixture({
      coverageState: DECISION_RESOLUTION_STATES.WAITING_FOR_INPUT,
    });

    const command = new SubmitRuleDecisionCommand(
      assessmentId,
      leaseToken,
      {
        expectedDecisionRevision: 0,
        idempotencyKey: `idemp-${randomUUID()}`,
        decision,
      },
      correlationId,
    );

    await expect(handler.execute(command)).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
    });
    expect(createdDecisions).toHaveLength(0);
  });

  it("reused-decision guard: rejects new submission when reused decision is still ACCEPTED and coverage is RESOLVED", async () => {
    const reusedDecisionId = randomUUID();
    const { handler, decision, createdDecisions, tx } = createFixture({
      reusedDecisionId,
      coverageState: DECISION_RESOLUTION_STATES.RESOLVED,
    });

    tx.assessmentRuleDecision.findUnique.mockImplementation(
      (args?: { where?: { decisionId?: string } }) => {
        if (args?.where?.decisionId === reusedDecisionId) {
          return Promise.resolve({
            decisionId: reusedDecisionId,
            state: ASSESSMENT_DECISION_RECORD_STATES.ACCEPTED,
          });
        }
        return Promise.resolve(null);
      },
    );

    const command = new SubmitRuleDecisionCommand(
      assessmentId,
      leaseToken,
      {
        expectedDecisionRevision: 1,
        idempotencyKey: `idemp-${randomUUID()}`,
        decision,
      },
      correlationId,
    );

    await expect(handler.execute(command)).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
    });
    expect(createdDecisions).toHaveLength(0);
  });

  it("reused-decision recovery: allows successor submission when reused decision was INVALIDATED", async () => {
    const reusedDecisionId = randomUUID();
    const { handler, decision, createdDecisions, support, tx } = createFixture({
      reusedDecisionId,
      coverageState: DECISION_RESOLUTION_STATES.INVALIDATED,
      previousDecisionRevision: 1,
      previousDecisionState: ASSESSMENT_DECISION_RECORD_STATES.INVALIDATED,
    });

    tx.assessmentRuleDecision.findUnique.mockImplementation(
      (args?: { where?: { decisionId?: string } }) => {
        if (args?.where?.decisionId === reusedDecisionId) {
          return Promise.resolve({
            decisionId: reusedDecisionId,
            state: ASSESSMENT_DECISION_RECORD_STATES.INVALIDATED,
          });
        }
        return Promise.resolve(null);
      },
    );

    const command = new SubmitRuleDecisionCommand(
      assessmentId,
      leaseToken,
      {
        expectedDecisionRevision: 1,
        idempotencyKey: `idemp-${randomUUID()}`,
        decision,
      },
      correlationId,
    );

    const result = await handler.execute(command);
    expect(result.decisionRevision).toBe(2);
    expect(result.replayed).toBe(false);
    expect(createdDecisions).toHaveLength(1);
    expect(support.advanceCoverageToResolved).toHaveBeenCalled();
  });

  it("exact replay: returns replayed decision without duplicate writes", async () => {
    const existingDecisionId = randomUUID();
    const { handler, decision, createdDecisions, tx } = createFixture();

    tx.assessmentRuleDecision.findUnique.mockImplementation(
      (args?: { where?: { assessmentId_idempotencyKey?: unknown } }) => {
        if (args?.where?.assessmentId_idempotencyKey) {
          return Promise.resolve({
            decisionId: existingDecisionId,
            decisionRevision: 1,
            state: ASSESSMENT_DECISION_RECORD_STATES.ACCEPTED,
            decision,
          });
        }
        return Promise.resolve(null);
      },
    );

    const command = new SubmitRuleDecisionCommand(
      assessmentId,
      leaseToken,
      {
        expectedDecisionRevision: 1,
        idempotencyKey: `idemp-replay`,
        decision,
      },
      correlationId,
    );

    const result = await handler.execute(command);
    expect(result).toEqual({
      decisionId: existingDecisionId,
      decisionRevision: 1,
      replayed: true,
    });
    expect(createdDecisions).toHaveLength(0);
  });

  it("invalidated replay: rejects replay of an INVALIDATED decision and does not revive", async () => {
    const existingDecisionId = randomUUID();
    const { handler, decision, createdDecisions, tx } = createFixture();

    tx.assessmentRuleDecision.findUnique.mockImplementation(
      (args?: { where?: { assessmentId_idempotencyKey?: unknown } }) => {
        if (args?.where?.assessmentId_idempotencyKey) {
          return Promise.resolve({
            decisionId: existingDecisionId,
            decisionRevision: 1,
            state: ASSESSMENT_DECISION_RECORD_STATES.INVALIDATED,
            decision,
          });
        }
        return Promise.resolve(null);
      },
    );

    const command = new SubmitRuleDecisionCommand(
      assessmentId,
      leaseToken,
      {
        expectedDecisionRevision: 1,
        idempotencyKey: `idemp-replay-invalidated`,
        decision,
      },
      correlationId,
    );

    await expect(handler.execute(command)).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
    });
    expect(createdDecisions).toHaveLength(0);
  });
});
