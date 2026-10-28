import type { CustomerTrackingAssessmentItem } from "@lcsp/contracts/assessment-domain";

/**
 * Business purpose:
 * - Choose the customer-facing summary for one assessment's rule evaluation.
 * Business rules:
 * - Missing pinned rule-set identity takes precedence; non-compliant results take precedence over unresolved results; all-zero evaluated counts remain unresolved.
 * Execution flow:
 * 1. Check for a pinned rule-set version.
 * 2. Check non-compliant and unresolved counts.
 * 3. Distinguish not-applicable-only from compliant results.
 * Failure cases:
 * - Incomplete or absent evaluation data is described as not evaluated or unresolved, never as compliant.
 * Side effects:
 * - Pure mapping from the canonical tracking item to a localized message suffix.
 */
export function assessmentSummaryKey(item: CustomerTrackingAssessmentItem) {
  if (!item.ruleSet.ruleSetVersionId) return "summary.notEvaluated";
  if (item.compliance.nonCompliantCount > 0) return "summary.nonCompliant";
  if (
    item.compliance.unresolvedCount > 0 ||
    Object.values(item.compliance).every((value) => value === 0)
  ) {
    return "summary.unresolved";
  }
  if (item.compliance.compliantCount === 0) return "summary.notApplicable";
  return "summary.compliant";
}
