import {
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import {
  CREDENTIAL_PROVIDERS,
  GITHUB_INTEGRATION_ERROR_CODES,
  parseAzureDevOpsRepositoryUrl,
  parseBitbucketRepositoryUrl,
  parseGitHubRepositoryUrl,
  parseGitLabRepositoryUrl,
} from "@lcsp/contracts/github-integration";

import { isRecord, isString } from "@lcsp/contracts/shared";

import {
  assessmentRepositorySetupSchema,
  completeAssessmentRepositorySetupResultSchema,
  type AssessmentRepositorySetup,
} from "@lcsp/contracts/assessment-domain";
import { apiValidated, apiRequest } from "./api-request.ts";

export type StartRepositoryAnalysisInput = {
  connectionId: string;
  branch: string;
  /**
   * The current Web product supports full-repository analysis only.
   * Keep this explicit so a future subtree selector cannot silently widen scope.
   */
  sourcePathPrefix: null;
};

export type AssessmentRepositoryConnection = NonNullable<
  AssessmentRepositorySetup["connection"]
>;

/**
 * Business purpose: Connect or explicitly reauthorize the repository selected for an owned assessment.
 * Business rules:
 * - A retry cannot replace the saved provider or repository.
 * - Reconnection bypasses only the idempotent UI shortcut and remains subject to backend ownership and credential checks.
 * Execution flow:
 * 1. Read the authoritative setup checkpoint.
 * 2. For ordinary retries, match the parsed provider and repository identity.
 * 3. Submit only a new or explicitly reauthorized connection to the backend.
 * Failure cases:
 * - Provider mismatch, different repository identity, malformed response, disabled provider, or failed authorization rejects without updating client state.
 * Side effects:
 * - May create or reauthorize one repository connection through the authenticated API.
 */
export async function connectAssessmentRepository(
  assessmentId: string,
  repositoryUrl: string,
  forceReauthorization = false,
): Promise<AssessmentRepositoryConnection> {
  // A previous request may have committed even when its response was lost.
  const state = await getRepositorySetupState(assessmentId);
  if (
    state.connection &&
    !forceReauthorization
  ) {
    const parsed = parseRepositoryUrl(repositoryUrl);
    const sameRepository =
      parsed?.provider === state.connection.provider &&
      parsed.locator.repositoryFullName ===
        state.connection.repositoryFullName;
    if (!sameRepository) {
      throw new Error(GITHUB_INTEGRATION_ERROR_CODES.connectionAlreadyExists);
    }
    return state.connection;
  }
  const response = await apiRequest(
    `/api/assessments/${encodeURIComponent(assessmentId)}/repository-connection`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repositoryUrl }),
    },
  );
  if (!response.ok || !isAssessmentConnection(response.payload)) {
    throw new Error(response.problemCode ?? "repository-connection-failed");
  }
  return response.payload;
}

/**
 * Business purpose: Match a repository URL to exactly one recognized provider locator for idempotent setup checks.
 * Business rules:
 * - Parsing is provider-specific, rejects unsupported hosts, and never establishes access or repository identity.
 * Execution flow:
 * 1. Try the supported host parsers in fixed order.
 * 2. Return the first provider-locator pair or null.
 * Failure cases:
 * - Invalid or unsupported URLs return null and are rejected by the calling connection flow.
 * Side effects:
 * - Pure URL parsing with no network access or persistence.
 */
function parseRepositoryUrl(value: string) {
  const github = parseGitHubRepositoryUrl(value);
  if (github) return { provider: CREDENTIAL_PROVIDERS.github, locator: github };
  const gitlab = parseGitLabRepositoryUrl(value);
  if (gitlab) return { provider: CREDENTIAL_PROVIDERS.gitlab, locator: gitlab };
  const bitbucket = parseBitbucketRepositoryUrl(value);
  if (bitbucket) return { provider: CREDENTIAL_PROVIDERS.bitbucket, locator: bitbucket };
  const azure = parseAzureDevOpsRepositoryUrl(value);
  return azure ? { provider: CREDENTIAL_PROVIDERS.azureDevOps, locator: azure } : null;
}

function isAssessmentConnection(
  payload: unknown,
): payload is AssessmentRepositoryConnection {
  return assessmentRepositorySetupSchema.shape.connection
    .unwrap()
    .safeParse(payload).success;
}

export type StartRepositoryAnalysisResult = {
  snapshotId: string;
  commitSha: string;
  lifecycleState:
    | typeof ASSESSMENT_LIFECYCLE_STATES.PREPARING
    | typeof ASSESSMENT_LIFECYCLE_STATES.ACTIVE;
};

type SnapshotPayload = {
  snapshot_id: string;
  commit_sha: string;
};

/** Fetch an authoritative checkpoint; never infer success from a stale UI cache. */
export async function getRepositorySetupState(
  assessmentId: string,
): Promise<AssessmentRepositorySetup> {
  const state = await apiValidated(
    `/api/assessments/${encodeURIComponent(assessmentId)}/repository-setup`,
    assessmentRepositorySetupSchema,
    { cache: "no-store" },
  );
  if (state.assessmentId !== assessmentId)
    throw new Error(ASSESSMENT_ERROR_CODES.repositorySetupStateInvalid);
  return state;
}

// Coalesce repeated submissions in this client. Server scan idempotency remains authoritative.
const pendingAnalyses = new Map<
  string,
  Promise<StartRepositoryAnalysisResult>
>();

export function startRepositoryAnalysis(
  assessmentId: string,
  input: StartRepositoryAnalysisInput,
): Promise<StartRepositoryAnalysisResult> {
  const key = `${assessmentId}:${input.connectionId}`;
  const pending = pendingAnalyses.get(key);
  if (pending) return pending;
  const request = resumeRepositoryAnalysis(assessmentId, input).finally(() => {
    pendingAnalyses.delete(key);
  });
  pendingAnalyses.set(key, request);
  return request;
}

/**
 * Business purpose: Resume or complete the Web repository setup from the server's authoritative checkpoint.
 * Business rules:
 * - The current Web product supports full-repository scope only and must never resume a subtree snapshot as full-repo.
 * - A validated completion reports PREPARING while legal inputs are unavailable; only ACTIVE permits advancing to the assessment.
 * - ACTIVE checkpoints can be resumed without creating a scan or repeating completion. Other lifecycle states fail closed.
 * Execution flow:
 * 1. Reload setup state and verify the connection and eligible lifecycle.
 * 2. Pin a full-repo snapshot only when none exists, then validate completion against the persisted snapshot.
 * 3. Reconcile the saved checkpoint and return its lifecycle so the caller distinguishes waiting for legal inputs from activation.
 * Failure cases:
 * - Missing connection, incompatible scope, invalid lifecycle or mismatched persisted identities fail before further mutation.
 * Side effects:
 * - May create one full-repository snapshot and complete repository setup through the API; retries reconcile persisted state.
 */
async function resumeRepositoryAnalysis(
  assessmentId: string,
  input: StartRepositoryAnalysisInput,
): Promise<StartRepositoryAnalysisResult> {
  let state = await getRepositorySetupState(assessmentId);
  if (
    !state.connection ||
    state.connection.connectionId !== input.connectionId
  ) {
    throw new Error(GITHUB_INTEGRATION_ERROR_CODES.connectionNotFound);
  }
  if (
    state.lifecycle?.state !== ASSESSMENT_LIFECYCLE_STATES.PREPARING &&
    state.lifecycle?.state !== ASSESSMENT_LIFECYCLE_STATES.ACTIVE
  ) {
    throw new Error(ASSESSMENT_ERROR_CODES.repositorySetupStateInvalid);
  }

  if (!state.snapshot) {
    if (state.lifecycle?.state !== ASSESSMENT_LIFECYCLE_STATES.PREPARING) {
      throw new Error(ASSESSMENT_ERROR_CODES.repositorySetupStateInvalid);
    }
    const snapshotResponse = await apiRequest(
      `/api/assessments/${encodeURIComponent(assessmentId)}/snapshots`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          connection_id: input.connectionId,
          branch: input.branch,
          source_path_prefix: input.sourcePathPrefix,
        }),
      },
    );
    if (!snapshotResponse.ok || !isSnapshotPayload(snapshotResponse.payload)) {
      throw new Error(
        snapshotResponse.problemCode ?? "repository-snapshot-create-failed",
      );
    }
    state = await getRepositorySetupState(assessmentId);
    if (
      !state.snapshot ||
      state.snapshot.connectionId !== input.connectionId ||
      state.snapshot.id !== snapshotResponse.payload.snapshot_id
    ) {
      throw new Error(GITHUB_INTEGRATION_ERROR_CODES.snapshotScanMismatch);
    }
  }

  // Snapshot identity, not the current branch head, is the retry boundary.
  const snapshot = state.snapshot;
  if (!snapshot)
    throw new Error(ASSESSMENT_ERROR_CODES.repositorySetupIncomplete);
  if (snapshot.sourcePathPrefix !== input.sourcePathPrefix) {
    // Web currently has no subtree selector. Never resume a scoped snapshot as if it
    // were a full-repository assessment.
    throw new Error(GITHUB_INTEGRATION_ERROR_CODES.sourcePathPrefixInvalid);
  }
  if (state.lifecycle?.state === ASSESSMENT_LIFECYCLE_STATES.PREPARING) {
    const completion = await apiValidated(
      `/api/assessments/${encodeURIComponent(assessmentId)}/repository-setup/complete`,
      completeAssessmentRepositorySetupResultSchema,
      { method: "POST" },
    );
    if (
      completion.assessment_id !== assessmentId ||
      completion.repository_connection_id !== input.connectionId ||
      completion.snapshot_id !== snapshot.id ||
      completion.commit_sha !== snapshot.commitSha
    ) {
      throw new Error(GITHUB_INTEGRATION_ERROR_CODES.snapshotScanMismatch);
    }
    state = await getRepositorySetupState(assessmentId);
    if (state.snapshot?.id !== snapshot.id) {
      throw new Error(GITHUB_INTEGRATION_ERROR_CODES.snapshotScanMismatch);
    }
  }

  if (
    state.lifecycle?.state !== ASSESSMENT_LIFECYCLE_STATES.PREPARING &&
    state.lifecycle?.state !== ASSESSMENT_LIFECYCLE_STATES.ACTIVE
  ) {
    throw new Error(ASSESSMENT_ERROR_CODES.repositorySetupStateInvalid);
  }
  // Preparation state decides whether the customer can advance; hydration jobs do not.
  return {
    snapshotId: snapshot.id,
    commitSha: snapshot.commitSha,
    lifecycleState: state.lifecycle.state,
  };
}

function isSnapshotPayload(payload: unknown): payload is SnapshotPayload {
  return (
    isRecord(payload) &&
    isString(payload.snapshot_id) &&
    isString(payload.commit_sha)
  );
}
