import type { TrackingFreshnessStatus } from "@lcsp/contracts/assessment-domain";

export type FilteredTrackingReportPagePayload = {
  total: number;
  items: Array<{
    assessmentId: string;
    artifactId: string;
    createdAt: string;
    freshnessStatus: TrackingFreshnessStatus;
    observedAt: string | null;
  }>;
};

export type TrackingObligationAggregatePayload = {
  total: number;
  evaluationSummary: {
    evaluatedAssessmentCount: number;
    notEvaluatedAssessmentCount: number;
  };
  items: Array<{
    ruleSetVersionId: string;
    ruleSetVersion: string | null;
    assessmentRuleId: string;
    concept: string;
    compliantCount: number;
    nonCompliantCount: number;
    notApplicableCount: number;
    unresolvedCount: number;
    affectedAssessmentCount: number;
    previewAssessmentIds: string[];
  }>;
};
