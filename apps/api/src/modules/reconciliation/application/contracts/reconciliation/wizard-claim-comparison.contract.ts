import type { CompareWizardClaimResponse } from "@lcsp/contracts/evidence";
import {
  WIZARD_CLAIM_COMPARISON_SCOPES,
  WIZARD_CLAIM_EXPECTED_VALUES,
  WIZARD_CLAIM_FIELDS,
  WIZARD_CLAIM_VERDICTS,
  type WizardClaimComparisonScope,
  type WizardClaimExpectedValue,
  type WizardClaimField,
} from "@lcsp/contracts/evidence";

export {
  WIZARD_CLAIM_COMPARISON_SCOPES,
  WIZARD_CLAIM_EXPECTED_VALUES,
  WIZARD_CLAIM_FIELDS,
  WIZARD_CLAIM_VERDICTS,
  type WizardClaimComparisonScope,
  type WizardClaimExpectedValue,
  type WizardClaimField,
  type CompareWizardClaimResponse,
};

export const WIZARD_CLAIM_LIMITATION_CODES = {
  profileNotSubmitted: "PROFILE_NOT_SUBMITTED",
  coverageLimited: "COVERAGE_LIMITED",
  unsupportedClaimField: "UNSUPPORTED_CLAIM_FIELD",
  ambiguousEvidence: "AMBIGUOUS_EVIDENCE",
} as const;
