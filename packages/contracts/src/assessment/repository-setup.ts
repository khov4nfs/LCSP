import {
  REPOSITORY_CONNECTION_STATUSES,
  REPOSITORY_SCAN_JOB_STATUSES,
  type RepositoryScanJobStatus,
} from "../github-integration/statuses.ts";
import { ASSESSMENT_STATUS_CODES } from "./statuses.ts";

/** Persisted setup checkpoints. A GET of this state must never start work. */
export type AssessmentRepositorySetupState = {
  assessmentId: string;
  assessmentStatus: (typeof ASSESSMENT_STATUS_CODES)[keyof typeof ASSESSMENT_STATUS_CODES];
  connection: {
    connectionId: string;
    provider: string;
    repositoryId: string;
    repositoryFullName: string;
    defaultBranch: string;
    status: string;
  } | null;
  snapshot: {
    id: string;
    assessmentId: string;
    connectionId: string;
    provider: string;
    repositoryFullName: string;
    branch: string | null;
    commitSha: string;
    createdAt: string;
  } | null;
  scanJob: {
    id: string;
    assessmentId: string;
    snapshotId: string;
    status: RepositoryScanJobStatus;
    attemptCount: number;
    blockedReason: string | null;
    updatedAt: string;
  } | null;
};

/** Fail closed on absent/malformed/mismatched server state before retrying writes. */
export function isAssessmentRepositorySetupState(
  value: unknown,
): value is AssessmentRepositorySetupState {
  if (!isRecord(value) || !nonempty(value.assessmentId)) return false;
  if (!Object.values(ASSESSMENT_STATUS_CODES).some((status) => status === value.assessmentStatus)) {
    return false;
  }
  const connection = value.connection;
  if (connection !== null && (
    !isRecord(connection) ||
    !nonempty(connection.connectionId) || !nonempty(connection.provider) ||
    !nonempty(connection.repositoryId) || !nonempty(connection.repositoryFullName) ||
    !nonempty(connection.defaultBranch) ||
    connection.status !== REPOSITORY_CONNECTION_STATUSES.active
  )) return false;

  const snapshot = value.snapshot;
  if (snapshot !== null && (
    !isRecord(snapshot) || !isRecord(connection) ||
    !nonempty(snapshot.id) || snapshot.assessmentId !== value.assessmentId ||
    snapshot.connectionId !== connection.connectionId ||
    snapshot.repositoryFullName !== connection.repositoryFullName ||
    snapshot.provider !== connection.provider ||
    !(typeof snapshot.branch === "string" || snapshot.branch === null) ||
    typeof snapshot.commitSha !== "string" || !/^[0-9a-f]{40}$/iu.test(snapshot.commitSha) ||
    !nonempty(snapshot.createdAt)
  )) return false;

  const job = value.scanJob;
  if (job !== null && (
    !isRecord(job) || !isRecord(snapshot) ||
    !nonempty(job.id) || job.assessmentId !== value.assessmentId ||
    job.snapshotId !== snapshot.id ||
    !Object.values(REPOSITORY_SCAN_JOB_STATUSES).some((status) => status === job.status) ||
    typeof job.attemptCount !== "number" || !Number.isInteger(job.attemptCount) || job.attemptCount < 0 ||
    !(typeof job.blockedReason === "string" || job.blockedReason === null) ||
    !nonempty(job.updatedAt)
  )) return false;
  return true;
}

export function needsRepositorySetupResume(state: AssessmentRepositorySetupState): boolean {
  return !state.connection || !state.snapshot ||
    state.assessmentStatus === ASSESSMENT_STATUS_CODES.wizardInProgress || !state.scanJob;
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
