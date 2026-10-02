import {
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_REPOSITORY_RELATION_TYPES,
  ASSESSMENT_STATUS_CODES,
  type AssessmentRepositoryRelationType,
  isAssessmentRepositorySetupState,
  type AssessmentRepositorySetupState,
} from "@lcsp/contracts/assessment";
import {
  CREDENTIAL_PROVIDERS,
  GITHUB_INTEGRATION_ERROR_CODES,
  parseGitHubRepositoryUrl,
  parseGitLabRepositoryUrl,
} from "@lcsp/contracts/github-integration";

import { isRecord, isString } from "@lcsp/contracts/shared";

import { apiRequest } from "./api-request.ts";

export type StartRepositoryAnalysisInput = {
  connectionId: string;
  branch: string;
};

export type AssessmentRepositoryConnection = {
  connectionId: string;
  provider: string;
  repositoryId: string;
  repositoryFullName: string;
  defaultBranch: string;
  status: string;
};

export async function saveAssessmentRepositoryRelation(
  assessmentId: string,
  input: {
    relationId?: string;
    fromSnapshotId: string;
    toSnapshotId: string;
    type: AssessmentRepositoryRelationType;
  },
) {
  if (
    input.fromSnapshotId === input.toSnapshotId ||
    !Object.values(ASSESSMENT_REPOSITORY_RELATION_TYPES).includes(input.type)
  )
    throw new Error(ASSESSMENT_ERROR_CODES.repositorySetupIncomplete);
  const path = input.relationId
    ? `/api/assessments/${encodeURIComponent(assessmentId)}/repository-relations/${encodeURIComponent(input.relationId)}`
    : `/api/assessments/${encodeURIComponent(assessmentId)}/repository-relations`;
  const response = await apiRequest(path, {
    method: input.relationId ? "PATCH" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      from_snapshot_id: input.fromSnapshotId,
      to_snapshot_id: input.toSnapshotId,
      type: input.type,
    }),
  });
  if (!response.ok)
    throw new Error(response.problemCode ?? "repository-relation-failed");
}

export async function removeAssessmentRepositoryRelation(
  assessmentId: string,
  relationId: string,
) {
  const response = await apiRequest(
    `/api/assessments/${encodeURIComponent(assessmentId)}/repository-relations/${encodeURIComponent(relationId)}`,
    { method: "DELETE" },
  );
  if (!response.ok)
    throw new Error(
      response.problemCode ?? "repository-relation-remove-failed",
    );
}

export async function removeAssessmentRepository(
  assessmentId: string,
  connectionId: string,
) {
  const response = await apiRequest(
    `/api/assessments/${encodeURIComponent(assessmentId)}/repositories/${encodeURIComponent(connectionId)}`,
    { method: "DELETE" },
  );
  if (!response.ok)
    throw new Error(
      response.problemCode ?? "assessment-repository-remove-failed",
    );
}

export async function connectAssessmentRepository(
  assessmentId: string,
  repositoryUrl: string,
): Promise<AssessmentRepositoryConnection> {
  // A previous request may have committed even when its response was lost.
  const state = await getRepositorySetupState(assessmentId);
  const connections =
    state.repositories ??
    (state.connection
      ? [
          {
            ...state.connection,
            snapshot: state.snapshot,
            scanJob: state.scanJob,
          },
        ]
      : []);
  for (const connection of connections) {
    const locator =
      connection.provider === CREDENTIAL_PROVIDERS.github
        ? parseGitHubRepositoryUrl(repositoryUrl)
        : connection.provider === CREDENTIAL_PROVIDERS.gitlab
          ? parseGitLabRepositoryUrl(repositoryUrl)
          : null;
    const sameRepository =
      locator &&
      (connection.provider === CREDENTIAL_PROVIDERS.github
        ? locator.repositoryFullName.toLowerCase() ===
          connection.repositoryFullName.toLowerCase()
        : locator.repositoryFullName === connection.repositoryFullName);
    if (sameRepository) return connection;
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

function isAssessmentConnection(
  payload: unknown,
): payload is AssessmentRepositoryConnection {
  return (
    isRecord(payload) &&
    isString(payload.connectionId) &&
    isString(payload.provider) &&
    isString(payload.repositoryId) &&
    isString(payload.repositoryFullName) &&
    isString(payload.defaultBranch) &&
    isString(payload.status)
  );
}

export type StartRepositoryAnalysisResult = {
  snapshotId: string;
  commitSha: string;
  scanJobId: string;
  scanStatus: string;
};

export async function pinRepositorySnapshot(
  assessmentId: string,
  input: StartRepositoryAnalysisInput,
) {
  const response = await apiRequest(
    `/api/assessments/${encodeURIComponent(assessmentId)}/snapshots`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        connection_id: input.connectionId,
        branch: input.branch,
      }),
    },
  );
  if (!response.ok || !isSnapshotPayload(response.payload))
    throw new Error(
      response.problemCode ?? "repository-snapshot-create-failed",
    );
  return response.payload;
}

type SnapshotPayload = {
  snapshot_id: string;
  commit_sha: string;
};

type ScanPayload = {
  scan_job_id: string;
  status: string;
};

type RepositorySetupPayload = {
  assessment_id: string;
  repository_connection_id: string;
  snapshot_id: string;
  commit_sha: string;
};

export type RerunRepositoryScanInput = {
  snapshotId: string;
};

export type RerunRepositoryScanResult = {
  scanJobId: string;
  scanStatus: string;
};

/** Fetch an authoritative checkpoint; never infer success from a stale UI cache. */
export async function getRepositorySetupState(
  assessmentId: string,
): Promise<AssessmentRepositorySetupState> {
  const response = await apiRequest(
    `/api/assessments/${encodeURIComponent(assessmentId)}/readiness`,
    { cache: "no-store" },
  );
  const payload = response.payload;
  const state =
    typeof payload === "object" && payload !== null
      ? (payload as { repository_setup?: unknown }).repository_setup
      : undefined;
  if (!response.ok) {
    throw new Error(
      response.problemCode ?? ASSESSMENT_ERROR_CODES.repositorySetupIncomplete,
    );
  }
  if (
    !isAssessmentRepositorySetupState(state) ||
    state.assessmentId !== assessmentId
  ) {
    throw new Error(ASSESSMENT_ERROR_CODES.repositorySetupIncomplete);
  }
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

/** Confirms the assessment scope and starts one idempotent scan per pinned repository. */
export async function startAssessmentRepositoryAnalysis(
  assessmentId: string,
): Promise<StartRepositoryAnalysisResult[]> {
  const state = await getRepositorySetupState(assessmentId);
  const repositories =
    state.repositories ??
    (state.connection
      ? [
          {
            ...state.connection,
            snapshot: state.snapshot,
            scanJob: state.scanJob,
          },
        ]
      : []);
  if (repositories.length === 0)
    throw new Error(ASSESSMENT_ERROR_CODES.repositorySetupIncomplete);
  const results: StartRepositoryAnalysisResult[] = [];
  for (const repository of repositories) {
    if (!repository.snapshot)
      throw new Error(ASSESSMENT_ERROR_CODES.repositorySetupIncomplete);
    results.push(
      await resumeRepositoryAnalysis(assessmentId, {
        connectionId: repository.connectionId,
        branch: repository.snapshot.branch ?? repository.defaultBranch,
      }),
    );
  }
  return results;
}

async function resumeRepositoryAnalysis(
  assessmentId: string,
  input: StartRepositoryAnalysisInput,
): Promise<StartRepositoryAnalysisResult> {
  let state = await getRepositorySetupState(assessmentId);
  const selectedRepository = () =>
    state.repositories?.find(
      (repository) => repository.connectionId === input.connectionId,
    ) ??
    (state.connection?.connectionId === input.connectionId
      ? {
          ...state.connection,
          snapshot: state.snapshot,
          scanJob: state.scanJob,
        }
      : null);
  let repository = selectedRepository();
  if (!repository) {
    throw new Error(GITHUB_INTEGRATION_ERROR_CODES.connectionNotFound);
  }

  if (!repository.snapshot) {
    if (
      state.assessmentStatus !== ASSESSMENT_STATUS_CODES.wizardInProgress &&
      state.assessmentStatus !== ASSESSMENT_STATUS_CODES.wizardSubmitted
    ) {
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
        }),
      },
    );
    if (!snapshotResponse.ok || !isSnapshotPayload(snapshotResponse.payload)) {
      throw new Error(
        snapshotResponse.problemCode ?? "repository-snapshot-create-failed",
      );
    }
    state = await getRepositorySetupState(assessmentId);
    repository = selectedRepository();
    if (
      !repository?.snapshot ||
      repository.snapshot.id !== snapshotResponse.payload.snapshot_id
    ) {
      throw new Error(GITHUB_INTEGRATION_ERROR_CODES.snapshotScanMismatch);
    }
  }

  // Snapshot identity, not the current branch head, is the retry boundary.
  repository = selectedRepository();
  const snapshot = repository?.snapshot;
  if (!snapshot)
    throw new Error(ASSESSMENT_ERROR_CODES.repositorySetupIncomplete);
  if (state.assessmentStatus === ASSESSMENT_STATUS_CODES.wizardInProgress) {
    const completion = await apiRequest(
      `/api/assessments/${encodeURIComponent(assessmentId)}/repository-setup/complete`,
      { method: "POST" },
    );
    if (!completion.ok || !isRepositorySetupPayload(completion.payload)) {
      throw new Error(
        completion.problemCode ?? "repository-setup-complete-failed",
      );
    }
    if (completion.payload.assessment_id !== assessmentId) {
      throw new Error(GITHUB_INTEGRATION_ERROR_CODES.snapshotScanMismatch);
    }
    if (
      completion.payload.snapshot_id !== snapshot.id ||
      completion.payload.commit_sha !== snapshot.commitSha
    ) {
      throw new Error(GITHUB_INTEGRATION_ERROR_CODES.snapshotScanMismatch);
    }
    state = await getRepositorySetupState(assessmentId);
    repository = selectedRepository();
    if (repository?.snapshot?.id !== snapshot.id) {
      throw new Error(GITHUB_INTEGRATION_ERROR_CODES.snapshotScanMismatch);
    }
  }

  // Also reconcile a scan request whose success response was lost. Failed jobs
  // are displayed as failed; only the explicit rerun action creates another run.
  repository = selectedRepository();
  if (repository?.scanJob) {
    return {
      snapshotId: snapshot.id,
      commitSha: snapshot.commitSha,
      scanJobId: repository.scanJob.id,
      scanStatus: repository.scanJob.status,
    };
  }
  if (state.assessmentStatus !== ASSESSMENT_STATUS_CODES.wizardSubmitted) {
    throw new Error(ASSESSMENT_ERROR_CODES.repositorySetupStateInvalid);
  }
  const scanResponse = await apiRequest(
    `/api/assessments/${encodeURIComponent(assessmentId)}/scan-jobs`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        snapshot_id: snapshot.id,
        idempotency_key: buildSnapshotScanIdempotencyKey(
          assessmentId,
          snapshot.id,
        ),
      }),
    },
  );
  if (!scanResponse.ok || !isScanPayload(scanResponse.payload)) {
    throw new Error(scanResponse.problemCode ?? "repository-scan-start-failed");
  }
  return {
    snapshotId: snapshot.id,
    commitSha: snapshot.commitSha,
    scanJobId: scanResponse.payload.scan_job_id,
    scanStatus: scanResponse.payload.status,
  };
}

function isRepositorySetupPayload(
  payload: unknown,
): payload is RepositorySetupPayload {
  return (
    isRecord(payload) &&
    isString(payload.assessment_id) &&
    isString(payload.repository_connection_id) &&
    isString(payload.snapshot_id) &&
    isString(payload.commit_sha)
  );
}

export async function rerunRepositoryScan(
  assessmentId: string,
  input: RerunRepositoryScanInput,
): Promise<RerunRepositoryScanResult> {
  const response = await apiRequest(
    `/api/assessments/${encodeURIComponent(assessmentId)}/scan-jobs/rerun`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        snapshot_id: input.snapshotId,
        idempotency_key: crypto.randomUUID(),
      }),
    },
  );

  if (!response.ok || !isScanPayload(response.payload)) {
    throw new Error(response.problemCode ?? "repository-scan-rerun-failed");
  }

  return {
    scanJobId: response.payload.scan_job_id,
    scanStatus: response.payload.status,
  };
}

function isSnapshotPayload(payload: unknown): payload is SnapshotPayload {
  return (
    isRecord(payload) &&
    isString(payload.snapshot_id) &&
    isString(payload.commit_sha)
  );
}

function isScanPayload(payload: unknown): payload is ScanPayload {
  return (
    isRecord(payload) &&
    isString(payload.scan_job_id) &&
    isString(payload.status)
  );
}

function buildSnapshotScanIdempotencyKey(
  assessmentId: string,
  snapshotId: string,
): string {
  return ["snapshot-auto", assessmentId, snapshotId].join(":");
}
