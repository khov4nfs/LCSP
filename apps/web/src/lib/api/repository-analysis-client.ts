import {
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_STATUS_CODES,
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

export async function connectAssessmentRepository(
  assessmentId: string,
  repositoryUrl: string,
): Promise<AssessmentRepositoryConnection> {
  // A previous request may have committed even when its response was lost.
  const state = await getRepositorySetupState(assessmentId);
  if (state.connection && (state.connection.provider === CREDENTIAL_PROVIDERS.github || state.connection.provider === CREDENTIAL_PROVIDERS.gitlab)) {
    const locator = state.connection.provider === CREDENTIAL_PROVIDERS.github
      ? parseGitHubRepositoryUrl(repositoryUrl)
      : state.connection.provider === CREDENTIAL_PROVIDERS.gitlab
        ? parseGitLabRepositoryUrl(repositoryUrl)
        : null;
    const sameRepository = locator && (
      state.connection.provider === CREDENTIAL_PROVIDERS.github
        ? locator.repositoryFullName.toLowerCase() === state.connection.repositoryFullName.toLowerCase()
        : locator.repositoryFullName === state.connection.repositoryFullName
    );
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
  const state = typeof payload === "object" && payload !== null
    ? (payload as { repository_setup?: unknown }).repository_setup
    : undefined;
  if (!response.ok) {
    throw new Error(response.problemCode ?? ASSESSMENT_ERROR_CODES.repositorySetupIncomplete);
  }
  if (!isAssessmentRepositorySetupState(state) || state.assessmentId !== assessmentId) {
    throw new Error(ASSESSMENT_ERROR_CODES.repositorySetupIncomplete);
  }
  return state;
}

// Coalesce repeated submissions in this client. Server scan idempotency remains authoritative.
const pendingAnalyses = new Map<string, Promise<StartRepositoryAnalysisResult>>();

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

async function resumeRepositoryAnalysis(
  assessmentId: string,
  input: StartRepositoryAnalysisInput,
): Promise<StartRepositoryAnalysisResult> {
  let state = await getRepositorySetupState(assessmentId);
  if (!state.connection || state.connection.connectionId !== input.connectionId) {
    throw new Error(GITHUB_INTEGRATION_ERROR_CODES.connectionNotFound);
  }

  if (!state.snapshot) {
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
        body: JSON.stringify({ connection_id: input.connectionId, branch: input.branch }),
      },
    );
    if (!snapshotResponse.ok || !isSnapshotPayload(snapshotResponse.payload)) {
      throw new Error(snapshotResponse.problemCode ?? "repository-snapshot-create-failed");
    }
    state = await getRepositorySetupState(assessmentId);
    if (
      !state.snapshot || state.snapshot.connectionId !== input.connectionId ||
      state.snapshot.id !== snapshotResponse.payload.snapshot_id
    ) {
      throw new Error(GITHUB_INTEGRATION_ERROR_CODES.snapshotScanMismatch);
    }
  }

  // Snapshot identity, not the current branch head, is the retry boundary.
  const snapshot = state.snapshot;
  if (!snapshot) throw new Error(ASSESSMENT_ERROR_CODES.repositorySetupIncomplete);
  if (state.assessmentStatus === ASSESSMENT_STATUS_CODES.wizardInProgress) {
    const completion = await apiRequest(
      `/api/assessments/${encodeURIComponent(assessmentId)}/repository-setup/complete`,
      { method: "POST" },
    );
    if (!completion.ok || !isRepositorySetupPayload(completion.payload)) {
      throw new Error(completion.problemCode ?? "repository-setup-complete-failed");
    }
    if (
      completion.payload.assessment_id !== assessmentId ||
      completion.payload.repository_connection_id !== input.connectionId ||
      completion.payload.snapshot_id !== snapshot.id ||
      completion.payload.commit_sha !== snapshot.commitSha
    ) {
      throw new Error(GITHUB_INTEGRATION_ERROR_CODES.snapshotScanMismatch);
    }
    state = await getRepositorySetupState(assessmentId);
    if (state.snapshot?.id !== snapshot.id) {
      throw new Error(GITHUB_INTEGRATION_ERROR_CODES.snapshotScanMismatch);
    }
  }

  // Also reconcile a scan request whose success response was lost. Failed jobs
  // are displayed as failed; only the explicit rerun action creates another run.
  if (state.scanJob) {
    return {
      snapshotId: snapshot.id, commitSha: snapshot.commitSha,
      scanJobId: state.scanJob.id, scanStatus: state.scanJob.status,
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
        idempotency_key: buildSnapshotScanIdempotencyKey(assessmentId, snapshot.id),
      }),
    },
  );
  if (!scanResponse.ok || !isScanPayload(scanResponse.payload)) {
    throw new Error(scanResponse.problemCode ?? "repository-scan-start-failed");
  }
  return {
    snapshotId: snapshot.id, commitSha: snapshot.commitSha,
    scanJobId: scanResponse.payload.scan_job_id, scanStatus: scanResponse.payload.status,
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
