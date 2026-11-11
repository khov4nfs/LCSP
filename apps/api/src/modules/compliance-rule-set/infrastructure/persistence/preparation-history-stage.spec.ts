import { describe, expect, it } from "@jest/globals";
import { AGENT_EXECUTION_STATES } from "@lcsp/contracts/assessment";
import {
  COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES,
  RULE_SET_PREPARATION_STAGES,
} from "@lcsp/contracts/compliance-rule-set";
import { preparationHistoryStage } from "./preparation-history-stage.js";

describe("preparationHistoryStage", () => {
  it("does not call a successful run without an artifact Rule Set ready", () => {
    expect(
      preparationHistoryStage({
        executionState: AGENT_EXECUTION_STATES.SUCCEEDED,
        active: false,
        hasRuleSetVersion: false,
        hasValidatedDraft: false,
        validationOutcome: COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES.PASSED,
        coverageComplete: false,
      }),
    ).toBe(RULE_SET_PREPARATION_STAGES.SUCCEEDED_WITHOUT_ARTIFACT);
  });

  it("distinguishes a validated draft from a persisted Rule Set Version", () => {
    expect(
      preparationHistoryStage({
        executionState: AGENT_EXECUTION_STATES.SUCCEEDED,
        active: false,
        hasRuleSetVersion: false,
        hasValidatedDraft: true,
        validationOutcome: COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES.PASSED,
        coverageComplete: true,
      }),
    ).toBe(RULE_SET_PREPARATION_STAGES.DRAFT_VALIDATED);
    expect(
      preparationHistoryStage({
        executionState: AGENT_EXECUTION_STATES.SUCCEEDED,
        active: false,
        hasRuleSetVersion: true,
        hasValidatedDraft: false,
        validationOutcome: COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES.PASSED,
        coverageComplete: true,
      }),
    ).toBe(RULE_SET_PREPARATION_STAGES.RULE_SET_READY);
  });
});
