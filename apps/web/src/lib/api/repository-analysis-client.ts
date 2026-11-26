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
  REPOSITORY_SET_ERROR_CODES,
  assessmentRepositorySetupSchema,
  completeAssessmentRepositorySetupResultSchema,
  removeAssessmentRepositoryResultSchema,
  type AssessmentRepositorySetup,
  type AssessmentRepositorySetupEntry,
} from "@lcsp/contracts/assessment-domain";
import { apiValidated, apiRequest } from "./api-request.ts";

export type StartRepositoryAnalysisInput = {
  connectionId: string;
  branch: string;
  /** Repository-relative directory the assessment is limited to; null assesses the whole repository. */
  sourcePathPrefix: string | null;
};

export type AssessmentRepositoryConnection = NonNullable<
  AssessmentRepositorySetup["connection"]
>;

/**
 * Business purpose: Read the repositories chosen for the assessment from the setup answer, whichever API version produced it.
 * Business rules:
 * - The repository list is authoritative when present; an older API only reports the primary repository in the
 *   legacy connection, snapshot and scan-job fields, which are then read as a set of one.
 * - No connection means no repository has been chosen yet.
 * Execution flow:
 * 1. Return the repository list when it has entries.
 * 2. Otherwise wrap the legacy primary fields as a single entry, or return an empty list.
 * Failure cases:
 * - None; the setup answer was already validated by the shared contract.
 * Side effects:
 * - None; pure projection of the answer.
 */
export function repositorySetupEntries(
  state: AssessmentRepositorySetup,
): AssessmentRepositorySetupEntry[] {
  if (state.repositories.length > 0) return state.repositories;
  return state.connection
    ? [
        {
          repositoryKey: null,
          connection: state.connection,
          snapshot: state.snapshot,
          scanJob: state.scanJob,
        },
      ]
    : [];
}

/**
 * Business purpose: Attach one more repository to the assessment being set up, or explicitly reauthorize one the
 * customer already attached, without ever switching or duplicating a saved repository.
 * Business rules:
 * - Connecting the same repository again returns the saved connection (it also recovers a lost response).
 * - A different repository is added as another connection until the server's repository limit is reached.
 * - Reconnection bypasses only that idempotent shortcut and stays subject to backend ownership and credential checks.
 * Execution flow:
 * 1. Reload the saved setup; for an ordinary retry return the matching saved connection when there is one.
 * 2. Refuse when the limit is already reached, otherwise create or reauthorize the connection through the API.
 * Failure cases:
 * - Reaching the limit, a disabled provider, failed authorization or any API problem rejects with the problem code
 *   and leaves saved state untouched.
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
  const entries = repositorySetupEntries(state);
  if (!forceReauthorization) {
    const saved = entries.find((entry) =>
      isSameRepository(entry.connection, repositoryUrl),
    );
    if (saved) return saved.connection;
    const savedConnections = new Set(
      entries.map((entry) => entry.connection.connectionId),
    );
    if (savedConnections.size >= state.repositoryLimit) {
      throw new Error(REPOSITORY_SET_ERROR_CODES.limitExceeded);
    }
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
 * Business purpose: Recognise a repository the customer already attached, so typing it again reuses the saved
 * connection instead of creating a duplicate.
 * Business rules:
 * - Every supported provider is comparable; the URL must parse with that provider's shared parser, so lookalike or
 *   malformed URLs never match. GitHub names ignore letter case, the other providers do not.
 * Execution flow:
 * 1. Try the supported host parsers in fixed order.
 * 2. Compare provider and parsed full name with the saved connection.
 * Failure cases:
 * - An unparseable URL or a different provider returns false and the caller treats it as a new repository.
 * Side effects:
 * - None; pure comparison with no network access or persistence.
 */
function isSameRepository(
  connection: AssessmentRepositoryConnection,
  repositoryUrl: string,
): boolean {
  const parsed = parseRepositoryUrl(repositoryUrl);
  if (!parsed || parsed.provider !== connection.provider) return false;
  return connection.provider === CREDENTIAL_PROVIDERS.github
    ? parsed.locator.repositoryFullName.toLowerCase() ===
        connection.repositoryFullName.toLowerCase()
    : parsed.locator.repositoryFullName === connection.repositoryFullName;
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

/**
 * Business purpose: Start (or safely resume) analysis of every repository chosen for an assessment, once per distinct choice.
 * Business rules:
 * - Concurrent submissions of the same repositories and scopes share one operation, so double clicks never pin twice.
 * - The server stays the authority on snapshot and scan idempotency.
 * Execution flow:
 * 1. Derive a key from the assessment, each connection and its source scope.
 * 2. Return the in-flight operation when there is one, otherwise run the resume and forget it when it settles.
 * Failure cases:
 * - Rejections of the shared operation reach every waiting caller; the key is released so a later retry can run.
 * Side effects:
 * - Keeps a short-lived in-memory map of pending operations; the operation itself may write through the API.
 */
export function startRepositoryAnalysis(
  assessmentId: string,
  inputs: readonly StartRepositoryAnalysisInput[],
): Promise<StartRepositoryAnalysisResult> {
  const key = `${assessmentId}:${inputs
    .map((input) => `${input.connectionId}|${input.sourcePathPrefix ?? ""}`)
    .join(",")}`;
  const pending = pendingAnalyses.get(key);
  if (pending) return pending;
  const request = resumeRepositoryAnalysis(assessmentId, inputs).finally(() => {
    pendingAnalyses.delete(key);
  });
  pendingAnalyses.set(key, request);
  return request;
}

/**
 * Business purpose: Let the customer drop a repository that is still only a candidate, before the set is pinned.
 * Business rules:
 * - Only the dedicated removal endpoint may delete a candidate; setup recovery never deletes a saved assessment.
 * - The server rejects removal once the repository set is pinned.
 * Execution flow:
 * 1. Call the removal endpoint for the snapshot.
 * 2. Validate the answer against the shared contract.
 * Failure cases:
 * - API problems and answers that do not match the contract reject; nothing is retried here.
 * Side effects:
 * - Deletes one candidate snapshot, and revokes its connection when it was the connection last snapshot, through the API.
 */
export function removeAssessmentRepository(
  assessmentId: string,
  snapshotId: string,
) {
  return apiValidated(
    `/api/assessments/${encodeURIComponent(assessmentId)}/repository-setup/repositories/${encodeURIComponent(snapshotId)}`,
    removeAssessmentRepositoryResultSchema,
    { method: "DELETE" },
  );
}

/**
 * Business purpose: Resume or complete the Web repository setup for every repository the customer chose, from the
 * server's authoritative checkpoint.
 * Business rules:
 * - A saved snapshot is reused only when it was taken from the same connection with the same source scope; a
 *   scoped snapshot is never resumed as a whole-repository one.
 * - Every chosen repository is pinned (once) before setup is completed, and completion names the exact snapshots.
 * - A validated completion reports PREPARING while legal inputs are unavailable; only ACTIVE permits advancing.
 * - ACTIVE checkpoints can be resumed without creating a snapshot or repeating completion. Other lifecycle states fail closed.
 * Execution flow:
 * 1. Reload setup state and verify every connection and the eligible lifecycle.
 * 2. Pin a snapshot for each repository that has none, then validate that all of them are persisted.
 * 3. Complete setup with the exact snapshot list, validate the answer, and return the primary repository's pin and lifecycle.
 * Failure cases:
 * - Missing connection, no repository, invalid lifecycle or mismatched persisted identities fail before further mutation.
 * Side effects:
 * - May create one snapshot per repository without one and complete repository setup through the API; retries reconcile persisted state.
 */
async function resumeRepositoryAnalysis(
  assessmentId: string,
  inputs: readonly StartRepositoryAnalysisInput[],
): Promise<StartRepositoryAnalysisResult> {
  if (inputs.length === 0) {
    throw new Error(ASSESSMENT_ERROR_CODES.repositorySetupIncomplete);
  }
  let state = await getRepositorySetupState(assessmentId);
  const saved = repositorySetupEntries(state);
  if (
    inputs.some(
      (input) =>
        !saved.some((entry) => entry.connection.connectionId === input.connectionId),
    )
  ) {
    throw new Error(GITHUB_INTEGRATION_ERROR_CODES.connectionNotFound);
  }
  if (
    state.lifecycle?.state !== ASSESSMENT_LIFECYCLE_STATES.PREPARING &&
    state.lifecycle?.state !== ASSESSMENT_LIFECYCLE_STATES.ACTIVE
  ) {
    throw new Error(ASSESSMENT_ERROR_CODES.repositorySetupStateInvalid);
  }

  const snapshotIds: string[] = [];
  for (const input of inputs) {
    const existing = repositorySetupEntries(state).find(
      (entry) =>
        entry.connection.connectionId === input.connectionId &&
        entry.snapshot !== null &&
        entry.snapshot.sourcePathPrefix === input.sourcePathPrefix,
    );
    if (existing?.snapshot) {
      snapshotIds.push(existing.snapshot.id);
      continue;
    }
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
    const createdSnapshotId = snapshotResponse.payload.snapshot_id;
    snapshotIds.push(createdSnapshotId);
    // Re-read after every write so the next repository is judged against persisted state.
    state = await getRepositorySetupState(assessmentId);
    if (
      !repositorySetupEntries(state).some(
        (entry) =>
          entry.connection.connectionId === input.connectionId &&
          entry.snapshot?.id === createdSnapshotId,
      )
    ) {
      throw new Error(GITHUB_INTEGRATION_ERROR_CODES.snapshotScanMismatch);
    }
  }

  // Snapshot identity, not the current branch head, is the retry boundary.
  const primary = findSnapshot(state, snapshotIds[0]!);
  if (!primary) throw new Error(ASSESSMENT_ERROR_CODES.repositorySetupIncomplete);

  if (state.lifecycle?.state === ASSESSMENT_LIFECYCLE_STATES.PREPARING) {
    const completion = await apiValidated(
      `/api/assessments/${encodeURIComponent(assessmentId)}/repository-setup/complete`,
      completeAssessmentRepositorySetupResultSchema,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ snapshotIds }),
      },
    );
    const completedIds = completion.repositories.map((pin) => pin.snapshot_id);
    if (
      completion.assessment_id !== assessmentId ||
      completion.repository_connection_id !== primary.connectionId ||
      completion.snapshot_id !== primary.id ||
      completion.commit_sha !== primary.commitSha ||
      (completedIds.length > 0 &&
        (completedIds.length !== snapshotIds.length ||
          completedIds.some((id, index) => id !== snapshotIds[index])))
    ) {
      throw new Error(GITHUB_INTEGRATION_ERROR_CODES.snapshotScanMismatch);
    }
    state = await getRepositorySetupState(assessmentId);
    if (snapshotIds.some((id) => findSnapshot(state, id) === null)) {
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
    snapshotId: primary.id,
    commitSha: primary.commitSha,
    lifecycleState: state.lifecycle.state,
  };
}

/**
 * Business purpose: Find a saved snapshot by identity so completion is validated against what the server persisted.
 * Business rules:
 * - Identity is the snapshot id only; the current branch head is never consulted.
 * Execution flow:
 * 1. Search the chosen repositories for the snapshot id.
 * 2. Return the snapshot or null.
 * Failure cases:
 * - Returns null for an unknown id; callers treat that as a mismatch between request and persisted state.
 * Side effects:
 * - None; pure lookup.
 */
function findSnapshot(state: AssessmentRepositorySetup, id: string) {
  return (
    repositorySetupEntries(state).find((entry) => entry.snapshot?.id === id)
      ?.snapshot ?? null
  );
}

function isSnapshotPayload(payload: unknown): payload is SnapshotPayload {
  return (
    isRecord(payload) &&
    isString(payload.snapshot_id) &&
    isString(payload.commit_sha)
  );
}
