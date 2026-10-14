import {
  RULE_DECISION_APPLICABILITIES,
  RULE_DECISION_BASIS_FINDINGS,
  RULE_DECISION_BASIS_KINDS,
  RULE_DECISION_REFERENCE_TYPES,
  ruleDecisionReferences,
  type RuleDecision,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_DECISION_SCOPE,
  ASSESSMENT_EVIDENCE_TYPES,
  ASSESSMENT_FACT_AUTHORITIES,
  ASSESSMENT_RECORD_STATES,
  DECISION_VALIDATION_FAILURE_CODES,
  searchCoverageEvidenceRequestSchema,
  type DecisionValidationFailureCode,
} from "@lcsp/contracts/assessment-domain";

export interface DecisionValidationFailure {
  code: DecisionValidationFailureCode;
  ref: string;
}

export interface DecisionValidationContext {
  caseRevision: number;
  pins: {
    ruleSetVersionId: string;
    repositorySnapshotId: string;
    repositoryCommit: string;
  };
  /** The pinned rule set's AssessmentRule, or null when the ID is not in it. */
  rule: {
    assessmentRuleId: string;
    assessmentRuleVersion: string;
    criterionIds: ReadonlySet<string>;
    /** LegalRequirement IDs linked to the rule (and their directly related context rules). */
    legalContextIds: ReadonlySet<string>;
    /**
     * How many applicability elements each LINKED LegalRequirement declares, per kind. These lists
     * are authored from the legal source; the validator only counts and indexes them.
     */
    declaredElements: ReadonlyMap<
      string,
      {
        applicabilityConditions: number;
        qualifiers: number;
        exceptions: number;
      }
    >;
  } | null;
  evidence: ReadonlyMap<
    string,
    { state: string; repositoryCommit: string; type: string; payload: unknown }
  >;
  facts: ReadonlyMap<
    string,
    {
      state: string;
      caseRevision: number;
      authority: string;
      evidenceIds: readonly string[];
    }
  >;
}

/**
 * DETERMINISTIC_GUARD. Checks a Root-authored packet's exact identity, pins, revisions,
 * criterion completeness and reference authority against server state. It never re-evaluates
 * what the Root decided: applicability, criterion outcomes, compliance, rationale and the
 * sufficiency of evidence are all left untouched.
 */
export function validateRuleDecision(
  decision: RuleDecision,
  context: DecisionValidationContext,
): DecisionValidationFailure[] {
  const failures: DecisionValidationFailure[] = [];
  const fail = (code: DecisionValidationFailureCode, ref: string) =>
    failures.push({ code, ref });

  if (!context.rule) {
    fail(
      DECISION_VALIDATION_FAILURE_CODES.UNKNOWN_ASSESSMENT_RULE,
      decision.assessmentRuleId,
    );
  } else {
    if (context.rule.assessmentRuleVersion !== decision.assessmentRuleVersion) {
      fail(
        DECISION_VALIDATION_FAILURE_CODES.ASSESSMENT_RULE_VERSION_MISMATCH,
        decision.assessmentRuleId,
      );
    }
    for (const legal of decision.legalContextRefs) {
      if (!context.rule.legalContextIds.has(legal.legalContextId)) {
        fail(
          DECISION_VALIDATION_FAILURE_CODES.UNKNOWN_LEGAL_CONTEXT,
          legal.legalContextId,
        );
      }
    }
    if (decision.applicability === RULE_DECISION_APPLICABILITIES.APPLICABLE) {
      const submitted = new Set(decision.criteria.map((c) => c.criterionId));
      for (const required of context.rule.criterionIds) {
        if (!submitted.has(required)) {
          fail(DECISION_VALIDATION_FAILURE_CODES.CRITERIA_INCOMPLETE, required);
        }
      }
      for (const criterionId of submitted) {
        if (!context.rule.criterionIds.has(criterionId)) {
          fail(
            DECISION_VALIDATION_FAILURE_CODES.UNKNOWN_CRITERION,
            criterionId,
          );
        }
      }
    }
  }

  if (decision.ruleSetVersionId !== context.pins.ruleSetVersionId) {
    fail(
      DECISION_VALIDATION_FAILURE_CODES.RULE_SET_PIN_MISMATCH,
      decision.ruleSetVersionId,
    );
  }
  if (
    decision.repositorySnapshotId !== context.pins.repositorySnapshotId ||
    decision.repositoryCommit !== context.pins.repositoryCommit
  ) {
    fail(
      DECISION_VALIDATION_FAILURE_CODES.REPOSITORY_PIN_MISMATCH,
      decision.repositorySnapshotId,
    );
  }
  if (decision.caseRevision !== context.caseRevision) {
    fail(
      DECISION_VALIDATION_FAILURE_CODES.CASE_REVISION_STALE,
      String(decision.caseRevision),
    );
  }
  if (decision.scopeId !== ASSESSMENT_DECISION_SCOPE) {
    fail(DECISION_VALIDATION_FAILURE_CODES.UNKNOWN_SCOPE, decision.scopeId);
  }

  if (context.rule) {
    validateApplicabilityBasis(decision, context.rule.declaredElements, fail);
  }

  const references = ruleDecisionReferences(decision);
  const seen = new Set<string>();
  const validateEvidence = (evidenceId: string) => {
    const key = `E:${evidenceId}`;
    if (seen.has(key)) return;
    seen.add(key);
    const evidence = context.evidence.get(evidenceId);
    if (!evidence) {
      fail(
        DECISION_VALIDATION_FAILURE_CODES.UNKNOWN_EVIDENCE_REFERENCE,
        evidenceId,
      );
    } else if (evidence.state !== ASSESSMENT_RECORD_STATES.ACCEPTED) {
      fail(DECISION_VALIDATION_FAILURE_CODES.EVIDENCE_NOT_ACCEPTED, evidenceId);
    } else if (evidence.repositoryCommit !== context.pins.repositoryCommit) {
      fail(DECISION_VALIDATION_FAILURE_CODES.EVIDENCE_PIN_MISMATCH, evidenceId);
    } else if (evidence.type === ASSESSMENT_EVIDENCE_TYPES.SEARCH_COVERAGE) {
      const coverage = searchCoverageEvidenceRequestSchema
        .omit({ type: true, repositoryCommit: true })
        .safeParse(evidence.payload);
      if (
        !coverage.success ||
        coverage.data.knownGaps.length > 0 ||
        coverage.data.queries.some((query) => query.truncated)
      ) {
        fail(
          DECISION_VALIDATION_FAILURE_CODES.SEARCH_COVERAGE_INCOMPLETE,
          evidenceId,
        );
      }
    }
  };
  for (const reference of references) {
    if (reference.type === RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE) {
      validateEvidence(reference.evidenceId);
    } else {
      const key = `F:${reference.factId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const fact = context.facts.get(reference.factId);
      if (!fact) {
        fail(
          DECISION_VALIDATION_FAILURE_CODES.UNKNOWN_FACT_REFERENCE,
          reference.factId,
        );
      } else if (fact.state !== ASSESSMENT_RECORD_STATES.ACCEPTED) {
        fail(
          DECISION_VALIDATION_FAILURE_CODES.FACT_NOT_ACCEPTED,
          reference.factId,
        );
      } else if (fact.caseRevision > decision.caseRevision) {
        fail(
          DECISION_VALIDATION_FAILURE_CODES.FACT_REVISION_MISMATCH,
          reference.factId,
        );
      } else {
        if (
          fact.authority === ASSESSMENT_FACT_AUTHORITIES.EVIDENCE_CITED &&
          fact.evidenceIds.length === 0
        ) {
          fail(
            DECISION_VALIDATION_FAILURE_CODES.FACT_EVIDENCE_MISSING,
            reference.factId,
          );
        }
        for (const evidenceId of fact.evidenceIds) validateEvidence(evidenceId);
      }
    }
  }
  return failures;
}

type DeclaredElements = NonNullable<
  DecisionValidationContext["rule"]
>["declaredElements"];

const ELEMENT_COUNT_KEY = {
  [RULE_DECISION_BASIS_KINDS.APPLICABILITY_CONDITION]:
    "applicabilityConditions",
  [RULE_DECISION_BASIS_KINDS.QUALIFIER]: "qualifiers",
  [RULE_DECISION_BASIS_KINDS.EXCEPTION]: "exceptions",
} as const;

/**
 * Structure of the element-by-element applicability findings, never their correctness:
 * every finding names an element the linked requirement really declares and carries the
 * references its finding needs; the overall applicability must cohere with the findings; and,
 * where the requirements declare elements at all, a duty is not declared inapplicable (or
 * applicable) without a finding that supports it. "Not established" never counts as support
 * for either outcome, so a missing fact cannot become NOT_APPLICABLE. Which roles, categories or
 * conditions exist comes only from the pinned rule set.
 */
function validateApplicabilityBasis(
  decision: RuleDecision,
  declared: DeclaredElements,
  fail: (code: DecisionValidationFailureCode, ref: string) => void,
): void {
  const basis = decision.applicabilityBasis ?? [];
  let refuting = false;
  let establishing = false;
  for (const entry of basis) {
    const ref = `${entry.legalRequirementId}:${entry.kind}:${entry.index}`;
    const counts = declared.get(entry.legalRequirementId);
    if (!counts || entry.index >= counts[ELEMENT_COUNT_KEY[entry.kind]]) {
      fail(
        DECISION_VALIDATION_FAILURE_CODES.UNKNOWN_APPLICABILITY_ELEMENT,
        ref,
      );
      continue;
    }
    if (
      entry.finding !== RULE_DECISION_BASIS_FINDINGS.NOT_ESTABLISHED &&
      entry.references.length === 0
    ) {
      fail(
        DECISION_VALIDATION_FAILURE_CODES.APPLICABILITY_BASIS_UNREFERENCED,
        ref,
      );
    }
    const isCondition =
      entry.kind === RULE_DECISION_BASIS_KINDS.APPLICABILITY_CONDITION;
    const isException = entry.kind === RULE_DECISION_BASIS_KINDS.EXCEPTION;
    if (
      (isCondition && entry.finding === RULE_DECISION_BASIS_FINDINGS.REFUTED) ||
      (isException &&
        entry.finding === RULE_DECISION_BASIS_FINDINGS.ESTABLISHED)
    ) {
      refuting = true;
    }
    if (
      isCondition &&
      entry.finding === RULE_DECISION_BASIS_FINDINGS.ESTABLISHED
    ) {
      establishing = true;
    }
  }

  let conditionCount = 0;
  let elementCount = 0;
  for (const counts of declared.values()) {
    conditionCount += counts.applicabilityConditions;
    elementCount += counts.applicabilityConditions + counts.exceptions;
  }
  if (decision.applicability === RULE_DECISION_APPLICABILITIES.NOT_APPLICABLE) {
    if (elementCount > 0 && !refuting) {
      fail(
        DECISION_VALIDATION_FAILURE_CODES.APPLICABILITY_BASIS_REQUIRED,
        decision.assessmentRuleId,
      );
    }
    return;
  }
  if (refuting) {
    fail(
      DECISION_VALIDATION_FAILURE_CODES.APPLICABILITY_BASIS_CONTRADICTION,
      decision.assessmentRuleId,
    );
  }
  if (conditionCount > 0 && !establishing) {
    fail(
      DECISION_VALIDATION_FAILURE_CODES.APPLICABILITY_BASIS_REQUIRED,
      decision.assessmentRuleId,
    );
  }
}
