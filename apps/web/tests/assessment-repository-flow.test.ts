import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  ASSESSMENT_FLOW_STAGES,
  ASSESSMENT_REPOSITORY_PROVIDERS,
} from "@lcsp/contracts/assessment";
import { REPOSITORY_SCAN_JOB_STATUSES } from "@lcsp/contracts/github-integration";
import { TECHNICAL_EVIDENCE_REPORT_STATUSES } from "@lcsp/contracts/scan";

import { repositorySetupSchema } from "../src/features/assessment-flow/schemas/repository-setup.schema";
import { deriveAssessmentFlowRuntime } from "../src/features/assessment-flow/utils/assessment-flow-runtime";
import { deriveProgramEvidenceSummary } from "../src/features/assessment-flow/utils/program-evidence-summary";
import { TOOL_ACTIVITY_STATUSES } from "../src/features/workspace/types/assessment-chat.types";
import type { WorkspaceRuntimeActivityItem } from "../src/features/workspace/types/workspace-runtime.types";

const newAssessmentPagePath = new URL(
  "../src/app/(workspace)/assessments/new/page.tsx",
  import.meta.url,
);
const repositorySetupPath = new URL(
  "../src/features/assessment-flow/components/organisms/repository-setup-step.tsx",
  import.meta.url,
);
const repositoryConnectionResultPath = new URL(
  "../src/features/assessment-flow/components/molecules/repository-connection-result.tsx",
  import.meta.url,
);
const assessmentOverviewPath = new URL(
  "../src/features/workspace/components/organisms/assessment-overview.tsx",
  import.meta.url,
);
const scannerStepPath = new URL(
  "../src/features/assessment-flow/components/organisms/scanner-step.tsx",
  import.meta.url,
);
const scannerSequencePath = new URL(
  "../src/features/assessment-flow/components/molecules/scanner-activity-sequence.tsx",
  import.meta.url,
);
const assessmentQueriesPath = new URL(
  "../src/lib/api/assessment-queries.ts",
  import.meta.url,
);

test("new assessment opens repository setup and removes the legacy details form", async () => {
  const [page, setup] = await Promise.all([
    readFile(newAssessmentPagePath, "utf8"),
    readFile(repositorySetupPath, "utf8"),
  ]);

  assert.match(page, /RepositorySetupStep/);
  assert.doesNotMatch(page, /CreateAssessmentForm/);
  assert.match(setup, /RepositorySetupConversation/);
  assert.match(setup, /connectAssessmentRepository/);
  assert.match(setup, /startRepositoryAnalysis/);
  assert.match(setup, /AssessmentComposer/);
});

test("flow remains in repository setup before a secure repository connection", () => {
  const flow = deriveAssessmentFlowRuntime({
    hasRepositoryConnection: false,
    snapshot: null,
    scanJob: null,
    evidenceReport: null,
  });

  assert.equal(flow.stage, ASSESSMENT_FLOW_STAGES.repositorySetup);
  assert.equal(flow.evidenceAccepted, false);
});

test("repository setup accepts only a repository URL matching a supported provider", () => {
  assert.equal(
    repositorySetupSchema.safeParse({
      provider: ASSESSMENT_REPOSITORY_PROVIDERS.github,
      repositoryUrl: "https://github.com/acme/payments.git",
    }).success,
    true,
  );
  assert.equal(
    repositorySetupSchema.safeParse({
      provider: ASSESSMENT_REPOSITORY_PROVIDERS.gitlab,
      repositoryUrl: "https://github.com/acme/payments",
    }).success,
    false,
  );
  assert.equal(
    repositorySetupSchema.safeParse({
      provider: ASSESSMENT_REPOSITORY_PROVIDERS.bitbucket,
      repositoryUrl: "https://bitbucket.org/acme/payments",
    }).success,
    false,
  );
});

test("repository history row uses provider and commit icons without repeating the prompt", async () => {
  const source = await readFile(repositoryConnectionResultPath, "utf8");

  assert.match(source, /data-slot="repository-connection-result"/);
  assert.match(source, /next\/image/);
  assert.match(source, /\/assets\/figma\/settings\/logo-github\.svg/);
  assert.match(source, /GitBranchIcon/);
  assert.match(source, /repositoryFullName/);
  assert.match(source, /commitSha\.slice\(0, 12\)/);
  assert.doesNotMatch(source, /<svg/);
  assert.doesNotMatch(source, /SelectionHistoryRow/);
  assert.doesNotMatch(source, /selectedValue/);
});

test("flow remains in scanner while source evidence is incomplete", () => {
  const flow = deriveAssessmentFlowRuntime({
    hasRepositoryConnection: true,
    snapshot: {
      id: "snapshot-1",
      assessmentId: "assessment-1",
      provider: ASSESSMENT_REPOSITORY_PROVIDERS.github,
      repositoryFullName: "acme/payments",
      branch: null,
      commitSha: "a".repeat(40),
      createdAt: "2026-09-05T00:00:00.000Z",
    },
    scanJob: {
      id: "scan-1",
      assessmentId: "assessment-1",
      snapshotId: "snapshot-1",
      status: REPOSITORY_SCAN_JOB_STATUSES.running,
      attemptCount: 1,
      blockedReason: null,
      updatedAt: "2026-09-05T00:00:01.000Z",
    },
    evidenceReport: null,
  });

  assert.equal(flow.stage, ASSESSMENT_FLOW_STAGES.scanner);
  assert.deepEqual(
    flow.activities.map((activity) => activity.status),
    [
      TOOL_ACTIVITY_STATUSES.completed,
      TOOL_ACTIVITY_STATUSES.completed,
      TOOL_ACTIVITY_STATUSES.running,
      TOOL_ACTIVITY_STATUSES.pending,
      TOOL_ACTIVITY_STATUSES.pending,
    ],
  );
});

test("flow begins Interview only after accepted evidence for the scan", () => {
  const flow = deriveAssessmentFlowRuntime({
    hasRepositoryConnection: true,
    snapshot: {
      id: "snapshot-1",
      assessmentId: "assessment-1",
      provider: ASSESSMENT_REPOSITORY_PROVIDERS.github,
      repositoryFullName: "acme/payments",
      branch: null,
      commitSha: "a".repeat(40),
      createdAt: "2026-09-05T00:00:00.000Z",
    },
    scanJob: {
      id: "scan-1",
      assessmentId: "assessment-1",
      snapshotId: "snapshot-1",
      status: REPOSITORY_SCAN_JOB_STATUSES.completed,
      attemptCount: 1,
      blockedReason: null,
      updatedAt: "2026-09-05T00:00:02.000Z",
    },
    evidenceReport: {
      id: "evidence-1",
      assessmentId: "assessment-1",
      scanJobId: "scan-1",
      snapshotId: "snapshot-1",
      status: TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted,
      rejectionReason: null,
      createdAt: "2026-09-05T00:00:03.000Z",
    },
  });

  assert.equal(flow.stage, ASSESSMENT_FLOW_STAGES.interview);
  assert.equal(flow.evidenceAccepted, true);
  assert.ok(
    flow.activities.every(
      (activity) => activity.status === TOOL_ACTIVITY_STATUSES.completed,
    ),
  );
});

test("completed scan waits for accepted evidence before rendering F04", () => {
  const flow = deriveAssessmentFlowRuntime({
    hasRepositoryConnection: true,
    snapshot: {
      id: "snapshot-1",
      assessmentId: "assessment-1",
      provider: ASSESSMENT_REPOSITORY_PROVIDERS.github,
      repositoryFullName: "acme/payments",
      branch: null,
      commitSha: "b".repeat(40),
      createdAt: "2026-09-05T00:00:00.000Z",
    },
    scanJob: {
      id: "scan-1",
      assessmentId: "assessment-1",
      snapshotId: "snapshot-1",
      status: REPOSITORY_SCAN_JOB_STATUSES.completed,
      attemptCount: 1,
      blockedReason: null,
      updatedAt: "2026-09-05T00:00:02.000Z",
    },
    evidenceReport: null,
  });

  assert.equal(flow.stage, ASSESSMENT_FLOW_STAGES.scanner);
  assert.equal(flow.evidenceAccepted, false);
  assert.deepEqual(
    flow.activities.map((activity) => activity.status),
    [
      TOOL_ACTIVITY_STATUSES.completed,
      TOOL_ACTIVITY_STATUSES.completed,
      TOOL_ACTIVITY_STATUSES.completed,
      TOOL_ACTIVITY_STATUSES.completed,
      TOOL_ACTIVITY_STATUSES.running,
    ],
  );
});

test("failed repository scan stays in scanner and marks source scan failed", () => {
  const flow = deriveAssessmentFlowRuntime({
    hasRepositoryConnection: true,
    snapshot: {
      id: "snapshot-1",
      assessmentId: "assessment-1",
      provider: ASSESSMENT_REPOSITORY_PROVIDERS.github,
      repositoryFullName: "acme/payments",
      branch: null,
      commitSha: "c".repeat(40),
      createdAt: "2026-09-05T00:00:00.000Z",
    },
    scanJob: {
      id: "scan-1",
      assessmentId: "assessment-1",
      snapshotId: "snapshot-1",
      status: REPOSITORY_SCAN_JOB_STATUSES.failed,
      attemptCount: 1,
      blockedReason: null,
      updatedAt: "2026-09-05T00:00:02.000Z",
    },
    evidenceReport: null,
  });

  assert.equal(flow.stage, ASSESSMENT_FLOW_STAGES.scanner);
  assert.equal(flow.scanFailed, true);
  assert.deepEqual(
    flow.activities.map((activity) => activity.status),
    [
      TOOL_ACTIVITY_STATUSES.completed,
      TOOL_ACTIVITY_STATUSES.completed,
      TOOL_ACTIVITY_STATUSES.failed,
      TOOL_ACTIVITY_STATUSES.pending,
      TOOL_ACTIVITY_STATUSES.pending,
    ],
  );
});

test("assessment scanner renders retry action for failed source scans", async () => {
  const [overviewSource, scannerStepSource, queriesSource] = await Promise.all([
    readFile(assessmentOverviewPath, "utf8"),
    readFile(scannerStepPath, "utf8"),
    readFile(assessmentQueriesPath, "utf8"),
  ]);

  assert.match(overviewSource, /useRerunRepositoryScanMutation/);
  assert.match(
    overviewSource,
    /retryScanSnapshotId = scanJob\?\.snapshotId \?\? snapshot\?\.id/,
  );
  assert.match(overviewSource, /scanFailed={flow\.scanFailed}/);
  assert.match(
    overviewSource,
    /retryScan\.mutate\(\{ snapshotId: retryScanSnapshotId \}\)/,
  );
  assert.match(scannerStepSource, /RotateCcwIcon/);
  assert.match(scannerStepSource, /pages\.assessmentFlow\.scanner\.retryScan/);
  assert.match(
    scannerStepSource,
    /pages\.assessmentFlow\.scanner\.retryingScan/,
  );
  assert.match(scannerStepSource, /pages\.assessmentFlow\.scanner\.retryError/);
  assert.match(queriesSource, /apiQueryKeys\.workspace\.detail\(\)/);
});

test("program evidence graph metrics ignore runtime summaries and use canonical overview", () => {
  const summary = deriveProgramEvidenceSummary({
    recentActivity: [
      runtimeActivity({
        eventId: "event-1",
        toolName: "build_evidence_graph",
        inputSummary: {
          structuralFacts: 61,
          technicalFindings: 13,
          packageDependencies: 34,
        },
        outputSummary: {
          coverageNotes: 2,
        },
      }),
    ],
  });

  assert.equal(summary.codeSymbolsIndexed.value, null);
  assert.equal(summary.aiModelInvocations.value, null);
  assert.equal(summary.modulesAnalyzed.value, null);
  assert.equal(summary.evidenceMappedScope.value, null);

  const canonical = deriveProgramEvidenceSummary({
    recentActivity: [
      runtimeActivity({
        eventId: "event-conflicting-runtime-summary",
        toolName: "build_evidence_graph",
        inputSummary: { structuralFacts: 999, technicalFindings: 888 },
      }),
    ],
    canonicalOverview: {
      modules_analyzed: 0,
      code_symbols_indexed: 12,
      ai_model_invocations: 4,
      evidence_mapped_scope: 0,
    },
  });
  assert.equal(canonical.modulesAnalyzed.value, 0);
  assert.equal(canonical.codeSymbolsIndexed.value, 12);
  assert.equal(canonical.aiModelInvocations.value, 4);
  assert.equal(canonical.evidenceMappedScope.value, 0);
});

test("scanner activity composition reuses the shared ToolActivity rows", async () => {
  const source = await readFile(scannerSequencePath, "utf8");

  assert.match(source, /ToolActivityList/);
  assert.match(source, /ToolActivityRow/);
  assert.doesNotMatch(source, /function ToolActivityRow/);
});

function runtimeActivity(
  overrides: Partial<WorkspaceRuntimeActivityItem>,
): WorkspaceRuntimeActivityItem {
  return {
    eventId: "event",
    sequence: 1,
    emittedAt: "2026-09-05T00:00:01.000Z",
    assessmentId: "assessment-1",
    runId: "run-1",
    correlationId: "correlation-1",
    eventType: "TOOL_COMPLETED",
    runStatus: "RUNNING",
    stage: "SCAN",
    toolName: null,
    summary: "Runtime event",
    inputSummary: null,
    outputSummary: null,
    errorSummary: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    attempt: null,
    waitingReason: null,
    ...overrides,
  };
}
