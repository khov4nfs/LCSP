import type {
  CustomerTrackingAssessmentItem,
  CustomerTrackingObligationAssessment,
  TrackingFreshnessStatus,
  TrackingRuleOutcome,
  TrackingTrustStatus,
} from "@lcsp/contracts/assessment-domain";
import type { ReactNode } from "react";

export type TrackingSectionProps = {
  title: string;
  description?: string;
  children: ReactNode;
  action?: ReactNode;
  compact?: boolean;
};

export type TrackingEmptyStateProps = {
  children: ReactNode;
  className?: string;
};

export type TrackingOutcomeBadgeProps = {
  outcome: TrackingRuleOutcome;
};

export type TrackingFreshnessBadgeProps = {
  status: TrackingFreshnessStatus;
};

export type TrackingTrustBadgeProps = {
  status: TrackingTrustStatus;
};

export type TrackingObligationAssessmentsProps = {
  ruleSetVersionId: string;
  assessmentRuleId: string;
  assessments: CustomerTrackingObligationAssessment[];
  affectedAssessmentCount: number;
  outcome?: CustomerTrackingObligationAssessment["outcome"];
  freshness?: CustomerTrackingObligationAssessment["freshnessStatus"];
};

export type AssessmentTrackingCardProps = {
  item: CustomerTrackingAssessmentItem;
};

export type TrackingErrorProps = {
  onRetry: () => void;
};

export type TrackingFactProps = {
  label: string;
  value: string | null;
  fallbackWhenEmpty?: boolean;
};

export type TrackingMetricProps = {
  label: string;
  value: number;
};

export type TrackingFilterOption = {
  value: string;
  label: string;
};

export type TrackingFilterSelectProps = {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  options: TrackingFilterOption[];
  onValueChange: (value: string) => void;
  className?: string;
};

export type TrackingPaginationProps = {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  onOffsetChange: (offset: number) => void;
  showTotal?: boolean;
};
