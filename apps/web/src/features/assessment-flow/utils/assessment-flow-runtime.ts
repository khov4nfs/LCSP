import {
  ASSESSMENT_GRAPH_STATES,
  ASSESSMENT_FLOW_STAGES,
  needsRepositorySetupResume,
  type AssessmentRepositorySetupState,
} from "@lcsp/contracts/assessment";
import { REPOSITORY_SCAN_JOB_STATUSES } from "@lcsp/contracts/github-integration";
import { TECHNICAL_EVIDENCE_REPORT_STATUSES } from "@lcsp/contracts/scan";

import { TOOL_ACTIVITY_STATUSES } from "@/features/workspace/types/assessment-chat.types";
import type {
  WorkspaceRuntimeActivityItem,
  WorkspaceRuntimeEvidenceReport,
  WorkspaceRuntimeRepositorySnapshot,
  WorkspaceRuntimeScanJob,
} from "@/features/workspace/types/workspace-runtime.types";

import {
  SCANNER_ACTIVITY_CONFIG,
  SCANNER_ACTIVITY_IDS,
} from "../config/scanner-activities";
import type { ScannerActivityItem } from "../types/assessment-flow.types";
import { deriveProgramEvidenceSummary } from "./program-evidence-summary";

export function deriveAssessmentFlowRuntime(input: {
  setupState?: AssessmentRepositorySetupState;
  hasRepositoryConnection: boolean;
  snapshot: WorkspaceRuntimeRepositorySnapshot | null;
  scanJob: WorkspaceRuntimeScanJob | null;
  evidenceReport: WorkspaceRuntimeEvidenceReport | null;
  recentActivity?: WorkspaceRuntimeActivityItem[];
}) {
  const aggregateRepositories = input.setupState?.repositories;
  const usesAggregateState = Boolean(
    aggregateRepositories && aggregateRepositories.length > 0,
  );
  const aggregateScanFailed = Boolean(
    aggregateRepositories?.some(
      (repository) =>
        repository.scanJob?.status === REPOSITORY_SCAN_JOB_STATUSES.failed ||
        repository.scanJob?.status === REPOSITORY_SCAN_JOB_STATUSES.blocked ||
        repository.scanJob?.status ===
          REPOSITORY_SCAN_JOB_STATUSES.blockedMapping,
    ),
  );
  const aggregateScanCompleted = Boolean(
    aggregateRepositories &&
    aggregateRepositories.length > 0 &&
    aggregateRepositories.every(
      (repository) =>
        repository.scanJob?.status === REPOSITORY_SCAN_JOB_STATUSES.completed,
    ),
  );
  const aggregateScanActive = Boolean(
    aggregateRepositories?.some(
      (repository) =>
        repository.scanJob?.status === REPOSITORY_SCAN_JOB_STATUSES.queued ||
        repository.scanJob?.status === REPOSITORY_SCAN_JOB_STATUSES.running ||
        repository.scanJob?.status ===
          REPOSITORY_SCAN_JOB_STATUSES.waitingForCredits,
    ),
  );
  const aggregateGraphReady =
    input.setupState?.programEvidenceGraph?.state ===
    ASSESSMENT_GRAPH_STATES.ready;
  const scanFailed = usesAggregateState
    ? aggregateScanFailed
    : input.scanJob?.status === REPOSITORY_SCAN_JOB_STATUSES.failed ||
      input.scanJob?.status === REPOSITORY_SCAN_JOB_STATUSES.blocked ||
      input.scanJob?.status === REPOSITORY_SCAN_JOB_STATUSES.blockedMapping;
  const scanCompleted = usesAggregateState
    ? aggregateScanCompleted
    : input.scanJob?.status === REPOSITORY_SCAN_JOB_STATUSES.completed;
  const scanActive = usesAggregateState
    ? aggregateScanActive
    : Boolean(
        input.snapshot &&
        input.scanJob?.snapshotId === input.snapshot.id &&
        (input.scanJob.status === REPOSITORY_SCAN_JOB_STATUSES.queued ||
          input.scanJob.status === REPOSITORY_SCAN_JOB_STATUSES.running ||
          input.scanJob.status ===
            REPOSITORY_SCAN_JOB_STATUSES.waitingForCredits),
      );
  const reportMatchesScan = Boolean(
    input.scanJob &&
    input.evidenceReport?.scanJobId === input.scanJob.id &&
    input.evidenceReport.snapshotId === input.scanJob.snapshotId,
  );
  const evidenceAccepted = usesAggregateState
    ? scanCompleted && aggregateGraphReady
    : scanCompleted &&
      reportMatchesScan &&
      input.evidenceReport?.status ===
        TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted;
  const evidenceRejected =
    reportMatchesScan &&
    input.evidenceReport?.status ===
      TECHNICAL_EVIDENCE_REPORT_STATUSES.rejected;

  const stage =
    !input.hasRepositoryConnection ||
    !input.snapshot ||
    (input.setupState !== undefined &&
      needsRepositorySetupResume(input.setupState))
      ? ASSESSMENT_FLOW_STAGES.repositorySetup
      : evidenceAccepted
        ? ASSESSMENT_FLOW_STAGES.interview
        : ASSESSMENT_FLOW_STAGES.scanner;

  const activities: ScannerActivityItem[] = SCANNER_ACTIVITY_CONFIG.map(
    (activity) => ({
      ...activity,
      status:
        activity.id === SCANNER_ACTIVITY_IDS.connect
          ? input.hasRepositoryConnection
            ? TOOL_ACTIVITY_STATUSES.completed
            : TOOL_ACTIVITY_STATUSES.running
          : activity.id === SCANNER_ACTIVITY_IDS.clone
            ? input.snapshot
              ? TOOL_ACTIVITY_STATUSES.completed
              : input.hasRepositoryConnection
                ? TOOL_ACTIVITY_STATUSES.running
                : TOOL_ACTIVITY_STATUSES.pending
            : activity.id === SCANNER_ACTIVITY_IDS.scan
              ? scanFailed
                ? TOOL_ACTIVITY_STATUSES.failed
                : scanCompleted
                  ? TOOL_ACTIVITY_STATUSES.completed
                  : scanActive
                    ? TOOL_ACTIVITY_STATUSES.running
                    : TOOL_ACTIVITY_STATUSES.pending
              : activity.id === SCANNER_ACTIVITY_IDS.buildGraph
                ? scanCompleted || evidenceAccepted || evidenceRejected
                  ? TOOL_ACTIVITY_STATUSES.completed
                  : TOOL_ACTIVITY_STATUSES.pending
                : evidenceAccepted
                  ? TOOL_ACTIVITY_STATUSES.completed
                  : evidenceRejected
                    ? TOOL_ACTIVITY_STATUSES.failed
                    : scanCompleted
                      ? TOOL_ACTIVITY_STATUSES.running
                      : TOOL_ACTIVITY_STATUSES.pending,
    }),
  );

  return {
    stage,
    activities,
    scanFailed,
    scanActive,
    evidenceAccepted,
    programEvidenceSummary: deriveProgramEvidenceSummary({
      recentActivity: input.recentActivity,
    }),
  };
}
