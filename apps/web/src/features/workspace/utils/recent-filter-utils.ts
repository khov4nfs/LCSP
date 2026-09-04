import {
  RECENT_FILTER_SORTS,
  RECENT_FILTER_STATUSES,
  type RecentFilters,
} from "../types/recent-filter.types";
import type { AssessmentSummary } from "../types/workspace.types";

export function getVisibleRecentAssessments(
  assessments: AssessmentSummary[],
  filters: RecentFilters,
) {
  if (filters.status === RECENT_FILTER_STATUSES.archived) {
    return [];
  }

  const sorted = [...assessments];

  if (filters.sortBy === RECENT_FILTER_SORTS.name) {
    sorted.sort((left, right) => left.name.localeCompare(right.name));
  }

  if (filters.sortBy === RECENT_FILTER_SORTS.dateCreated) {
    sorted.sort(
      (left, right) =>
        new Date(right.created_at).getTime() -
        new Date(left.created_at).getTime(),
    );
  }

  return sorted.slice(0, 3);
}
