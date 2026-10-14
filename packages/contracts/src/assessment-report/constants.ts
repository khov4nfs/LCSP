export { ASSESSMENT_FINAL_REPORT_V2_SCHEMA_VERSION } from "../assessment-domain/constants.ts";

export const ASSESSMENT_REPORT_OUTCOME_BUCKETS = {
  applicableCompliant: "APPLICABLE_COMPLIANT",
  applicableNonCompliant: "APPLICABLE_NON_COMPLIANT",
  notApplicable: "NOT_APPLICABLE",
} as const;

export type AssessmentReportOutcomeBucket =
  (typeof ASSESSMENT_REPORT_OUTCOME_BUCKETS)[keyof typeof ASSESSMENT_REPORT_OUTCOME_BUCKETS];

export const ASSESSMENT_REPORT_REFERENCE_ORIGINS = {
  decision: "DECISION",
  criterion: "CRITERION",
  factEvidence: "FACT_EVIDENCE",
} as const;

export type AssessmentReportReferenceOrigin =
  (typeof ASSESSMENT_REPORT_REFERENCE_ORIGINS)[keyof typeof ASSESSMENT_REPORT_REFERENCE_ORIGINS];
