import {
  workspaceAssessmentSnapshotSchema,
  type CanonicalAssessmentRuntimeSnapshot,
} from "@lcsp/contracts/evidence";
import type { AssessmentEvent } from "@lcsp/contracts/assessment";
import {
  WORKSPACE_RUNTIME_CONNECTION_STATES,
  type WorkspaceRuntimeContextValue,
} from "../types/workspace-runtime.types.ts";

export function parseRuntimeEvent(
  data: string,
): WorkspaceRuntimeContextValue | null {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  const parsed = workspaceAssessmentSnapshotSchema.safeParse(value);
  if (!parsed.success) return null;
  const payload = parsed.data;
  const canonicalAssessments = payload.canonical_assessments;
  const canonicalEvents = payload.canonical_events;
  const canonicalAssessmentByAssessmentId = Object.fromEntries(
    canonicalAssessments.map((assessment) => [
      assessment.assessmentId,
      assessment,
    ]),
  );
  const canonicalEventsByAssessmentId =
    groupCanonicalEventsByAssessmentId(canonicalEvents);
  return {
    connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.connected,
    emittedAt: payload.emitted_at,
    canonicalAssessments,
    canonicalEvents,
    canonicalAssessmentByAssessmentId,
    canonicalEventsByAssessmentId,
    getAssessmentRuntime: (assessmentId) => ({
      canonicalAssessment:
        canonicalAssessmentByAssessmentId[assessmentId] ?? null,
      canonicalEvents: canonicalEventsByAssessmentId[assessmentId] ?? [],
      connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.connected,
      lastEmittedAt: payload.emitted_at,
    }),
  };
}

function groupCanonicalEventsByAssessmentId(events: AssessmentEvent[]) {
  const groups: Record<string, AssessmentEvent[]> = {};
  for (const event of events) {
    groups[event.assessmentId] ??= [];
    groups[event.assessmentId].push(event);
  }
  for (const assessmentId of Object.keys(groups)) {
    groups[assessmentId]?.sort(
      (left, right) =>
        right.timestamp.localeCompare(left.timestamp) ||
        right.sequence - left.sequence,
    );
  }
  return groups;
}

type CanonicalSnapshot = {
  canonicalAssessments?: CanonicalAssessmentRuntimeSnapshot[];
  canonicalEvents?: AssessmentEvent[];
};
export function runtimeFingerprint(runtime: CanonicalSnapshot) {
  return JSON.stringify({
    canonicalAssessments: (runtime.canonicalAssessments ?? []).map(
      (assessment) => [
        assessment.assessmentId,
        assessment.lifecycle?.state ?? null,
        assessment.lifecycle?.assessmentRevision ?? null,
        assessment.runtime?.currentExecutionId ?? null,
        assessment.runtime?.executionState ?? null,
        assessment.runtime?.eventSequence ?? null,
        assessment.runtime?.updatedAt ?? null,
      ],
    ),
    canonicalEvents: (runtime.canonicalEvents ?? []).map((event) => [
      event.eventId,
      event.assessmentId,
      event.sequence,
      event.timestamp,
      event.eventType,
    ]),
  });
}
export function affectedAssessmentIds(runtime: CanonicalSnapshot) {
  return new Set([
    ...(runtime.canonicalAssessments ?? []).map(
      (assessment) => assessment.assessmentId,
    ),
    ...(runtime.canonicalEvents ?? []).map((event) => event.assessmentId),
  ]);
}
