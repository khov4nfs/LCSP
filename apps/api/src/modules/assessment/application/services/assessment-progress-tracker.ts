import { ASSESSMENT_ROOT_BOUNDARY } from "@lcsp/contracts/assessment-domain";
import { ASSESSMENT_RUNTIME_CONTROL_STATES as Controls } from "@lcsp/contracts/evidence";

export interface AssessmentProgressDatabaseClient {
  assessmentRuntimeTurn?: {
    findMany: (args: unknown) => Promise<
      Array<{
        id: string;
        state?: string;
        contextJson?: unknown;
        checkpointJson?: unknown;
        createdAt: Date;
      }>
    >;
  };
  assessmentCase?: {
    findUnique: (args: unknown) => Promise<{ caseRevision: number } | null>;
  };
  assessmentEvent?: {
    count: (args: unknown) => Promise<number>;
  };
}

/**
 * Business purpose: Calculate the authoritative number of consecutive turns without progress for an assessment, including intra-execution progress of running turns.
 *
 * Business rules:
 * - A turn made progress if domain state advanced: caseRevision increased, facts were accepted, evidence was cited, decisions were submitted, or human requests were resolved.
 * - Both completed/stopped turns and currently RUNNING turns are evaluated; an active running turn that has accepted domain facts or evidence resets the progress counter.
 * - Model reasoning or raw text tokens alone never constitute authoritative domain progress.
 * - Turns are inspected backwards from most recent; scanning stops at the first turn with authoritative progress.
 *
 * Execution flow:
 * 1. Query running, completed, or stopped AssessmentRuntimeTurn records for this assessment in descending chronological order.
 * 2. For each turn, verify whether progress is recorded in context, caseRevision advanced, or domain events were emitted for its executionId.
 * 3. For running turns, check live domain events and case revision advancement under the active execution.
 * 4. Stop at the first turn that produced domain progress, returning the count of intervening non-progress turns.
 *
 * Failure cases:
 * - If no turns exist or the most recent turn made progress, returns 0.
 *
 * Side effects:
 * - Read-only queries against database transaction; no mutations or external calls.
 */
export async function calculateConsecutiveTurnsWithoutProgress(
  tx: AssessmentProgressDatabaseClient,
  assessmentId: string,
): Promise<number> {
  if (!tx.assessmentRuntimeTurn?.findMany) {
    return 0;
  }
  const turns = await tx.assessmentRuntimeTurn.findMany({
    where: {
      assessmentId,
      boundary: ASSESSMENT_ROOT_BOUNDARY,
      state: { in: [Controls.running, Controls.completed, Controls.stopped] },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      state: true,
      contextJson: true,
      checkpointJson: true,
      createdAt: true,
    },
  });

  if (!turns || turns.length === 0) {
    return 0;
  }

  let currentCaseRevision: number | null = null;
  if (tx.assessmentCase?.findUnique) {
    const caseRow = await tx.assessmentCase.findUnique({
      where: { assessmentId },
      select: { caseRevision: true },
    });
    currentCaseRevision = caseRow?.caseRevision ?? null;
  }

  let count = 0;
  for (const turn of turns) {
    const ctx =
      turn.contextJson &&
      typeof turn.contextJson === "object" &&
      !Array.isArray(turn.contextJson)
        ? (turn.contextJson as Record<string, unknown>)
        : {};

    // 1. Explicit progress flag in contextJson
    if (ctx.progressMade === true) {
      break;
    }
    if (ctx.progressMade === false && turn.state !== Controls.running) {
      count++;
      continue;
    }

    // 2. Check if endCaseRevision / caseRevision > startCaseRevision / baselineCaseRevision
    const startRevision =
      typeof ctx.startCaseRevision === "number"
        ? ctx.startCaseRevision
        : typeof ctx.baselineCaseRevision === "number"
          ? ctx.baselineCaseRevision
          : null;
    const endRevision =
      typeof ctx.endCaseRevision === "number"
        ? ctx.endCaseRevision
        : typeof ctx.caseRevision === "number"
          ? ctx.caseRevision
          : null;

    if (
      endRevision !== null &&
      startRevision !== null &&
      endRevision > startRevision
    ) {
      break;
    }

    // 3. For a RUNNING turn, check if live caseRevision advanced beyond startCaseRevision
    if (
      turn.state === Controls.running &&
      startRevision !== null &&
      currentCaseRevision !== null &&
      currentCaseRevision > startRevision
    ) {
      break;
    }

    // 4. Check domain events for this executionId
    if (tx.assessmentEvent?.count) {
      const eventCount = await tx.assessmentEvent.count({
        where: {
          assessmentId,
          executionId: turn.id,
          eventType: {
            in: [
              "EVIDENCE_ACCEPTED",
              "DECISION_ACCEPTED",
              "HUMAN_RESOLUTION_CHANGED",
              "ARTIFACT_CHANGED",
            ],
          },
        },
      });
      if (eventCount > 0) {
        break;
      }
    }

    count++;
  }

  return count;
}
