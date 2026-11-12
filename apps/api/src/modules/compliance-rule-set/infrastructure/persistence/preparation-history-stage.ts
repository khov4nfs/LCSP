import {
  AGENT_EXECUTION_STATES,
  type AgentExecutionState,
} from "@lcsp/contracts/assessment";
import {
  COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES,
  RULE_SET_PREPARATION_STAGES as STAGE,
  type ComplianceRuleSetValidationOutcome,
} from "@lcsp/contracts/compliance-rule-set";

type RuleSetPreparationStage = (typeof STAGE)[keyof typeof STAGE];

/**
 * Business purpose: Report the furthest persisted Preparation artifact without conflating execution success and customer readiness.
 * Business rules:
 * - ACTIVE requires an active Rule Set; a persisted Rule Set Version and a validated authoring draft are distinct states.
 * - A SUCCEEDED execution without either persisted artifact is explicitly reported as an incomplete historical outcome.
 * Execution flow:
 * 1. Evaluate authoritative activation, Rule Set, draft validation, execution, and coverage evidence in descending authority.
 * Failure cases:
 * - Missing artifact evidence never becomes RULE_SET_READY or ACTIVE.
 * Side effects:
 * - None; this is a pure read-model projection.
 */
export function preparationHistoryStage(input: {
  executionState: AgentExecutionState;
  active: boolean;
  hasRuleSetVersion: boolean;
  hasValidatedDraft: boolean;
  validationOutcome: ComplianceRuleSetValidationOutcome | null;
  coverageComplete: boolean;
}): RuleSetPreparationStage {
  if (input.active) return STAGE.ACTIVE;
  if (
    input.validationOutcome === COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES.FAILED
  )
    return STAGE.VALIDATION_FAILED;
  if (input.hasRuleSetVersion) return STAGE.RULE_SET_READY;
  if (input.hasValidatedDraft) return STAGE.DRAFT_VALIDATED;
  if (input.executionState === AGENT_EXECUTION_STATES.SUCCEEDED)
    return STAGE.SUCCEEDED_WITHOUT_ARTIFACT;
  if (
    input.coverageComplete ||
    input.validationOutcome === COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES.PASSED
  )
    return STAGE.VALIDATION_REQUIRED;
  if (input.executionState === AGENT_EXECUTION_STATES.QUEUED)
    return STAGE.CORPUS_READY;
  return STAGE.PREPARING_RULE_SET;
}
