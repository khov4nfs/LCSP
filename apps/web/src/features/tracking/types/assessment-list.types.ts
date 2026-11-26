import type { CustomerTrackingAssessmentItem } from "@lcsp/contracts/assessment-domain";

export const ASSESSMENT_LIST_STATUS_FILTERS = {
  all: "all",
  completed: "completed",
  running: "running",
  needsInfo: "needs_info",
  draft: "draft",
  failed: "failed",
} as const;

export type AssessmentListStatusFilter =
  (typeof ASSESSMENT_LIST_STATUS_FILTERS)[keyof typeof ASSESSMENT_LIST_STATUS_FILTERS];

export const ASSESSMENT_LIST_DATE_FILTERS = {
  all: "ALL",
  last7Days: "LAST_7_DAYS",
  last30Days: "LAST_30_DAYS",
} as const;

export type AssessmentListDateFilter =
  (typeof ASSESSMENT_LIST_DATE_FILTERS)[keyof typeof ASSESSMENT_LIST_DATE_FILTERS];

export const ASSESSMENT_LIST_SORT_OPTIONS = {
  recentlyUpdated: "RECENTLY_UPDATED",
  nameAsc: "NAME_ASC",
  highestCoverage: "HIGHEST_COVERAGE",
} as const;

export type AssessmentListSortOption =
  (typeof ASSESSMENT_LIST_SORT_OPTIONS)[keyof typeof ASSESSMENT_LIST_SORT_OPTIONS];

export type AssessmentLifecycleCounts = {
  all: number;
  completed: number;
  running: number;
  needsInfo: number;
  draft: number;
  failed: number;
};

export type AssessmentRowPresentation = {
  statusFilter: AssessmentListStatusFilter;
  statusLabel: string;
  badgeClassName: string;
  progressColor: string;
  nextActionLabel: string;
  href: string;
};

export type AssessmentRowProps = {
  item: CustomerTrackingAssessmentItem;
};
