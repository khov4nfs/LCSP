import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ASSESSMENT_FLOW_STAGES,
  ASSESSMENT_REPOSITORY_PROVIDERS,
  ASSESSMENT_STATUS_CODES,
  type AssessmentRepositorySetupState,
} from "@lcsp/contracts/assessment";
import {
  CREDENTIAL_PROVIDERS,
  REPOSITORY_CONNECTION_STATUSES,
  REPOSITORY_SCAN_JOB_STATUSES,
  parseGitHubRepositoryUrl,
  parseGitLabRepositoryUrl,
} from "@lcsp/contracts/github-integration";
import { repositorySetupSchema } from "../src/features/assessment-flow/schemas/repository-setup.schema";
import { deriveAssessmentFlowRuntime } from "../src/features/assessment-flow/utils/assessment-flow-runtime";

function checkpoint(): AssessmentRepositorySetupState {
  return {
    assessmentId: "assessment-1",
    assessmentStatus: ASSESSMENT_STATUS_CODES.wizardInProgress,
    connection: {
      connectionId: "connection-1", provider: CREDENTIAL_PROVIDERS.github,
      repositoryId: "repo-1", repositoryFullName: "acme/project", defaultBranch: "main",
      status: REPOSITORY_CONNECTION_STATUSES.active,
    },
    snapshot: {
      id: "snapshot-1", assessmentId: "assessment-1", connectionId: "connection-1",
      provider: CREDENTIAL_PROVIDERS.github, repositoryFullName: "acme/project",
      branch: "main", commitSha: "a".repeat(40), createdAt: "2026-10-01T00:00:00Z",
    },
    scanJob: null,
  };
}

for (const status of [ASSESSMENT_STATUS_CODES.wizardInProgress, ASSESSMENT_STATUS_CODES.wizardSubmitted]) {
  test(`source checkpoint with ${status} but no scan job renders repository setup`, () => {
    const setupState = checkpoint();
    setupState.assessmentStatus = status;
    const flow = deriveAssessmentFlowRuntime({
      setupState, hasRepositoryConnection: true,
      snapshot: setupState.snapshot, scanJob: null, evidenceReport: null,
    });
    assert.equal(flow.stage, ASSESSMENT_FLOW_STAGES.repositorySetup);
  });
}

test("submitted checkpoint with a queued scan transitions to scanner", () => {
  const setupState = checkpoint();
  setupState.assessmentStatus = ASSESSMENT_STATUS_CODES.wizardSubmitted;
  setupState.scanJob = {
    id: "job-1", assessmentId: "assessment-1", snapshotId: "snapshot-1",
    status: REPOSITORY_SCAN_JOB_STATUSES.queued, attemptCount: 0,
    blockedReason: null, updatedAt: "2026-10-01T00:00:00Z",
  };
  const flow = deriveAssessmentFlowRuntime({ setupState, hasRepositoryConnection: true,
    snapshot: setupState.snapshot, scanJob: setupState.scanJob, evidenceReport: null });
  assert.equal(flow.stage, ASSESSMENT_FLOW_STAGES.scanner);
});

const samples = [
  "https://github.com/acme/project", "https://github.com/acme/project.git/",
  "https://github.com/acme//project", "https://github.com/acme/project/tree/main",
  "http://github.com/acme/project", "https://github.com/acme/project?tab=code",
  "https://gitlab.com/acme/tree/subgroup/project.git", "https://gitlab.com/acme//project",
  "https://gitlab.com/acme/project/-/blob/main/file.ts", "https://github.com/acme/project#readme",
];
for (const repositoryUrl of samples) {
  test(`web schema agrees with the API's shared parser: ${repositoryUrl}`, () => {
    for (const provider of [ASSESSMENT_REPOSITORY_PROVIDERS.github, ASSESSMENT_REPOSITORY_PROVIDERS.gitlab]) {
      const parse = provider === ASSESSMENT_REPOSITORY_PROVIDERS.github
        ? parseGitHubRepositoryUrl : parseGitLabRepositoryUrl;
      assert.equal(repositorySetupSchema.safeParse({ provider, repositoryUrl }).success, parse(repositoryUrl) !== null);
    }
  });
}
