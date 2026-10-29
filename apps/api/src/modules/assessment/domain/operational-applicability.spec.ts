import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, jest } from "@jest/globals";
import {
  RULE_DECISION_APPLICABILITIES as Applicability,
  RULE_DECISION_BASIS_FINDINGS as Finding,
  RULE_DECISION_BASIS_KINDS as Kind,
  RULE_DECISION_REFERENCE_TYPES as Ref,
  ruleDecisionReferences,
  ruleDecisionSchema,
  type RuleDecision,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_EVIDENCE_TYPES as Evidence,
  ASSESSMENT_FACT_AUTHORITIES as Authority,
  ASSESSMENT_RECORD_STATES as State,
  DECISION_VALIDATION_FAILURE_CODES as FAIL,
  ASSESSMENT_DECISION_RECORD_STATES as DecisionState,
} from "@lcsp/contracts/assessment-domain";
import {
  validateRuleDecision,
  type DecisionValidationContext,
} from "./decision-validator.js";
import { SubmitRuleDecisionHandler } from "../application/commands/submit-rule-decision/submit-rule-decision.handler.js";
import { SubmitRuleDecisionCommand } from "../application/commands/submit-rule-decision/submit-rule-decision.command.js";

type Scenario = {
  assessmentRuleId: string;
  legalRequirementId: string;
  operativePropositions: unknown[];
  applicabilityConditions: string[];
  qualifiers: string[];
  exceptions: string[];
  decision: RuleDecision;
};
const fixture = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      "../../tests/fixtures/assessment-root/operational-applicability.json",
    ),
    "utf8",
  ),
) as { historicalCases: Scenario[] };
const humanId = "12345678-1234-4234-8234-123456789abc";

function contextFor(row: Scenario): DecisionValidationContext {
  const decision = ruleDecisionSchema.parse(row.decision);
  const refs = ruleDecisionReferences(decision);
  return {
    caseRevision: decision.caseRevision,
    pins: decision,
    rule: {
      assessmentRuleId: decision.assessmentRuleId,
      assessmentRuleVersion: decision.assessmentRuleVersion,
      criterionIds: new Set(decision.criteria.map((c) => c.criterionId)),
      legalContextIds: new Set(
        decision.legalContextRefs.map((r) => r.legalContextId),
      ),
      declaredElements: new Map([
        [
          row.legalRequirementId,
          {
            applicabilityConditions: row.applicabilityConditions.length,
            qualifiers: row.qualifiers.length,
            exceptions: row.exceptions.length,
            operativeScopes: row.operativePropositions.length,
          },
        ],
      ]),
    },
    evidence: new Map(
      refs.flatMap((r) =>
        r.type === Ref.ASSESSMENT_EVIDENCE
          ? [
              [
                r.evidenceId,
                {
                  state: State.ACCEPTED,
                  repositoryCommit: decision.repositoryCommit,
                  type: Evidence.REPOSITORY_SOURCE,
                  payload: {},
                },
              ] as const,
            ]
          : [],
      ),
    ),
    facts: new Map(
      refs.flatMap((r) =>
        r.type === Ref.CONFIRMED_FACT
          ? [
              [
                r.factId,
                {
                  state: State.ACCEPTED,
                  caseRevision: 1,
                  authority: Authority.EVIDENCE_CITED,
                  evidenceIds: decision.references.flatMap((e) =>
                    e.type === Ref.ASSESSMENT_EVIDENCE ? [e.evidenceId] : [],
                  ),
                },
              ] as const,
            ]
          : [],
      ),
    ),
  };
}
function scopes(
  row: Scenario,
  finding: (typeof Finding)[keyof typeof Finding],
  references: RuleDecision["references"] = [],
) {
  return row.operativePropositions.map((_, index) => ({
    legalRequirementId: row.legalRequirementId,
    kind: Kind.OPERATIVE_SCOPE,
    index,
    finding,
    rationale:
      "Actor, actual processing and inherited legal scope remain unverified by repository capabilities.",
    references,
  }));
}

describe.each(fixture.historicalCases)(
  "historical applicability: $assessmentRuleId",
  (row) => {
    it("native idempotent replay cannot bypass the current applicability guard", async () => {
      const write = jest.fn();
      const transaction = {
        assessmentRuleDecision: {
          findUnique: () =>
            Promise.resolve({
              decision: row.decision,
              state: DecisionState.ACCEPTED,
              decisionId: "historical",
              decisionRevision: 1,
            }),
          create: write,
        },
      };
      const args = [
        {
          $transaction: (fn: (tx: typeof transaction) => unknown) =>
            fn(transaction),
        },
        { authorizeInTx: () => Promise.resolve({ executionId: "execution" }) },
        {
          loadPins: () => Promise.resolve(row.decision),
          lockCase: () => Promise.resolve(),
          requireCoverage: () => Promise.resolve({}),
          buildValidationContext: () => Promise.resolve(contextFor(row)),
        },
        {},
        {},
      ] as unknown as ConstructorParameters<typeof SubmitRuleDecisionHandler>;
      const handler = new SubmitRuleDecisionHandler(...args);
      const command = new SubmitRuleDecisionCommand(
        "assessment",
        "lease",
        {
          expectedDecisionRevision: 1,
          idempotencyKey: "native-replay",
          decision: row.decision,
        },
        "test-correlation",
      );
      await expect(handler.execute(command)).rejects.toMatchObject({
        status: 422,
      });
      expect(write).not.toHaveBeenCalled();
    });
    it("rejects the original accepted packet that omits actor/activity scope", () => {
      expect(
        validateRuleDecision(row.decision, contextFor(row)).map((f) => f.code),
      ).toContain(FAIL.APPLICABILITY_BASIS_REQUIRED);
    });
    it("an established operative scope cannot substitute for a separate source condition", () => {
      const context = contextFor(row);
      const declared = context.rule!.declaredElements.get(
        row.legalRequirementId,
      )!;
      context.rule = {
        ...context.rule!,
        declaredElements: new Map([
          [row.legalRequirementId, { ...declared, applicabilityConditions: 1 }],
        ]),
      };
      const decision = ruleDecisionSchema.parse({
        ...row.decision,
        applicabilityBasis: scopes(
          row,
          Finding.ESTABLISHED,
          row.decision.references,
        ),
      });
      expect(
        validateRuleDecision(decision, context).map((f) => f.code),
      ).toContain(FAIL.APPLICABILITY_BASIS_REQUIRED);
    });
    it("does not turn an unresolved operative scope into either final applicability verdict", () => {
      const basis = scopes(row, Finding.NOT_ESTABLISHED);
      const applicable = ruleDecisionSchema.parse({
        ...row.decision,
        applicabilityBasis: basis,
      });
      const notApplicable = ruleDecisionSchema.parse({
        ...row.decision,
        applicability: Applicability.NOT_APPLICABLE,
        compliance: null,
        criteria: [],
        applicabilityBasis: basis,
      });
      for (const decision of [applicable, notApplicable]) {
        expect(
          validateRuleDecision(decision, contextFor(row)).map((f) => f.code),
        ).toContain(FAIL.APPLICABILITY_BASIS_REQUIRED);
      }
    });
    it("accepts a Root finding supported by an explicit current operational fact", () => {
      const context = contextFor(row);
      context.facts = new Map([
        ...context.facts,
        [
          humanId,
          {
            state: State.ACCEPTED,
            caseRevision: row.decision.caseRevision,
            authority: Authority.HUMAN_PROVIDED,
            evidenceIds: [],
          },
        ],
      ]);
      const reference = {
        type: Ref.CONFIRMED_FACT,
        factId: humanId,
        caseRevision: row.decision.caseRevision,
      };
      const decision = ruleDecisionSchema.parse({
        ...row.decision,
        applicabilityBasis: scopes(row, Finding.ESTABLISHED, [reference]),
      });
      expect(validateRuleDecision(decision, context)).toEqual([]);
      // Acceptance validates provenance, not the truth of a model's semantic conclusion.
      context.facts = new Map();
      expect(
        validateRuleDecision(decision, context).map((f) => f.code),
      ).toContain(FAIL.UNKNOWN_FACT_REFERENCE);
    });
    it("requires every operative address and retains pin/revision fences after resume", () => {
      const decision = ruleDecisionSchema.parse({
        ...row.decision,
        applicabilityBasis: scopes(
          row,
          Finding.ESTABLISHED,
          row.decision.references,
        ),
      });
      const context = contextFor(row);
      const partial = {
        ...decision,
        applicabilityBasis: decision.applicabilityBasis!.slice(1),
      };
      expect(
        validateRuleDecision(partial, context).map((f) => f.code),
      ).toContain(FAIL.APPLICABILITY_BASIS_REQUIRED);
      context.caseRevision++;
      expect(
        validateRuleDecision(decision, context).map((f) => f.code),
      ).toContain(FAIL.CASE_REVISION_STALE);
      context.pins = { ...context.pins, repositoryCommit: "a".repeat(40) };
      expect(
        validateRuleDecision(decision, context).map((f) => f.code),
      ).toContain(FAIL.REPOSITORY_PIN_MISMATCH);
    });
  },
);
