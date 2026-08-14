import * as assert from "node:assert/strict";
import { test } from "node:test";

import { parseRuntimeEvent } from "../src/features/workspace/utils/workspace-runtime-parser.ts";

test("workspace runtime parser groups runs and activity by assessment", () => {
  const parsed = parseRuntimeEvent(
    JSON.stringify({
      emitted_at: "2026-08-13T11:00:00.000Z",
      runs: [
        {
          assessment_id: "assessment-1",
          run_id: "run-1",
          stage: "TECHNICAL_EVIDENCE",
          status: "RUNNING",
          active_tools: [
            {
              tool_name: "get_scan_coverage",
              status: "RUNNING",
              summary: "Starting get_scan_coverage",
              started_at: "2026-08-13T10:59:00.000Z",
              attempt: 1,
            },
          ],
          updated_at: "2026-08-13T11:00:00.000Z",
        },
      ],
      recent_activity: [
        {
          event_id: "evt-1",
          sequence: 2,
          emitted_at: "2026-08-13T11:00:00.000Z",
          organization_id: "org-1",
          assessment_id: "assessment-1",
          run_id: "run-1",
          correlation_id: "corr-1",
          event_type: "TOOL_COMPLETED",
          run_status: "RUNNING",
          stage: "TECHNICAL_EVIDENCE",
          tool_name: "get_scan_coverage",
          summary: "Completed get_scan_coverage with 2 items",
          input_summary: { maxResults: 25 },
          output_summary: { itemCount: 2 },
          error_summary: null,
          started_at: "2026-08-13T10:59:00.000Z",
          completed_at: "2026-08-13T11:00:00.000Z",
          duration_ms: 1000,
          attempt: 1,
          waiting_reason: null,
        },
      ],
      scan_jobs: [],
      evidence_reports: [],
    }),
  );

  assert.ok(parsed);
  assert.equal(parsed?.runs.length, 1);
  assert.equal(parsed?.recentActivity.length, 1);
  assert.equal(parsed?.latestRunIdByAssessmentId["assessment-1"], "run-1");

  const assessmentRuntime = parsed?.getAssessmentRuntime("assessment-1");
  assert.equal(assessmentRuntime?.currentRun?.runId, "run-1");
  assert.equal(assessmentRuntime?.recentActivity[0]?.toolName, "get_scan_coverage");
});
