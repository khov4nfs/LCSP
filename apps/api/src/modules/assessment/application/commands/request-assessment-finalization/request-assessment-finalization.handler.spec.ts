import { randomUUID } from "node:crypto";
import { jest } from "@jest/globals";
import {
  ASSESSMENT_LIFECYCLE_STATES,
  DECISION_RESOLUTION_STATES,
  RULE_DECISION_APPLICABILITIES,
  RULE_DECISION_COMPLIANCE_OUTCOMES,
  RULE_DECISION_CRITERION_OUTCOMES,
  RULE_DECISION_REFERENCE_TYPES,
  ruleDecisionSchema,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_DECISION_RECORD_STATES,
  ASSESSMENT_DECISION_SCOPE,
  ASSESSMENT_EVIDENCE_TYPES,
  RULE_AUDIT_SCOPE_MODES,
  RULE_AUDIT_STATUSES,
} from "@lcsp/contracts/assessment-domain";
import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AssessmentCompletionGate } from "../../services/assessment-completion-gate.service.js";
import type { AssessmentLifecycleCoordinator } from "../../services/assessment-lifecycle-coordinator.service.js";
import type { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";
import type { AssessmentCaseSupport } from "../../../infrastructure/persistence/assessment-case-support.service.js";
import { RequestAssessmentFinalizationCommand } from "./request-assessment-finalization.command.js";
import { RequestAssessmentFinalizationHandler } from "./request-assessment-finalization.handler.js";

it("completes only one validated selected rule without invoking the full-report gate", async () => {
  const assessmentId = randomUUID();
  const requestId = randomUUID();
  const ruleSetVersionId = randomUUID();
  const repositorySnapshotId = randomUUID();
  const evidenceId = randomUUID();
  const repositoryCommit = "a".repeat(40);
  const pins = {
    ruleSetVersionId,
    repositorySnapshotId,
    repositoryCommit,
    caseRevision: 1,
  };
  const reference = {
    type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
    evidenceId,
  };
  const decision = ruleDecisionSchema.parse({
    assessmentRuleId: "Rule-3",
    assessmentRuleVersion: "v1",
    scopeId: ASSESSMENT_DECISION_SCOPE,
    ruleSetVersionId,
    repositorySnapshotId,
    repositoryCommit,
    caseRevision: 1,
    legalContextRefs: [{ legalContextId: "Legal-3" }],
    applicability: RULE_DECISION_APPLICABILITIES.APPLICABLE,
    rationale: "The pinned requirement applies to this repository.",
    references: [reference],
    criteria: [
      {
        criterionId: "C-1",
        outcome: RULE_DECISION_CRITERION_OUTCOMES.MET,
        rationale: "The source supports the criterion.",
        references: [reference],
      },
    ],
    compliance: RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT,
  });
  const updated = jest
    .fn<
      (input: {
        where: { requestId: string };
        data: {
          status: typeof RULE_AUDIT_STATUSES.COMPLETED;
          completedAt: Date;
        };
      }) => Promise<unknown>
    >()
    .mockResolvedValue({});
  const tx = {
    assessmentRuleAuditRequest: {
      findUnique: () =>
        Promise.resolve({
          requestId,
          ruleSetVersionId,
          scopeMode: RULE_AUDIT_SCOPE_MODES.SELECTED_RULES,
          status: RULE_AUDIT_STATUSES.RUNNING,
          rules: [{ assessmentRuleId: "Rule-3", assessmentRuleVersion: "v1" }],
        }),
      update: updated,
    },
    assessmentHumanRequest: { findMany: () => Promise.resolve([]) },
    assessmentDecisionCoverage: {
      findUnique: () =>
        Promise.resolve({
          assessmentRuleVersion: "v1",
          resolutionState: DECISION_RESOLUTION_STATES.RESOLVED,
          currentDecision: {
            state: ASSESSMENT_DECISION_RECORD_STATES.ACCEPTED,
            caseRevision: 1,
            repositoryCommit,
            ruleSetVersionId,
            decision,
          },
        }),
    },
  };
  const fullGate = jest.fn<() => Promise<unknown>>();
  const transition = jest.fn<() => Promise<unknown>>();
  const handler = new RequestAssessmentFinalizationHandler(
    {
      $transaction: async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
    } as unknown as PrismaService,
    {
      authorizeInTx: () =>
        Promise.resolve({
          auditRequestId: requestId,
          lifecycleState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
        }),
    } as unknown as AssessmentRuntimeAuthority,
    { inspectInTx: fullGate } as unknown as AssessmentCompletionGate,
    {
      transitionVerifiedInTx: transition,
    } as unknown as AssessmentLifecycleCoordinator,
    {
      loadPins: () => Promise.resolve(pins),
      buildValidationContext: () =>
        Promise.resolve({
          caseRevision: 1,
          pins,
          rule: {
            assessmentRuleId: "Rule-3",
            assessmentRuleVersion: "v1",
            criterionIds: new Set(["C-1"]),
            legalContextIds: new Set(["Legal-3"]),
            declaredElements: new Map(),
          },
          evidence: new Map([
            [
              evidenceId,
              {
                state: "ACCEPTED",
                repositoryCommit,
                type: ASSESSMENT_EVIDENCE_TYPES.REPOSITORY_SOURCE,
                payload: {},
              },
            ],
          ]),
          facts: new Map(),
        }),
    } as unknown as AssessmentCaseSupport,
  );

  const result = await handler.execute(
    new RequestAssessmentFinalizationCommand(
      assessmentId,
      randomUUID(),
      {},
      randomUUID(),
    ),
  );

  expect(result).toEqual({
    lifecycleState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
    blockers: [],
  });
  const update = updated.mock.calls[0]?.[0];
  expect(update?.where).toEqual({ requestId });
  expect(update?.data.status).toBe(RULE_AUDIT_STATUSES.COMPLETED);
  expect(update?.data.completedAt).toBeInstanceOf(Date);
  expect(fullGate).not.toHaveBeenCalled();
  expect(transition).not.toHaveBeenCalled();
});
