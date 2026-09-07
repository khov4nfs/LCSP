import {
  ASSESSMENT_INTERVIEW_OUTCOMES,
  ASSESSMENT_RUNTIME_RUN_STATUSES,
} from "@lcsp/contracts/evidence";
import { REPOSITORY_SCAN_JOB_STATUSES } from "@lcsp/contracts/github-integration";
import { TECHNICAL_EVIDENCE_REPORT_STATUSES } from "@lcsp/contracts/scan";

import { ARTIFACT_STATUSES } from "@/features/artifacts/types/artifact.types";
import type {
  NormalizedAssessmentRuntime,
  NormalizedWorkflowStep,
} from "../../workspace/types/assessment-runtime-adapter.types";
import { normalizeAssessmentRuntime } from "../../workspace/utils/assessment-runtime-adapter";
import { WORKSPACE_RUNTIME_CONNECTION_STATES } from "../../workspace/types/workspace-runtime.types";

/** Development-only Figma fixture; never part of production runtime normalization. */
export function createAssessmentRuntimeSidebarPreview(
  assessmentId: string,
): NormalizedAssessmentRuntime {
  const snapshot = {
    id: "preview-snapshot",
    assessmentId,
    provider: "GITHUB",
    repositoryFullName: "khovan123/payment-service",
    branch: "feat/payment-risk-controls",
    commitSha: "9f31ca2",
    createdAt: "2026-09-06T10:00:00.000Z",
  };
  const scanJob = {
    id: "preview-scan-job",
    assessmentId,
    snapshotId: snapshot.id,
    status: REPOSITORY_SCAN_JOB_STATUSES.completed,
    attemptCount: 1,
    blockedReason: null,
    updatedAt: "2026-09-06T10:01:00.000Z",
  };

  const runtime = normalizeAssessmentRuntime({
    assessmentId,
    interviewState: { outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextReady },
    timeline: {
      currentRun: {
        assessmentId,
        runId: "preview-run",
        stage: "INVESTIGATE",
        status: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
        activeTools: [],
        updatedAt: "2026-09-06T10:03:00.000Z",
      },
      recentActivity: [],
      latestRunId: "preview-run",
      connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.connected,
      lastEmittedAt: "2026-09-06T10:03:00.000Z",
      repositorySnapshot: snapshot,
      scanJobs: [scanJob],
      evidenceReports: [
        {
          id: "preview-evidence-report",
          assessmentId,
          scanJobId: scanJob.id,
          snapshotId: snapshot.id,
          status: TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted,
          rejectionReason: null,
          createdAt: "2026-09-06T10:02:00.000Z",
        },
      ],
    },
  });

  const previewSteps: NormalizedWorkflowStep[] = [
    {
      id: "REPOSITORY",
      label: "Repository",
      status: REPOSITORY_SCAN_JOB_STATUSES.completed,
      detail: null,
    },
    {
      id: "SCANNER",
      label: "Scanner",
      status: REPOSITORY_SCAN_JOB_STATUSES.completed,
      detail: null,
    },
    {
      id: "INTERVIEW",
      label: "Interview",
      status: REPOSITORY_SCAN_JOB_STATUSES.completed,
      detail: null,
    },
    {
      id: "RULES",
      label: "Rules",
      status: REPOSITORY_SCAN_JOB_STATUSES.completed,
      detail: null,
    },
    {
      id: "PLANNER",
      label: "Planner",
      status: REPOSITORY_SCAN_JOB_STATUSES.completed,
      detail: null,
    },
    {
      id: "INVESTIGATE",
      label: "Investigate",
      status: REPOSITORY_SCAN_JOB_STATUSES.running,
      detail: "Reviewing findings",
    },
    {
      id: "GATE",
      label: "Gate",
      status: REPOSITORY_SCAN_JOB_STATUSES.queued,
      detail: null,
    },
  ];

  return {
    ...runtime,
    repository: {
      provider: "GitHub",
      repositoryFullName: "payment-service",
      branch: "feat/payment-risk-controls",
      pinnedCommit: "9f31ca2",
      sourceState: "AVAILABLE",
    },
    workflow: { ...runtime.workflow, steps: previewSteps },
    artifacts: {
      ...runtime.artifacts,
      items: runtime.artifacts.items.map((item) =>
        item.type === "INVESTIGATION_NOTES"
          ? { ...item, status: ARTIFACT_STATUSES.updating, availability: "UPDATING" }
          : item,
      ),
    },
  };
}
