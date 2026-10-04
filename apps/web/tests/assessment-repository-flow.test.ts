import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  ASSESSMENT_GRAPH_STATES,
  ASSESSMENT_FLOW_STAGES,
  ASSESSMENT_REPOSITORY_PROVIDERS,
  ASSESSMENT_STATUS_CODES,
} from "@lcsp/contracts/assessment";
import {
  REPOSITORY_CONNECTION_STATUSES,
  REPOSITORY_SCAN_JOB_STATUSES,
} from "@lcsp/contracts/github-integration";
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
const repositoryReviewPath = new URL(
  "../src/features/assessment-flow/components/organisms/repository-review-turn.tsx",
  import.meta.url,
);
const repositoryMapPath = new URL(
  "../src/features/assessment-flow/components/organisms/repository-map-turn.tsx",
  import.meta.url,
);
const repositoryDetailsPath = new URL(
  "../src/features/assessment-flow/components/organisms/repository-details-turn.tsx",
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

test("new assessment renders the active repository entry as one inline form", async () => {
  const [page, setup, overview] = await Promise.all([
    readFile(newAssessmentPagePath, "utf8"),
    readFile(repositorySetupPath, "utf8"),
    readFile(assessmentOverviewPath, "utf8"),
  ]);

  assert.match(page, /RepositorySetupStep/);
  assert.doesNotMatch(page, /CreateAssessmentForm/);
  assert.match(setup, /ProviderCredentialDialog/);
  assert.match(setup, /ConfirmAccessDialog/);
  assert.match(setup, /onReauthenticate/);
  assert.doesNotMatch(
    setup,
    /useDeleteAssessmentMutation|deleteAssessment\.mutateAsync/,
  );
  assert.match(setup, /connectAssessmentRepository/);
  assert.match(setup, /startAssessmentRepositoryAnalysis/);
  assert.match(setup, /RepositoryDetailsTurn/);
  assert.match(setup, /isInlineMapRepositoryEntry/);
  assert.match(
    setup,
    /entryReturnStep === REPOSITORY_SETUP_STEPS\.repositoryMap/,
  );
  assert.match(setup, /onProviderChange=/);
  assert.match(setup, /credentialConfigured/);
  assert.match(setup, /entryReturnStep/);
  assert.match(setup, /allRepositoriesPinned/);
  assert.doesNotMatch(setup, /AssessmentComposer/);
  assert.doesNotMatch(overview, /RepositorySetupConversation/);
  assert.match(setup, /RepositoryReviewTurn/);
  assert.match(setup, /REPOSITORY_SETUP_STEPS/);
  assert.match(setup, /REPOSITORY_ENTRY_INTENTS/);
  assert.match(setup, /refreshedRepositories\.length > 0/);
  assert.match(setup, /REPOSITORY_SETUP_STEPS\.repositoryMap/);
  assert.match(setup, /setupState\.repositories\.length > 0/);
});

test("review and map stay inside the Agent transcript with explicit terminal actions", async () => {
  const [review, map] = await Promise.all([
    readFile(repositoryReviewPath, "utf8"),
    readFile(repositoryMapPath, "utf8"),
  ]);
  assert.match(review, /Confirm and start scan|confirmScope/);
  assert.match(review, /onBack/);
  assert.match(review, /relations/);
  assert.match(map, /<table/);
  assert.match(map, /<select/);
  assert.match(map, /removeConfirm/);
  assert.match(map, /editRelation/);
  assert.match(map, /confirmingRelationRemoval/);
  assert.match(map, /removeRelationConfirm/);
  assert.match(map, /<AgentTurn>/);
  assert.match(map, /pinnableRepositories\.length > 0/);
  assert.match(map, /pinnableRepositories\.length > 1/);
  assert.match(map, /repositoryEntryActive/);
  assert.match(map, /onRelationEditorOpen/);
  assert.match(map, /aria-pressed=\{editorOpen\}/);
  assert.match(map, /aria-pressed=\{repositoryEntryActive\}/);
  assert.doesNotMatch(map, /keepIndependent|independentAcknowledged/);
  assert.match(map, /onReviewScope/);
  assert.match(map, /autoFocus/);
  assert.doesNotMatch(review, /onAddRepository|onEditMap/);
});

test("repository provider choices render the approved provider logos", async () => {
  const details = await readFile(repositoryDetailsPath, "utf8");

  assert.match(details, /<Image/);
  assert.match(details, /data-selected=\{selected \? "true" : "false"\}/);
  assert.match(details, /ring-primary\/30/);
  assert.doesNotMatch(details, /text-primary-foreground/);
  assert.match(details, /logo-github\.svg/);
  assert.match(details, /logo-gitlab\.svg/);
  assert.match(details, /logo-bitbucket\.svg/);
  assert.match(details, /logo-azure-devops\.svg/);
});

test("aggregate runtime waits for every repository and the aggregate graph", () => {
  const setupState = {
    assessmentId: "assessment-1",
    assessmentStatus: ASSESSMENT_STATUS_CODES.wizardSubmitted,
    connection: null,
    snapshot: {
      id: "snapshot-2",
      assessmentId: "assessment-1",
      connectionId: "connection-2",
      provider: ASSESSMENT_REPOSITORY_PROVIDERS.github,
      repositoryFullName: "acme/api",
      branch: "main",
      commitSha: "b".repeat(40),
      createdAt: "2026-10-01T00:00:00Z",
    },
    scanJob: null,
    repositories: [
      {
        connectionId: "connection-1",
        provider: ASSESSMENT_REPOSITORY_PROVIDERS.github,
        repositoryId: "repo-1",
        repositoryFullName: "acme/web",
        defaultBranch: "main",
        status: REPOSITORY_CONNECTION_STATUSES.active,
        snapshot: {
          id: "snapshot-1",
          branch: "main",
          commitSha: "a".repeat(40),
          createdAt: "2026-10-01T00:00:00Z",
        },
        scanJob: {
          id: "job-1",
          status: REPOSITORY_SCAN_JOB_STATUSES.completed,
          attemptCount: 1,
          blockedReason: null,
          updatedAt: "2026-10-01T00:00:01Z",
        },
      },
      {
        connectionId: "connection-2",
        provider: ASSESSMENT_REPOSITORY_PROVIDERS.gitlab,
        repositoryId: "repo-2",
        repositoryFullName: "acme/api",
        defaultBranch: "main",
        status: REPOSITORY_CONNECTION_STATUSES.active,
        snapshot: {
          id: "snapshot-2",
          branch: "main",
          commitSha: "b".repeat(40),
          createdAt: "2026-10-01T00:00:00Z",
        },
        scanJob: {
          id: "job-2",
          status: REPOSITORY_SCAN_JOB_STATUSES.running,
          attemptCount: 1,
          blockedReason: null,
          updatedAt: "2026-10-01T00:00:01Z",
        },
      },
    ],
    programEvidenceGraph: {
      state: ASSESSMENT_GRAPH_STATES.notReady,
      reportCount: 1,
    },
  };
  const flow = deriveAssessmentFlowRuntime({
    setupState,
    hasRepositoryConnection: true,
    snapshot: setupState.snapshot,
    scanJob: null,
    evidenceReport: null,
  });
  assert.equal(flow.stage, ASSESSMENT_FLOW_STAGES.scanner);
  assert.equal(flow.evidenceAccepted, false);
  assert.equal(flow.scanActive, true);
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

test("flow remains in repository setup when repository connection exists without a pinned snapshot", () => {
  const flow = deriveAssessmentFlowRuntime({
    hasRepositoryConnection: true,
    snapshot: null,
    scanJob: null,
    evidenceReport: null,
  });

  assert.equal(flow.stage, ASSESSMENT_FLOW_STAGES.repositorySetup);
  assert.equal(flow.evidenceAccepted, false);
});

test("repository setup accepts only valid repository URLs matching supported provider rules", () => {
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
      repositoryUrl: "https://gitlab.com/org/team/subgroup/project.git",
    }).success,
    true,
  );
  assert.equal(
    repositorySetupSchema.safeParse({
      provider: ASSESSMENT_REPOSITORY_PROVIDERS.bitbucket,
      repositoryUrl: "https://bitbucket.org/workspace-slug/repo-slug",
    }).success,
    false,
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
      repositoryUrl: "https://bitbucket.org/workspace/repo/src/main",
    }).success,
    false,
  );
  assert.equal(
    repositorySetupSchema.safeParse({
      provider: ASSESSMENT_REPOSITORY_PROVIDERS.github,
      repositoryUrl: "http://github.com/acme/payments",
    }).success,
    false,
  );
  assert.equal(
    repositorySetupSchema.safeParse({
      provider: ASSESSMENT_REPOSITORY_PROVIDERS.github,
      repositoryUrl: "https://github.com/acme/payments/tree/main",
    }).success,
    false,
  );
  assert.equal(
    repositorySetupSchema.safeParse({
      provider: ASSESSMENT_REPOSITORY_PROVIDERS.github,
      repositoryUrl: "https://github.com/acme/payments?tab=code",
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
  assert.equal(flow.scanActive, true);
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
  assert.equal(flow.scanActive, false);
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
