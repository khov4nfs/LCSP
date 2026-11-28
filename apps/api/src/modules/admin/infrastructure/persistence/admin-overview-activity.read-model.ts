import { Prisma } from "@prisma/client";
import {
  AGENTIC_ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import type { AdminOverviewActivityPoint } from "@lcsp/contracts/auth";
import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";

type ActivityBucketRow = {
  bucket: number;
  startedCount: bigint;
  completedCount: bigint;
};

/**
 * Business purpose: Provide bounded Admin dashboard activity counts for the requested time window.
 * Business rules:
 * - Starts use Assessment creation; completions use durable COMPLETE lifecycle events, never Assessment.updatedAt.
 * - Every event belongs to one half-open bucket, so boundary timestamps cannot be counted twice.
 * Execution flow:
 * 1. Aggregate starts and completion events by bucket inside PostgreSQL.
 * 2. Join the aggregates to a fixed series of at most fourteen buckets.
 * 3. Return points and totals without materializing Assessment or event rows in Node.js.
 * Failure cases:
 * - Database failures propagate to the global problem filter; no partial dashboard is returned.
 * Side effects:
 * - Read-only database query.
 */
export async function readAdminOverviewActivity(
  prisma: PrismaService,
  windowStart: Date,
  currentTime: Date,
  periodDays: number,
) {
  const barCount = periodDays <= 14 ? periodDays : 14;
  const intervalMs = (currentTime.getTime() - windowStart.getTime()) / barCount;
  // Why: An Admin request must not transfer every system-wide Assessment to the API process.
  // How: PostgreSQL groups each timestamp into a fixed bucket and returns only aggregate rows.
  // Invariant: COMPLETE is certified by a lifecycle event, not a later update to Assessment.
  const rows = await prisma.$queryRaw<ActivityBucketRow[]>(Prisma.sql`
    WITH started AS (
      SELECT LEAST(${barCount - 1}, FLOOR(EXTRACT(EPOCH FROM (a."createdAt" - ${windowStart})) * 1000 / ${intervalMs})::int) AS bucket,
             COUNT(*)::bigint AS count
      FROM "Assessment" AS a
      WHERE a."createdAt" >= ${windowStart} AND a."createdAt" < ${currentTime}
      GROUP BY 1
    ), completed AS (
      SELECT LEAST(${barCount - 1}, FLOOR(EXTRACT(EPOCH FROM (e."timestamp" - ${windowStart})) * 1000 / ${intervalMs})::int) AS bucket,
             COUNT(*)::bigint AS count
      FROM "AssessmentEvent" AS e
      WHERE e."timestamp" >= ${windowStart} AND e."timestamp" < ${currentTime}
        AND e."eventType" = ${AGENTIC_ASSESSMENT_EVENT_TYPES.ASSESSMENT_LIFECYCLE_CHANGED}::"AssessmentEventType"
        AND e."payload"->>'toState' = ${ASSESSMENT_LIFECYCLE_STATES.COMPLETE}
      GROUP BY 1
    )
    SELECT series.bucket::int AS bucket,
           COALESCE(started.count, 0)::bigint AS "startedCount",
           COALESCE(completed.count, 0)::bigint AS "completedCount"
    FROM generate_series(0, ${barCount - 1}) AS series(bucket)
    LEFT JOIN started ON started.bucket = series.bucket
    LEFT JOIN completed ON completed.bucket = series.bucket
    ORDER BY series.bucket
  `);

  const points: AdminOverviewActivityPoint[] = rows.map((row) => {
    const bucketStart = new Date(
      windowStart.getTime() + row.bucket * intervalMs,
    );
    return {
      date: bucketStart.toISOString().slice(0, 10),
      timestamp: bucketStart.toISOString(),
      startedCount: Number(row.startedCount),
      completedCount: Number(row.completedCount),
    };
  });
  return {
    points,
    totalStarted: points.reduce(
      (total, point) => total + point.startedCount,
      0,
    ),
    totalCompleted: points.reduce(
      (total, point) => total + point.completedCount,
      0,
    ),
    startDate: windowStart.toISOString(),
    endDate: currentTime.toISOString(),
  };
}
