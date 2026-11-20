import { REPOSITORY_SCAN_JOB_STATUSES } from "@lcsp/contracts/github-integration";
import type { Prisma } from "@prisma/client";

import { toPrismaRepositoryScanJobStatus } from "../../infrastructure/prisma/prisma-enum-mappers.js";

export const DEFAULT_REPOSITORY_SCAN_STALE_AFTER_MS = 5 * 60 * 1000;
export const STALE_REPOSITORY_SCAN_BLOCKED_REASON =
  "Repository scan worker stopped before completion; rerun the scan to continue.";

type ScanJobStalenessPrisma = Pick<
  Prisma.TransactionClient,
  "assessmentRuntimeEvent" | "repositoryScanJob"
>;

export type FailStaleRepositoryScanJobsInput = {
  assessmentId?: string;
  ownerId?: string;
  now?: Date;
};

const ACTIVE_SCAN_STATUSES = [
  toPrismaRepositoryScanJobStatus(REPOSITORY_SCAN_JOB_STATUSES.queued),
  toPrismaRepositoryScanJobStatus(REPOSITORY_SCAN_JOB_STATUSES.running),
];

/**
 * Returns the scan heartbeat expiry window (fixed code default, no env knob).
 */
export function repositoryScanStaleAfterMs(): number {
  return DEFAULT_REPOSITORY_SCAN_STALE_AFTER_MS;
}

/**
 * Business purpose: Detect and mark abandoned active repository scan jobs as failed when heartbeats expire.
 * Business rules:
 * - Scoped to tenant/workspace via optional assessmentId and ownerId filters.
 * - Only active (QUEUED or RUNNING) jobs older than the stale cutoff are evaluated.
 * - If a job has a recent runtime event heartbeat newer than the cutoff, it remains alive.
 * - Updates stale jobs to FAILED status with STALE_REPOSITORY_SCAN_BLOCKED_REASON.
 * Execution flow:
 * 1. Calculate stale cutoff timestamp using fixed 5-minute inactivity window.
 * 2. Query candidate repository scan jobs matching status and cutoff, scoped by tenant.
 * 3. Batch-fetch the latest assessment runtime events for all candidate runs in a single query.
 * 4. Determine stale job IDs by comparing latest event heartbeat (or job updatedAt) against cutoff.
 * 5. Update identified stale scan jobs to FAILED with blocked reason, scoped by tenant.
 * Failure cases:
 * - Database query failure aborts staleness evaluation.
 * Side effects:
 * - Mutates RepositoryScanJob rows to FAILED status in database.
 */
export async function failStaleRepositoryScanJobs(
  prisma: ScanJobStalenessPrisma,
  input: FailStaleRepositoryScanJobsInput = {},
): Promise<string[]> {
  const now = input.now ?? new Date();
  const staleCutoff = new Date(now.getTime() - repositoryScanStaleAfterMs());

  // Rationale (Why):
  // Tenant/workspace scoping ensures queries cannot leak or manipulate cross-tenant jobs.
  // Mechanism (How):
  // Applies assessmentId and ownerId filters to candidate selection where clause.
  // Invariants (What):
  // Only jobs belonging to the scoped owner/assessment are retrieved.
  const candidates = await prisma.repositoryScanJob.findMany({
    where: {
      ...(input.assessmentId ? { assessmentId: input.assessmentId } : {}),
      ...(input.ownerId ? { assessment: { ownerId: input.ownerId } } : {}),
      status: { in: ACTIVE_SCAN_STATUSES },
      updatedAt: { lt: staleCutoff },
    },
    select: {
      id: true,
      updatedAt: true,
    },
  });

  if (candidates.length === 0) {
    return [];
  }

  // Rationale (Why):
  // Eliminate N+1 query vulnerability where findFirst was called once per candidate job.
  // Mechanism (How):
  // Queries all runtime events for candidate run IDs in a single findMany ordered by createdAt desc.
  // Records the first (newest) timestamp encountered for each runId in a hash map.
  // Invariants (What):
  // Reduces database query count from N+1 to 2, ensuring constant query complexity.
  const candidateIds = candidates.map((candidate) => candidate.id);
  const runtimeEvents = await prisma.assessmentRuntimeEvent.findMany({
    where: { runId: { in: candidateIds } },
    orderBy: { createdAt: "desc" },
    select: { runId: true, createdAt: true },
  });

  const latestHeartbeatByRunId = new Map<string, Date>();
  for (const event of runtimeEvents) {
    if (event.runId && !latestHeartbeatByRunId.has(event.runId)) {
      latestHeartbeatByRunId.set(event.runId, event.createdAt);
    }
  }

  const staleScanJobIds: string[] = [];
  for (const candidate of candidates) {
    const lastHeartbeatAt =
      latestHeartbeatByRunId.get(candidate.id) ?? candidate.updatedAt;
    if (lastHeartbeatAt < staleCutoff) {
      staleScanJobIds.push(candidate.id);
    }
  }

  if (staleScanJobIds.length === 0) {
    return [];
  }

  // Rationale (Why):
  // Enforce tenant/workspace scoping on update to prevent cross-assessment/tenant mutation.
  // Mechanism (How):
  // Restricts updateMany where clause by assessmentId and ownerId (if specified).
  // Invariants (What):
  // Stale scan jobs are updated to FAILED status with blocked reason.
  await prisma.repositoryScanJob.updateMany({
    where: {
      id: { in: staleScanJobIds },
      ...(input.assessmentId ? { assessmentId: input.assessmentId } : {}),
      ...(input.ownerId ? { assessment: { ownerId: input.ownerId } } : {}),
    },
    data: {
      status: toPrismaRepositoryScanJobStatus(
        REPOSITORY_SCAN_JOB_STATUSES.failed,
      ),
      blockedReason: STALE_REPOSITORY_SCAN_BLOCKED_REASON,
    },
  });

  return staleScanJobIds;
}
