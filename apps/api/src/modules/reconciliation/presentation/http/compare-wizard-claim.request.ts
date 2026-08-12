import type {
  WizardClaimComparisonScope,
  WizardClaimExpectedValue,
  WizardClaimField,
} from "@lcsp/contracts/evidence";
import {
  WIZARD_CLAIM_COMPARISON_SCOPES,
  WIZARD_CLAIM_EXPECTED_VALUES,
  WIZARD_CLAIM_FIELDS,
} from "@lcsp/contracts/evidence";
import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import { HttpStatus } from "@nestjs/common";

import { problemException } from "../../../../platform/problems/problem-factory.js";

export function parseWizardClaimField(
  value: string | undefined,
  correlationId: string,
): WizardClaimField {
  if (
    value &&
    Object.values(WIZARD_CLAIM_FIELDS).includes(value as WizardClaimField)
  ) {
    return value as WizardClaimField;
  }
  throwInvalidRequest(correlationId);
}

export function parseWizardClaimExpectedValue(
  value: string | undefined,
  claimField: WizardClaimField,
  correlationId: string,
): WizardClaimExpectedValue {
  const allowed = allowedExpectedValuesForClaimField(claimField);
  if (value && allowed.includes(value as WizardClaimExpectedValue)) {
    return value as WizardClaimExpectedValue;
  }
  throwInvalidRequest(correlationId);
}

export function parseWizardClaimComparisonScope(
  value: string | undefined,
  correlationId: string,
): WizardClaimComparisonScope {
  if (
    value &&
    Object.values(WIZARD_CLAIM_COMPARISON_SCOPES).includes(
      value as WizardClaimComparisonScope,
    )
  ) {
    return value as WizardClaimComparisonScope;
  }
  throwInvalidRequest(correlationId);
}

export function parseWizardClaimMaxEvidenceRefs(
  value: string | undefined,
  correlationId: string,
): number {
  if (!value) return 10;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) {
    throwInvalidRequest(correlationId);
  }
  return parsed;
}

export function parseSingleTargetId(
  value: string,
  correlationId: string,
): string {
  if (/^target:[A-Za-z0-9_-]{1,120}$/.test(value)) {
    return value;
  }
  throwInvalidRequest(correlationId);
}

function allowedExpectedValuesForClaimField(
  claimField: WizardClaimField,
): WizardClaimExpectedValue[] {
  switch (claimField) {
    case WIZARD_CLAIM_FIELDS.provider:
      return [
        WIZARD_CLAIM_EXPECTED_VALUES.openai,
        WIZARD_CLAIM_EXPECTED_VALUES.google,
        WIZARD_CLAIM_EXPECTED_VALUES.anthropic,
      ];
    case WIZARD_CLAIM_FIELDS.aiUsageType:
      return [WIZARD_CLAIM_EXPECTED_VALUES.providerApi];
    case WIZARD_CLAIM_FIELDS.humanReview:
      return [WIZARD_CLAIM_EXPECTED_VALUES.humanReviewPresent];
    case WIZARD_CLAIM_FIELDS.deploymentContext:
      return [WIZARD_CLAIM_EXPECTED_VALUES.production];
    case WIZARD_CLAIM_FIELDS.decisionPath:
      return [WIZARD_CLAIM_EXPECTED_VALUES.present];
    default:
      return [];
  }
}

function throwInvalidRequest(correlationId: string): never {
  throw problemException(ASSESSMENT_ERROR_CODES.invalidRequest, correlationId, {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
  });
}
