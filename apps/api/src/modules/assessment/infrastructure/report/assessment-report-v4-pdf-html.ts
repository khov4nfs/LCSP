import type { AssessmentReportV4Presentation } from "@lcsp/contracts/assessment-report";

import { assessmentReportV3Html } from "./assessment-report-v3-pdf-html.js";
import type { ReportTranslationCatalog } from "./assessment-report-v2-pdf-presentation.js";

/**
 * Business purpose: Render the printable multi-repository report: the V3 layout with a table of the pinned
 * repositories, repository labels on every evidence entry, and per-repository scope and commit in the traceability appendix.
 *
 * Business rules:
 * - All persisted text is escaped and the document keeps the strict no-script, no-remote-resource policy of the V3 report.
 * - A limited source scope of any one repository raises the report-wide scope warning.
 * Execution flow:
 * 1. Delegate to the shared report layout, which detects the pinned set in the presentation model.
 * Failure cases:
 * - Non-serializable models fail while rendering, exactly as for V3.
 * Side effects:
 * - Pure function: creates an in-memory HTML document string.
 */
export function assessmentReportV4Html(
  model: AssessmentReportV4Presentation,
  options: { preview?: boolean; translations?: ReportTranslationCatalog } = {},
): string {
  return assessmentReportV3Html(model, options);
}
