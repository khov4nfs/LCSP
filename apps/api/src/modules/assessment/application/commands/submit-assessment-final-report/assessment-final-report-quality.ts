import {
  RULE_DECISION_APPLICABILITIES,
  RULE_DECISION_COMPLIANCE_OUTCOMES,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_FINAL_REPORT_QUALITY_FAILURE_REASONS,
  type AssessmentFinalReportArtifact,
} from "@lcsp/contracts/assessment-domain";

export const FINAL_REPORT_TOTALS_PATTERN =
  /^Decision totals: NOT_APPLICABLE=(\d+); APPLICABLE_COMPLIANT=(\d+); APPLICABLE_NON_COMPLIANT=(\d+)\.(?:\s|$)/u;

type Finding = AssessmentFinalReportArtifact["findings"][number];

export interface FinalReportQualityFailure {
  ruleId: string;
  reason: (typeof ASSESSMENT_FINAL_REPORT_QUALITY_FAILURE_REASONS)[keyof typeof ASSESSMENT_FINAL_REPORT_QUALITY_FAILURE_REASONS];
}

/**
 * Business purpose: Keep agent-authored prose aligned with frozen accepted decisions
 * without rewriting either the immutable decision or the Root's original report.
 *
 * Business rules:
 * - Every finding has an explicit machine-checkable verdict prefix; a narrative
 *   cannot claim NOT_APPLICABLE when its structured verdict is APPLICABLE.
 * - NON_COMPLIANT findings require at least one nonempty remediation recommendation.
 * - The overall summary begins with complete derived decision totals.
 * - Validation is deterministic: legal correctness still requires independent QA.
 *
 * Execution flow:
 * 1. Count the accepted outcomes and require a matching report totals header.
 * 2. Validate each finding's verdict prefix against its frozen decision.
 * 3. Reject an explicit global "all/not any rules applicable" contradiction.
 *
 * Failure cases:
 * - Return typed failures to the caller; never silently patch report text or
 *   invent compliance claims. Historical reports remain immutable.
 *
 * Side effects:
 * - No mutations; returns a new array of validation failures.
 */
export function inspectFinalReportQuality(
  report: Pick<AssessmentFinalReportArtifact, "summary" | "findings">,
): FinalReportQualityFailure[] {
  const failures: FinalReportQualityFailure[] = [];
  const totals = { na: 0, compliant: 0, noncompliant: 0 };
  for (const finding of report.findings) {
    if (
      finding.decision.applicability ===
      RULE_DECISION_APPLICABILITIES.NOT_APPLICABLE
    ) {
      totals.na++;
    } else if (
      finding.decision.compliance ===
      RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT
    ) {
      totals.noncompliant++;
    } else {
      totals.compliant++;
    }
  }
  const expected = `Decision totals: NOT_APPLICABLE=${totals.na}; APPLICABLE_COMPLIANT=${totals.compliant}; APPLICABLE_NON_COMPLIANT=${totals.noncompliant}.`;
  if (
    !report.summary.startsWith(expected) ||
    !FINAL_REPORT_TOTALS_PATTERN.test(report.summary)
  ) {
    failures.push({
      ruleId: "REPORT",
      reason:
        ASSESSMENT_FINAL_REPORT_QUALITY_FAILURE_REASONS.DECISION_TOTALS_MISSING_OR_INCORRECT,
    });
  }
  if (
    totals.na !== report.findings.length &&
    /\b(?:all|every)\s+(?:\d+\s+)?(?:rules?|findings?)\s+(?:are|were|is)\s+(?:not\s+applicable|outside\s+scope)\b|\b(?:no|zero)\s+(?:applicable|in-scope)\s+(?:rules?|findings?)\b/iu.test(
      report.summary,
    )
  ) {
    failures.push({
      ruleId: "REPORT",
      reason:
        ASSESSMENT_FINAL_REPORT_QUALITY_FAILURE_REASONS.OVERALL_SUMMARY_CONTRADICTS_DECISIONS,
    });
  }
  for (const finding of report.findings) {
    const prefix = expectedPrefix(finding);
    if (
      !finding.summary.trimStart().startsWith(prefix) ||
      !finding.summary.trimStart().slice(prefix.length).trim()
    ) {
      failures.push({
        ruleId: finding.assessmentRuleId,
        reason:
          ASSESSMENT_FINAL_REPORT_QUALITY_FAILURE_REASONS.SUMMARY_PREFIX_MISSING_OR_INCORRECT,
      });
    }
    if (
      finding.decision.applicability ===
        RULE_DECISION_APPLICABILITIES.APPLICABLE &&
      finding.decision.compliance ===
        RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT &&
      !finding.recommendations.some((rec) => rec.trim().length >= 12)
    ) {
      failures.push({
        ruleId: finding.assessmentRuleId,
        reason:
          ASSESSMENT_FINAL_REPORT_QUALITY_FAILURE_REASONS.NON_COMPLIANT_RECOMMENDATION_MISSING,
      });
    }
  }
  return failures;
}

/**
 * Business purpose: Render the canonical verdict marker expected from one frozen decision.
 * Business rules:
 * - Applicability takes precedence; only applicable rules have compliance outcomes.
 * Execution flow:
 * 1. Map the structured applicability and compliance values to one exact prefix.
 * Failure cases:
 * - Invalid decision values are caught by the upstream decision schema.
 * Side effects:
 * - None: returns a formatted string.
 */
function expectedPrefix(finding: Finding): string {
  if (
    finding.decision.applicability ===
    RULE_DECISION_APPLICABILITIES.NOT_APPLICABLE
  ) {
    return "[NOT_APPLICABLE] ";
  }
  return finding.decision.compliance ===
    RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT
    ? "[APPLICABLE / NON_COMPLIANT] "
    : "[APPLICABLE / COMPLIANT] ";
}
