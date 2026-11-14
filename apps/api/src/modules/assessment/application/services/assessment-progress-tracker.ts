import { ASSESSMENT_ROOT_BOUNDARY } from "@lcsp/contracts/assessment-domain";
import { ASSESSMENT_RUNTIME_CONTROL_STATES as Controls } from "@lcsp/contracts/evidence";

/**
 * Business purpose: Calculate the authoritative number of consecutive completed turns without progress for an assessment.
 *
 * Business rules:
 * - A turn made progress if domain state advanced: caseRevision increased, facts were accepted, evidence was cited, decisions were submitted, or human requests were resolved.
 * - Model reasoning or raw text tokens alone never constitute authoritative domain progress.
 * - Completed and stopped turns are inspected backwards from most recent; scanning stops at the first turn with progress.
 *
 * Execution flow:
 * 1. Query completed or stopped AssessmentRuntimeTurn records for this assessment in descending chronological order.
 * 2. For each turn, verify whether progressMade is recorded, caseRevision advanced, or domain events were emitted for its executionId.
 * 3. Stop at the first turn that produced domain progress, returning the count of intervening non-progress turns.
 *
 * Failure cases:
 * - If no turns exist or the most recent completed turn made progress, returns 0.
 *
 * Side effects:
 * - Read-only queries against database transaction; no mutations or external calls.
 */
export async function calculateConsecutiveTurnsWithoutProgress(
  tx: any,
  assessmentId: string,
): Promise<number> {
  if (!tx.assessmentRuntimeTurn?.findMany) {
    return 0;
  }
  const turns = await tx.assessmentRuntimeTurn.findMany({
    where: {
      assessmentId,
      boundary: ASSESSMENT_ROOT_BOUNDARY,
      state: { in: [Controls.completed, Controls.stopped] },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      contextJson: true,
      checkpointJson: true,
      createdAt: true,
    },
  });

  if (!turns || turns.length === 0) {
    return 0;
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
    if (ctx.progressMade === false) {
      count++;
      continue;
    }

    // 2. Check if endCaseRevision > startCaseRevision
    if (
      typeof ctx.endCaseRevision === "number" &&
      typeof ctx.startCaseRevision === "number" &&
      ctx.endCaseRevision > ctx.startCaseRevision
    ) {
      break;
    }

    // 3. Fallback: check domain events for this executionId
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

