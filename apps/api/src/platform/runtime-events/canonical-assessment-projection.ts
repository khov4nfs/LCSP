import {
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_LIFECYCLE_STATES,
  assessmentLifecycleSchema,
  type AssessmentLifecycle,
} from "@lcsp/contracts/assessment";
import {
  assessmentRuntimeSchema,
  canonicalAssessmentRuntimeSnapshotSchema,
  type AssessmentRuntime,
  type CanonicalAssessmentRuntimeSnapshot,
} from "@lcsp/contracts/evidence";
import { HttpStatus } from "@nestjs/common";

import { problemException } from "../http/filters/error.factory.js";

export type PersistedCanonicalRuntimeRow = {
  threadId: string;
  rootAgentVersion: string;
  checkpointNamespace: string;
  checkpointId: string | null;
  currentExecutionId: string | null;
  executionState: string;
  eventSequence: number;
  startedAt: Date | null;
  lastResumedAt: Date | null;
  updatedAt: Date;
};

export type PersistedCanonicalAssessmentRow = {
  id: string;
  lifecycleState: string | null;
  lifecycleRevision: number | null;
  blockerReason: string | null;
  blockerReference: unknown;
  runtime: PersistedCanonicalRuntimeRow | null;
};

/** Projects one persisted ALS/AES row for both GET and workspace snapshots. */
export function projectCanonicalAssessment(
  assessmentId: string,
  row: PersistedCanonicalAssessmentRow | null,
  correlationId = "",
): CanonicalAssessmentRuntimeSnapshot {
  if (!row) {
    return { assessmentId, lifecycle: null, runtime: null };
  }

  const lifecycle = persistedLifecycle(row, correlationId);
  const runtime = persistedRuntime(row.runtime, assessmentId, correlationId);
  const parsed = canonicalAssessmentRuntimeSnapshotSchema.safeParse({
    assessmentId,
    lifecycle,
    runtime,
  });
  if (!parsed.success) throw canonicalPersistenceProblem(correlationId);
  return parsed.data;
}

function persistedLifecycle(
  row: Pick<
    PersistedCanonicalAssessmentRow,
    | "lifecycleState"
    | "lifecycleRevision"
    | "blockerReason"
    | "blockerReference"
  >,
  correlationId: string,
): AssessmentLifecycle | null {
  const absent =
    row.lifecycleState === null &&
    row.lifecycleRevision === null &&
    row.blockerReason === null &&
    row.blockerReference === null;
  if (absent) return null;
  if (row.lifecycleState === null || row.lifecycleRevision === null) {
    throw canonicalPersistenceProblem(correlationId);
  }
  if (
    row.lifecycleState !== ASSESSMENT_LIFECYCLE_STATES.BLOCKED &&
    (row.blockerReason !== null || row.blockerReference !== null)
  ) {
    throw canonicalPersistenceProblem(correlationId);
  }
  if (
    row.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.BLOCKED &&
    (row.blockerReason === null || row.blockerReference === null)
  ) {
    throw canonicalPersistenceProblem(correlationId);
  }
  const parsed = assessmentLifecycleSchema.safeParse({
    state: row.lifecycleState,
    assessmentRevision: row.lifecycleRevision,
    ...(row.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.BLOCKED
      ? {
          blocker: {
            reason: row.blockerReason,
            reference: row.blockerReference,
          },
        }
      : {}),
  });
  if (!parsed.success) throw canonicalPersistenceProblem(correlationId);
  return parsed.data;
}

function persistedRuntime(
  row: PersistedCanonicalRuntimeRow | null,
  assessmentId: string,
  correlationId: string,
): AssessmentRuntime | null {
  if (!row) return null;
  const parsed = assessmentRuntimeSchema.safeParse({
    threadId: row.threadId,
    rootAgentVersion: row.rootAgentVersion,
    checkpointNamespace: row.checkpointNamespace,
    checkpointId: row.checkpointId,
    currentExecutionId: row.currentExecutionId,
    executionState: row.executionState,
    eventSequence: row.eventSequence,
    startedAt: row.startedAt?.toISOString() ?? null,
    lastResumedAt: row.lastResumedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  });
  if (!parsed.success || parsed.data.checkpointNamespace !== assessmentId) {
    throw canonicalPersistenceProblem(correlationId);
  }
  return parsed.data;
}

export function canonicalPersistenceProblem(correlationId: string) {
  return problemException(
    ASSESSMENT_ERROR_CODES.repositorySetupStateInvalid,
    correlationId,
    { status: HttpStatus.CONFLICT },
  );
}
