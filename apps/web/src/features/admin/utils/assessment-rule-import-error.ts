import {
  LEGAL_RULE_CATALOG_ERRORS as E,
  LEGAL_RULE_VALIDATION_ISSUES as ISSUE,
} from "@lcsp/contracts/legal-rule-catalog";
import { ApiRequestError } from "@/lib/api/api-request";
import { catalogMessage as t } from "./legal-rule-catalog-message";

/**
 * Business purpose: Explain in the Admin's language why one import document was refused, so they know whether to retry, re-export or fix the file.
 * Business rules:
 * - Only typed problem and issue codes are shown; schema paths, authored values and source text are never echoed.
 * - Stale and conflict outcomes name the corrective action because they are the two normal reasons a correct document is refused.
 * Execution flow:
 * 1. Read the problem code from the API error.
 * 2. Pick the matching localized message, using an allowlisted issue category for invalid documents.
 * Failure cases:
 * - Errors that are not API problems, and unrecognized problem codes, fall back to the generic import failure message.
 * Side effects:
 * - Pure message selection; nothing is sent or stored.
 */
export function assessmentRuleImportErrorMessage(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return t("importErrorGeneric");
  // Why: The API no longer exposes nested output paths in validation problems.
  // How: Match only canonical issue codes and ignore any unexpected metadata.
  // Invariant: User-facing copy is localized and cannot reflect private schema details.
  const issueCode = error.problem?.meta?.issueCode;
  const issue =
    issueCode === ISSUE.SOURCE_REFERENCE_INVALID
      ? t("importIssueSourceReferenceInvalid")
      : issueCode === ISSUE.REQUIREMENT_LINK_INVALID
        ? t("importIssueRequirementLinkInvalid")
        : issueCode === ISSUE.IDENTITY_INVALID
          ? t("importIssueIdentityInvalid")
          : issueCode === ISSUE.APPLICABILITY_INVALID
            ? t("importIssueApplicabilityInvalid")
            : issueCode === ISSUE.OUTPUT_INVALID
              ? t("importIssueOutputInvalid")
              : "";
  switch (error.problemCode) {
    case E.STALE:
      return t("importErrorStale");
    case E.CONFLICT:
      return t("importErrorConflict");
    case E.RESULT_INVALID:
    case E.INVALID:
      return issue
        ? `${t("importErrorInvalid")} ${issue}`
        : t("importErrorInvalid");
    case E.INELIGIBLE:
      return t("importErrorIneligible");
    case E.NOT_FOUND:
      return t("importErrorNotFound");
    default:
      return t("importErrorGeneric");
  }
}
