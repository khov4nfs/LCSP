import {
  LEGAL_RULE_PREPARATION_STATES,
  type LegalRuleFilter,
} from "@lcsp/contracts/legal-rule-catalog";
import {
  LEGAL_RULE_FILTER_ALL,
  LEGAL_RULE_FILTER_PREPARED_WITH_ASSESSMENT_RULES,
} from "../config/legal-rule-catalog.config";

/**
 * Business purpose: Convert the Admin Preparation state dropdown choice into the server-side LegalRule filter.
 *
 * Business rules:
 * - The prepared-with-rules choice sets `withAssessmentRules` and clears the lifecycle state so the backend applies its current PREPARED and freshness checks.
 * - A lifecycle state choice clears the prepared-with-rules flag.
 * - The all-states choice clears both lifecycle and generated-rule filters.
 *
 * Execution flow:
 * 1. Map the prepared-with-rules option to the dedicated generated-rule filter.
 * 2. Map the all-states option to an unfiltered lifecycle state.
 * 3. Accept a declared Preparation state and clear any prior generated-rule filter.
 *
 * Failure cases:
 * - An unknown dropdown value leaves the current filters unchanged so an invalid UI value cannot broaden the query.
 *
 * Side effects:
 * - Returns a filter object without fetching data or mutating the supplied filters.
 */
export function selectLegalRulePreparationFilter(
  current: LegalRuleFilter,
  value: string,
): LegalRuleFilter {
  if (value === LEGAL_RULE_FILTER_PREPARED_WITH_ASSESSMENT_RULES) {
    return { ...current, state: undefined, withAssessmentRules: true };
  }

  if (value === LEGAL_RULE_FILTER_ALL) {
    return { ...current, state: undefined, withAssessmentRules: undefined };
  }

  const state = LEGAL_RULE_PREPARATION_STATES.find(
    (candidate) => candidate === value,
  );
  return state
    ? { ...current, state, withAssessmentRules: undefined }
    : current;
}
