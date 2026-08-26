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

type FailStaleRepositoryScanJobsInput = {
  assessmentId?: string;
  now?: Date;
};

type StaleScanCandidate = {
  id: string;
  updatedAt: Date;
};

const ACTIVE_SCAN_STATUSES = [
  toPrismaRepositoryScanJobStatus(REPOSITORY_SCAN_JOB_STATUSES.queued),
  toPrismaRepositoryScanJobStatus(REPOSITORY_SCAN_JOB_STATUSES.running),
];

/**
 * Returns the scan heartbeat expiry window, keeping local development recoverable when a worker is interrupted.
 */
export function repositoryScanStaleAfterMs(): number {
  const configured = Number(process.env.REPOSITORY_SCAN_STALE_AFTER_MS);
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }
  return DEFAULT_REPOSITORY_SCAN_STALE_AFTER_MS;
}

/**
 * Marks active scan jobs as failed when both the job row and its latest runtime event are older than the stale cutoff.
 */
export async function failStaleRepositoryScanJobs(
  prisma: ScanJobStalenessPrisma,
  input: FailStaleRepositoryScanJobsInput = {},
): Promise<string[]> {
  const now = input.now ?? new Date();
  const staleCutoff = new Date(now.getTime() - repositoryScanStaleAfterMs());
  const candidates = await prisma.repositoryScanJob.findMany({
    where: {
      ...(input.assessmentId ? { assessmentId: input.assessmentId } : {}),
      status: { in: ACTIVE_SCAN_STATUSES },
      updatedAt: { lt: staleCutoff },
    },
    select: {
      id: true,
      updatedAt: true,
    },
  });

  const staleScanJobIds: string[] = [];
  for (const candidate of candidates) {
    if (await isStaleScanCandidate(prisma, candidate, staleCutoff)) {
      staleScanJobIds.push(candidate.id);
    }
  }

  if (staleScanJobIds.length === 0) {
    return [];
  }

  await prisma.repositoryScanJob.updateMany({
    where: { id: { in: staleScanJobIds } },
    data: {
      status: toPrismaRepositoryScanJobStatus(
        REPOSITORY_SCAN_JOB_STATUSES.failed,
      ),
      blockedReason: STALE_REPOSITORY_SCAN_BLOCKED_REASON,
    },
  });
  return staleScanJobIds;
}

async function isStaleScanCandidate(
  prisma: ScanJobStalenessPrisma,
  candidate: StaleScanCandidate,
  staleCutoff: Date,
): Promise<boolean> {
  const latestRuntimeEvent = await prisma.assessmentRuntimeEvent.findFirst({
    where: { runId: candidate.id },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const lastHeartbeatAt = latestRuntimeEvent?.createdAt ?? candidate.updatedAt;
  return lastHeartbeatAt < staleCutoff;
}
