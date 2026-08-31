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
  if (typeof payload !== "object" || payload === null) return false;
  const value = payload as Record<string, unknown>;
  return (
    typeof value.connectionId === "string" &&
    typeof value.provider === "string" &&
    typeof value.repositoryId === "string" &&
    typeof value.repositoryFullName === "string" &&
    typeof value.defaultBranch === "string" &&
    typeof value.status === "string"
  );
}

export type StartRepositoryAnalysisResult = {
  snapshotId: string;
  commitSha: string;
  scanJobId: string;
  scanStatus: string;
};

type SnapshotPayload = {
  snapshot_id?: unknown;
  commit_sha?: unknown;
};

type ScanPayload = {
  scan_job_id?: unknown;
  status?: unknown;
};

export type RerunRepositoryScanInput = {
  snapshotId: string;
};

export type RerunRepositoryScanResult = {
  scanJobId: string;
  scanStatus: string;
};

export async function startRepositoryAnalysis(
  assessmentId: string,
  input: StartRepositoryAnalysisInput,
): Promise<StartRepositoryAnalysisResult> {
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

  const snapshotId = snapshotResponse.payload.snapshot_id;
  const scanResponse = await apiRequest(
    `/api/assessments/${encodeURIComponent(assessmentId)}/scan-jobs`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        snapshot_id: snapshotId,
        idempotency_key: buildSnapshotScanIdempotencyKey(
          assessmentId,
          snapshotId,
        ),
      }),
    },
  );

  if (!scanResponse.ok || !isScanPayload(scanResponse.payload)) {
    throw new Error(scanResponse.problemCode ?? "repository-scan-start-failed");
  }

  return {
    snapshotId,
    commitSha: snapshotResponse.payload.commit_sha,
    scanJobId: scanResponse.payload.scan_job_id,
    scanStatus: scanResponse.payload.status,
  };
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

function isSnapshotPayload(payload: unknown): payload is {
  snapshot_id: string;
  commit_sha: string;
} {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const value = payload as SnapshotPayload;
  return (
    typeof value.snapshot_id === "string" &&
    typeof value.commit_sha === "string"
  );
}

function isScanPayload(payload: unknown): payload is {
  scan_job_id: string;
  status: string;
} {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const value = payload as ScanPayload;
  return (
    typeof value.scan_job_id === "string" && typeof value.status === "string"
  );
}

function buildSnapshotScanIdempotencyKey(
  assessmentId: string,
  snapshotId: string,
): string {
  return ["snapshot-auto", assessmentId, snapshotId].join(":");
}
