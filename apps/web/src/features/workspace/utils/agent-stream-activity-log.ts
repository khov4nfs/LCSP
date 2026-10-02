import type { AssessmentAgentStreamEvent } from "@lcsp/contracts/evidence";

import type { AgentStreamActivityLogRow } from "../types/agent-stream-activity-log.types";
import {
  activityCopy,
  projectStreamRows,
  type ProjectedStreamRow,
} from "./agent-stream-projection";

const VISIBLE_TOOL_ACTIVITIES = new Set([
  "codebaseGraphQueried",
  "sourceFilesReviewed",
  "repositorySourceSearched",
]);

function visibleActivityKey(row: ProjectedStreamRow): string | null {
  if (
    row.kind === "tool" &&
    row.activity &&
    VISIBLE_TOOL_ACTIVITIES.has(row.activity)
  ) {
    return row.activity;
  }
  if (
    row.kind === "model" &&
    row.label === activityCopy("aiAnalysisCompleted")
  ) {
    return "aiAnalysisCompleted";
  }
  if (row.label === activityCopy("agentContextTrimmed")) {
    return "agentContextTrimmed";
  }
  return null;
}

/**
 * Shows only the requested customer activities. Each activity keeps one
 * stable row while its latest target and count change as events stream in.
 */
export function projectAgentStreamActivityLog(
  events: AssessmentAgentStreamEvent[],
): AgentStreamActivityLogRow[] {
  const buckets = new Map<
    string,
    { first: ProjectedStreamRow; latest: ProjectedStreamRow; count: number }
  >();
  for (const row of projectStreamRows(events)) {
    const key = visibleActivityKey(row);
    if (key === null) continue;
    const bucket = buckets.get(key);
    if (!bucket) {
      buckets.set(key, { first: row, latest: row, count: 1 });
      continue;
    }
    bucket.count += 1;
    if (row.sequence >= bucket.latest.sequence) bucket.latest = row;
    if (row.firstSequence < bucket.first.firstSequence) bucket.first = row;
  }
  return [...buckets.entries()]
    .sort(([, a], [, b]) => a.first.firstSequence - b.first.firstSequence)
    .map(([key, { latest, count }]) => ({
      key,
      label: latest.label,
      target: latest.target,
      count,
      status: latest.status,
      failed: latest.failed,
      kind: latest.kind,
      activity: latest.activity,
    }));
}
