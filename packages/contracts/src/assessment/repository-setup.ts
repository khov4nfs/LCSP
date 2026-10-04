import {
  REPOSITORY_CONNECTION_STATUSES,
  REPOSITORY_SCAN_JOB_STATUSES,
  type RepositoryScanJobStatus,
} from "../github-integration/statuses.ts";
import { ASSESSMENT_STATUS_CODES } from "./statuses.ts";
import {
  ASSESSMENT_REPOSITORY_RELATION_TYPES,
  type AssessmentRepositoryRelationType,
  ASSESSMENT_GRAPH_STATES,
  ASSESSMENT_SETUP_CONFIRMATION_STATUSES,
  type AssessmentGraphState,
  type AssessmentSetupConfirmationStatus,
} from "./flow.ts";

export type AssessmentRepositorySetupRepository = {
  connectionId: string;
  provider: string;
  repositoryId: string;
  repositoryFullName: string;
  defaultBranch: string;
  status: string;
  snapshot: {
    id: string;
    branch: string | null;
    commitSha: string;
    createdAt: string;
  } | null;
  scanJob: {
    id: string;
    status: RepositoryScanJobStatus;
    attemptCount: number;
    blockedReason: string | null;
    updatedAt: string;
  } | null;
};

export type AssessmentRepositoryRelation = {
  id: string;
  fromSnapshotId: string;
  toSnapshotId: string;
  type: AssessmentRepositoryRelationType;
};

/** Persisted setup checkpoints. A GET of this state must never start work. */
export type AssessmentRepositorySetupState = {
  assessmentId: string;
  /** Optional only for compatibility with checkpoints written before versioning. */
  setupVersion?: number;
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
  /** Aggregate fields are authoritative for multi-repository clients. Singular
   * fields above remain a compatibility projection of the newest repository. */
  repositories?: AssessmentRepositorySetupRepository[];
  relations?: AssessmentRepositoryRelation[];
  confirmed?: boolean;
  providerCapabilities?: Array<{
    provider: string;
    canConnect: boolean;
    canPinSnapshot: boolean;
  }>;
  confirmation?: {
    status: AssessmentSetupConfirmationStatus;
    confirmedAt: string | null;
  };
  scanProgress?: {
    total: number;
    completed: number;
    failed: number;
    pending: number;
  };
  relationAggregate?: {
    count: number;
    independent: boolean;
  };
  programEvidenceGraph?: {
    state: AssessmentGraphState;
    reportCount: number;
  };
};

/** Fail closed on absent/malformed/mismatched server state before retrying writes. */
export function isAssessmentRepositorySetupState(
  value: unknown,
): value is AssessmentRepositorySetupState {
  if (
    !isRecord(value) ||
    !nonempty(value.assessmentId) ||
    (value.setupVersion !== undefined &&
      (typeof value.setupVersion !== "number" ||
        !Number.isInteger(value.setupVersion) ||
        value.setupVersion < 0))
  )
    return false;
  if (
    !Object.values(ASSESSMENT_STATUS_CODES).some(
      (status) => status === value.assessmentStatus,
    )
  ) {
    return false;
  }
  const connection = value.connection;
  if (
    connection !== null &&
    (!isRecord(connection) ||
      !nonempty(connection.connectionId) ||
      !nonempty(connection.provider) ||
      !nonempty(connection.repositoryId) ||
      !nonempty(connection.repositoryFullName) ||
      !nonempty(connection.defaultBranch) ||
      connection.status !== REPOSITORY_CONNECTION_STATUSES.active)
  )
    return false;

  const snapshot = value.snapshot;
  if (
    snapshot !== null &&
    (!isRecord(snapshot) ||
      !isRecord(connection) ||
      !nonempty(snapshot.id) ||
      snapshot.assessmentId !== value.assessmentId ||
      snapshot.connectionId !== connection.connectionId ||
      snapshot.repositoryFullName !== connection.repositoryFullName ||
      snapshot.provider !== connection.provider ||
      !(typeof snapshot.branch === "string" || snapshot.branch === null) ||
      typeof snapshot.commitSha !== "string" ||
      !/^[0-9a-f]{40}$/iu.test(snapshot.commitSha) ||
      !nonempty(snapshot.createdAt))
  )
    return false;

  const job = value.scanJob;
  if (
    job !== null &&
    (!isRecord(job) ||
      !isRecord(snapshot) ||
      !nonempty(job.id) ||
      job.assessmentId !== value.assessmentId ||
      job.snapshotId !== snapshot.id ||
      !Object.values(REPOSITORY_SCAN_JOB_STATUSES).some(
        (status) => status === job.status,
      ) ||
      typeof job.attemptCount !== "number" ||
      !Number.isInteger(job.attemptCount) ||
      job.attemptCount < 0 ||
      !(typeof job.blockedReason === "string" || job.blockedReason === null) ||
      !nonempty(job.updatedAt))
  )
    return false;
  if (
    value.repositories !== undefined &&
    (!Array.isArray(value.repositories) ||
      !value.repositories.every(isRepository))
  )
    return false;
  if (
    value.relations !== undefined &&
    (!Array.isArray(value.relations) || !value.relations.every(isRelation))
  )
    return false;
  if (value.confirmed !== undefined && typeof value.confirmed !== "boolean")
    return false;
  if (
    value.providerCapabilities !== undefined &&
    !Array.isArray(value.providerCapabilities)
  )
    return false;
  if (
    value.confirmation !== undefined &&
    (!isRecord(value.confirmation) ||
      !Object.values(ASSESSMENT_SETUP_CONFIRMATION_STATUSES).includes(
        value.confirmation.status as AssessmentSetupConfirmationStatus,
      ) ||
      !(
        typeof value.confirmation.confirmedAt === "string" ||
        value.confirmation.confirmedAt === null
      ))
  )
    return false;
  if (
    value.scanProgress !== undefined &&
    !isNonnegativeIntegerRecord(value.scanProgress, [
      "total",
      "completed",
      "failed",
      "pending",
    ])
  )
    return false;
  if (
    value.relationAggregate !== undefined &&
    (!isRecord(value.relationAggregate) ||
      typeof value.relationAggregate.count !== "number" ||
      typeof value.relationAggregate.independent !== "boolean")
  )
    return false;
  if (
    value.programEvidenceGraph !== undefined &&
    (!isRecord(value.programEvidenceGraph) ||
      !Object.values(ASSESSMENT_GRAPH_STATES).includes(
        value.programEvidenceGraph.state as AssessmentGraphState,
      ) ||
      typeof value.programEvidenceGraph.reportCount !== "number")
  )
    return false;
  return true;
}

export function needsRepositorySetupResume(
  state: AssessmentRepositorySetupState,
): boolean {
  if (
    state.confirmed === false ||
    state.confirmation?.status === ASSESSMENT_SETUP_CONFIRMATION_STATUSES.draft
  ) {
    return true;
  }
  if (state.repositories && state.repositories.length > 0) {
    return (
      state.assessmentStatus === ASSESSMENT_STATUS_CODES.wizardInProgress ||
      state.repositories.some((repository) => repository.snapshot === null)
    );
  }
  return (
    !state.connection ||
    !state.snapshot ||
    state.assessmentStatus === ASSESSMENT_STATUS_CODES.wizardInProgress ||
    !state.scanJob
  );
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonnegativeIntegerRecord(
  value: unknown,
  keys: readonly string[],
): boolean {
  return (
    isRecord(value) &&
    keys.every(
      (key) =>
        typeof value[key] === "number" &&
        Number.isInteger(value[key]) &&
        value[key] >= 0,
    )
  );
}

function isRepository(
  value: unknown,
): value is AssessmentRepositorySetupRepository {
  if (
    !isRecord(value) ||
    !nonempty(value.connectionId) ||
    !nonempty(value.provider) ||
    !nonempty(value.repositoryId) ||
    !nonempty(value.repositoryFullName) ||
    !nonempty(value.defaultBranch) ||
    value.status !== REPOSITORY_CONNECTION_STATUSES.active
  )
    return false;
  const snapshot = value.snapshot;
  if (
    snapshot !== null &&
    (!isRecord(snapshot) ||
      !nonempty(snapshot.id) ||
      !(typeof snapshot.branch === "string" || snapshot.branch === null) ||
      typeof snapshot.commitSha !== "string" ||
      !/^[0-9a-f]{40}$/iu.test(snapshot.commitSha) ||
      !nonempty(snapshot.createdAt))
  )
    return false;
  const scanJob = value.scanJob;
  return (
    scanJob === null ||
    (isRecord(scanJob) &&
      nonempty(scanJob.id) &&
      Object.values(REPOSITORY_SCAN_JOB_STATUSES).some(
        (status) => status === scanJob.status,
      ) &&
      typeof scanJob.attemptCount === "number" &&
      Number.isInteger(scanJob.attemptCount) &&
      scanJob.attemptCount >= 0 &&
      (typeof scanJob.blockedReason === "string" ||
        scanJob.blockedReason === null) &&
      nonempty(scanJob.updatedAt))
  );
}

function isRelation(value: unknown): value is AssessmentRepositoryRelation {
  return (
    isRecord(value) &&
    nonempty(value.id) &&
    nonempty(value.fromSnapshotId) &&
    nonempty(value.toSnapshotId) &&
    value.fromSnapshotId !== value.toSnapshotId &&
    Object.values(ASSESSMENT_REPOSITORY_RELATION_TYPES).some(
      (type) => type === value.type,
    )
  );
}
