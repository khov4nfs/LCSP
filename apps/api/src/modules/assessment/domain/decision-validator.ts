import {
  RULE_DECISION_APPLICABILITIES,
  RULE_DECISION_REFERENCE_TYPES,
  type RuleDecision,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_DECISION_SCOPE,
  ASSESSMENT_RECORD_STATES,
  DECISION_VALIDATION_FAILURE_CODES,
  type DecisionValidationFailureCode,
} from "@lcsp/contracts/assessment-domain";

export interface DecisionValidationFailure {
  code: DecisionValidationFailureCode;
  ref: string;
}

export interface DecisionValidationContext {
  caseRevision: number;
  pins: {
    legalPortfolioVersionId: string;
    repositorySnapshotId: string;
    repositoryCommit: string;
  };
  /** The pinned portfolio's EngineeringRule, or null when the ID is not in it. */
  rule: {
    engineeringRuleId: string;
    engineeringRuleVersion: string;
    criterionIds: ReadonlySet<string>;
    /** LegalRule IDs linked to the rule (and their directly related context rules). */
    legalContextIds: ReadonlySet<string>;
  } | null;
  evidence: ReadonlyMap<string, { state: string; repositoryCommit: string }>;
  facts: ReadonlyMap<string, { state: string; caseRevision: number }>;
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
      DECISION_VALIDATION_FAILURE_CODES.UNKNOWN_ENGINEERING_RULE,
      decision.engineeringRuleId,
    );
  } else {
    if (
      context.rule.engineeringRuleVersion !== decision.engineeringRuleVersion
    ) {
      fail(
        DECISION_VALIDATION_FAILURE_CODES.ENGINEERING_RULE_VERSION_MISMATCH,
        decision.engineeringRuleId,
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

  if (
    decision.legalPortfolioVersionId !== context.pins.legalPortfolioVersionId
  ) {
    fail(
      DECISION_VALIDATION_FAILURE_CODES.PORTFOLIO_PIN_MISMATCH,
      decision.legalPortfolioVersionId,
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

  const references = [
    ...decision.references,
    ...decision.criteria.flatMap((criterion) => criterion.references),
  ];
  const seen = new Set<string>();
  for (const reference of references) {
    const key =
      reference.type === RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE
        ? `E:${reference.evidenceId}`
        : `F:${reference.factId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (reference.type === RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE) {
      const evidence = context.evidence.get(reference.evidenceId);
      if (!evidence) {
        fail(
          DECISION_VALIDATION_FAILURE_CODES.UNKNOWN_EVIDENCE_REFERENCE,
          reference.evidenceId,
        );
      } else if (evidence.state !== ASSESSMENT_RECORD_STATES.ACCEPTED) {
        fail(
          DECISION_VALIDATION_FAILURE_CODES.EVIDENCE_NOT_ACCEPTED,
          reference.evidenceId,
        );
      } else if (evidence.repositoryCommit !== context.pins.repositoryCommit) {
        fail(
          DECISION_VALIDATION_FAILURE_CODES.EVIDENCE_PIN_MISMATCH,
          reference.evidenceId,
        );
      }
    } else {
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
      }
    }
  }
  return failures;
}
