import {
  APPLICABILITY_CONDITION_LOGIC,
  RULE_DECISION_APPLICABILITIES,
  RULE_DECISION_BASIS_FINDINGS,
  RULE_DECISION_BASIS_KINDS,
  RULE_DECISION_REFERENCE_TYPES,
  ruleDecisionReferences,
  type ApplicabilityConditionLogic,
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
    declaredElements: DeclaredElements;
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
 * Business purpose: Gate Root-authored decisions against the authoritative Customer case.
 * Business rules:
 * - Rule identity/version, repository/source pins, case revision, criteria and accepted
 *   evidence/fact references must match the persisted authority.
 * Execution flow:
 * 1. Check exact identities, applicability-basis structure and all referenced evidence and
 *   facts, collecting individual validation failures.
 * Failure cases:
 * - Missing, stale, rejected or incomplete references produce typed failures.
 * Side effects:
 * - None; the stored case and model-authored conclusions remain unchanged.
 *   DETERMINISTIC_GUARD: Applicability, compliance, rationale and factual sufficiency remain
 *   decisions of the Root rather than this structural validator.
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

export interface DeclaredLegalElementCounts {
  applicabilityConditions: number;
  qualifiers: number;
  exceptions: number;
  /** One actor/activity/scope assessment per source-authored operative proposition. */
  operativeScopes?: number;
  /**
   * Logical connector for applicability conditions:
   * - "ALL" (conjunction / AND): all applicability conditions must be ESTABLISHED for APPLICABLE.
   *   Any REFUTED condition refutes the requirement and contradicts APPLICABLE.
   * - "ANY" (disjunction / OR): at least one applicability condition must be ESTABLISHED for APPLICABLE.
   *   Refuting one branch does not contradict APPLICABLE if an alternative branch is ESTABLISHED.
   *   NOT_APPLICABLE requires all branches to be REFUTED (or exception established / operative scope refuted).
   */
  conditionLogic?: ApplicabilityConditionLogic | "ALL" | "ANY";
  /**
   * Indices of conditions that are material and must not be left NOT_ESTABLISHED or omitted when asserting APPLICABLE.
   */
  materialConditionIndices?: readonly number[];
}

export type DeclaredElements = ReadonlyMap<string, DeclaredLegalElementCounts>;

const ELEMENT_COUNT_KEY = {
  [RULE_DECISION_BASIS_KINDS.OPERATIVE_SCOPE]: "operativeScopes",
  [RULE_DECISION_BASIS_KINDS.APPLICABILITY_CONDITION]:
    "applicabilityConditions",
  [RULE_DECISION_BASIS_KINDS.QUALIFIER]: "qualifiers",
  [RULE_DECISION_BASIS_KINDS.EXCEPTION]: "exceptions",
} as const;

/**
 * Business purpose: Validate the legal-element basis behind submitted applicability findings.
 * Business rules:
 * - Findings name real source-declared operative scopes, conditions, qualifiers or exceptions; referenced
 *   established/refuted findings must support the overall applicability outcome.
 * - Every operative scope needs an explicit ESTABLISHED finding for APPLICABLE; an unknown actor,
 *   activity or inherited scope cannot be omitted because the duty has no separate condition list.
 * - Under disjunctive ("ANY") condition logic, establishing one condition branch supports APPLICABLE even
 *   if another condition branch is REFUTED, and NOT_APPLICABLE requires all alternative branches to be REFUTED.
 * - Under conjunctive ("ALL") condition logic, every required/material condition must be ESTABLISHED, and any
 *   REFUTED condition contradicts APPLICABLE while establishing NOT_APPLICABLE.
 * - NOT_ESTABLISHED alone never establishes NOT_APPLICABLE or COMPLIANT.
 * Execution flow:
 * 1. Validate source addresses, bounds, and referenced findings for each applicability basis entry.
 * 2. Validate operative scopes: require all declared operative scopes to be ESTABLISHED for APPLICABLE, and refute applicability if any scope is REFUTED.
 * 3. Validate exceptions: refute applicability and contradict APPLICABLE if any declared exception is ESTABLISHED.
 * 4. Validate conditions according to the requirement's condition logic ("ALL" vs "ANY") and material indices:
 *    verify required findings match the submitted APPLICABLE or NOT_APPLICABLE conclusion.
 * Failure cases:
 * - Unknown elements emit UNKNOWN_APPLICABILITY_ELEMENT.
 * - Missing references on ESTABLISHED/REFUTED findings emit APPLICABILITY_BASIS_UNREFERENCED.
 * - Contradictory findings or verdicts emit APPLICABILITY_BASIS_CONTRADICTION.
 * - Missing required scope, unresolved material conditions, or missing refuting basis emit APPLICABILITY_BASIS_REQUIRED.
 * Side effects:
 * - Pure diagnostic function; only the provided failure collector receives entries.
 */
function validateApplicabilityBasis(
  decision: RuleDecision,
  declared: DeclaredElements,
  fail: (code: DecisionValidationFailureCode, ref: string) => void,
): void {
  const basis = decision.applicabilityBasis ?? [];
  let refutingScope = false;
  let establishedException = false;

  for (const entry of basis) {
    const ref = `${entry.legalRequirementId}:${entry.kind}:${entry.index}`;
    const counts = declared.get(entry.legalRequirementId);
    if (
      !counts ||
      entry.index >= (counts[ELEMENT_COUNT_KEY[entry.kind]] ?? 0)
    ) {
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
  }

  let totalConditionCount = 0;
  let totalElementCount = 0;
  let missingScope = false;
  let hasValidConditionRefutation = false;
  let hasValidConditionEstablishment = false;
  let hasConditionContradiction = false;
  let hasUnresolvedRequiredCondition = false;

  for (const [requirementId, counts] of declared) {
    const conditionCount = counts.applicabilityConditions;
    const operativeScopeCount = counts.operativeScopes ?? 0;
    const exceptionCount = counts.exceptions;
    totalConditionCount += conditionCount;
    totalElementCount +=
      conditionCount + exceptionCount + operativeScopeCount;

    // Check operative scopes
    for (let index = 0; index < operativeScopeCount; index++) {
      const scope = basis.find(
        (entry) =>
          entry.legalRequirementId === requirementId &&
          entry.kind === RULE_DECISION_BASIS_KINDS.OPERATIVE_SCOPE &&
          entry.index === index,
      );
      if (scope?.finding === RULE_DECISION_BASIS_FINDINGS.REFUTED) {
        refutingScope = true;
      }
      if (scope?.finding !== RULE_DECISION_BASIS_FINDINGS.ESTABLISHED) {
        missingScope = true;
      }
    }

    // Check exceptions
    for (let index = 0; index < exceptionCount; index++) {
      const ex = basis.find(
        (entry) =>
          entry.legalRequirementId === requirementId &&
          entry.kind === RULE_DECISION_BASIS_KINDS.EXCEPTION &&
          entry.index === index,
      );
      if (ex?.finding === RULE_DECISION_BASIS_FINDINGS.ESTABLISHED) {
        establishedException = true;
      }
    }

    // Check conditions for this requirement
    if (conditionCount > 0) {
      const conditionEntries = basis.filter(
        (entry) =>
          entry.legalRequirementId === requirementId &&
          entry.kind === RULE_DECISION_BASIS_KINDS.APPLICABILITY_CONDITION,
      );
      const establishedIndices = new Set(
        conditionEntries
          .filter(
            (entry) =>
              entry.finding === RULE_DECISION_BASIS_FINDINGS.ESTABLISHED,
          )
          .map((entry) => entry.index),
      );
      const refutedIndices = new Set(
        conditionEntries
          .filter(
            (entry) => entry.finding === RULE_DECISION_BASIS_FINDINGS.REFUTED,
          )
          .map((entry) => entry.index),
      );

      const isDisjunctive =
        counts.conditionLogic === APPLICABILITY_CONDITION_LOGIC.ANY;
      const isConjunctive =
        counts.conditionLogic === APPLICABILITY_CONDITION_LOGIC.ALL;

      if (isDisjunctive) {
        // ANY (disjunctive / OR) logic:
        // - At least one condition established suffices for APPLICABLE
        // - Refuting an alternative branch does not contradict APPLICABLE if another is ESTABLISHED
        // - APPLICABLE contradicts only if ALL conditions are REFUTED
        // - NOT_APPLICABLE requires ALL conditions to be REFUTED
        if (establishedIndices.size > 0) {
          hasValidConditionEstablishment = true;
        }
        if (refutedIndices.size === conditionCount) {
          hasValidConditionRefutation = true;
          if (
            decision.applicability ===
            RULE_DECISION_APPLICABILITIES.APPLICABLE
          ) {
            hasConditionContradiction = true;
          }
        }
        if (establishedIndices.size === 0) {
          hasUnresolvedRequiredCondition = true;
        }
      } else if (isConjunctive) {
        // Explicit ALL (conjunctive / AND) logic:
        // - All conditions must be ESTABLISHED for APPLICABLE
        // - Any REFUTED condition refutes the requirement and contradicts APPLICABLE
        if (refutedIndices.size > 0) {
          hasValidConditionRefutation = true;
          if (
            decision.applicability ===
            RULE_DECISION_APPLICABILITIES.APPLICABLE
          ) {
            hasConditionContradiction = true;
          }
        }
        if (establishedIndices.size === conditionCount) {
          hasValidConditionEstablishment = true;
        } else {
          hasUnresolvedRequiredCondition = true;
        }
      } else {
        // Unspecified / legacy default:
        // - Material condition indices if specified, else at least one established
        // - Any refuted condition refutes and contradicts APPLICABLE
        if (refutedIndices.size > 0) {
          hasValidConditionRefutation = true;
          if (
            decision.applicability ===
            RULE_DECISION_APPLICABILITIES.APPLICABLE
          ) {
            hasConditionContradiction = true;
          }
        }
        if (
          counts.materialConditionIndices &&
          counts.materialConditionIndices.length > 0
        ) {
          const allMaterialEstablished =
            counts.materialConditionIndices.every((idx) =>
              establishedIndices.has(idx),
            );
          if (allMaterialEstablished) {
            hasValidConditionEstablishment = true;
          } else {
            hasUnresolvedRequiredCondition = true;
          }
        } else {
          if (establishedIndices.size > 0) {
            hasValidConditionEstablishment = true;
          }
          if (establishedIndices.size === 0) {
            hasUnresolvedRequiredCondition = true;
          }
        }
      }
    }
  }

  // Final evaluation for NOT_APPLICABLE
  if (decision.applicability === RULE_DECISION_APPLICABILITIES.NOT_APPLICABLE) {
    const hasRefutingBasis =
      refutingScope || establishedException || hasValidConditionRefutation;
    if (totalElementCount > 0 && !hasRefutingBasis) {
      fail(
        DECISION_VALIDATION_FAILURE_CODES.APPLICABILITY_BASIS_REQUIRED,
        decision.assessmentRuleId,
      );
    }
    return;
  }

  // Final evaluation for APPLICABLE
  if (refutingScope || establishedException || hasConditionContradiction) {
    fail(
      DECISION_VALIDATION_FAILURE_CODES.APPLICABILITY_BASIS_CONTRADICTION,
      decision.assessmentRuleId,
    );
    return;
  }

  if (
    missingScope ||
    (totalConditionCount > 0 &&
      (!hasValidConditionEstablishment || hasUnresolvedRequiredCondition))
  ) {
    fail(
      DECISION_VALIDATION_FAILURE_CODES.APPLICABILITY_BASIS_REQUIRED,
      decision.assessmentRuleId,
    );
  }
}
