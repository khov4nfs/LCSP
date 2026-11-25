import { LEGAL_RULE_CATALOG_ERRORS as E } from "@lcsp/contracts/legal-rule-catalog";
import { ApiRequestError } from "@/lib/api/api-request";
import { catalogMessage as t } from "./legal-rule-catalog-message";

/**
 * Business purpose: Explain in the Admin's language why one import document was refused, so they know whether to retry, re-export or fix the file.
 * Business rules:
 * - Only the typed problem code and the API's safe field path are shown; authored values and source text are never echoed.
 * - Stale and conflict outcomes name the corrective action because they are the two normal reasons a correct document is refused.
 * Execution flow:
 * 1. Read the problem code from the API error.
 * 2. Pick the matching message, appending the structural field path for an invalid document.
 * Failure cases:
 * - Errors that are not API problems, and unrecognized problem codes, fall back to the generic import failure message.
 * Side effects:
 * - Pure message selection; nothing is sent or stored.
 */
export function assessmentRuleImportErrorMessage(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return t("importErrorGeneric");
  const issues = error.problem?.meta?.issues;
  const path =
    typeof issues === "string" ? ` ${t("importAtPath")}: ${issues}` : "";
  switch (error.problemCode) {
    case E.STALE:
      return t("importErrorStale");
    case E.CONFLICT:
      return t("importErrorConflict");
    case E.RESULT_INVALID:
    case E.INVALID:
      return `${t("importErrorInvalid")}${path}`;
    case E.INELIGIBLE:
      return t("importErrorIneligible");
    case E.NOT_FOUND:
      return t("importErrorNotFound");
    default:
      return t("importErrorGeneric");
  }
}
