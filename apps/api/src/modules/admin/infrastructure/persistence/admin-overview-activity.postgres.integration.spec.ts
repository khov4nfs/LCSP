import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "@jest/globals";
import { readAdminOverviewActivity } from "./admin-overview-activity.read-model.js";

const databaseUrl = process.env.DATABASE_URL ?? "";
const disposableDatabase = (() => {
  try {
    const url = new URL(databaseUrl);
    return (
      ["localhost", "127.0.0.1"].includes(url.hostname) &&
      url.port === "55448" &&
      url.pathname === "/lcsp_r2_activation"
    );
  } catch {
    return false;
  }
})();

(disposableDatabase ? describe : describe.skip)(
  "Admin overview activity PostgreSQL read model",
  () => {
    it("counts starts and real COMPLETE events without loading a later-updated old Assessment", async () => {
      const prisma = new PrismaClient({ adapter: new PrismaPg(databaseUrl) });
      const now = new Date("2026-09-20T00:00:00.000Z");
      const windowStart = new Date("2026-09-13T00:00:00.000Z");
      try {
        await prisma.$transaction(async (tx) => {
          // Why: Temporary tables exercise the production SQL without mutating durable fixtures.
          // How: Shadow the two read-model tables for one transaction connection.
          // Invariant: A later update cannot masquerade as a COMPLETE transition.
          await tx.$executeRawUnsafe(`CREATE TEMP TABLE "Assessment" (
            "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL
          ) ON COMMIT DROP`);
          await tx.$executeRawUnsafe(`CREATE TEMP TABLE "AssessmentEvent" (
            "timestamp" timestamptz NOT NULL, "eventType" "AssessmentEventType" NOT NULL, "payload" jsonb NOT NULL
          ) ON COMMIT DROP`);
          await tx.$executeRawUnsafe(`INSERT INTO "Assessment" ("createdAt", "updatedAt") VALUES
            ('2026-08-01T00:00:00Z', '2026-09-19T00:00:00Z'),
            ('2026-09-14T00:00:00Z', '2026-09-14T00:00:00Z')`);
          await tx.$executeRawUnsafe(`INSERT INTO "AssessmentEvent" ("timestamp", "eventType", "payload") VALUES
            ('2026-09-15T00:00:00Z', 'ASSESSMENT_LIFECYCLE_CHANGED', '{"toState":"COMPLETE"}'),
            ('2026-08-02T00:00:00Z', 'ASSESSMENT_LIFECYCLE_CHANGED', '{"toState":"COMPLETE"}')`);
          const activity = await readAdminOverviewActivity(
            tx as never,
            windowStart,
            now,
            7,
          );
          expect(activity.points).toHaveLength(7);
          expect(activity.totalStarted).toBe(1);
          expect(activity.totalCompleted).toBe(1);
          expect(activity.points[1]?.startedCount).toBe(1);
          expect(activity.points[2]?.completedCount).toBe(1);
          // Why: A dashboard must remain bounded when the period contains many Assessments.
          // How: Add 10,000 rows and confirm the read model still returns only seven buckets.
          // Invariant: The API never receives one row per Assessment from this query.
          await tx.$executeRawUnsafe(`INSERT INTO "Assessment" ("createdAt", "updatedAt")
            SELECT '2026-09-16T00:00:00Z', '2026-09-16T00:00:00Z'
            FROM generate_series(1, 10000)`);
          const largeActivity = await readAdminOverviewActivity(
            tx as never,
            windowStart,
            now,
            7,
          );
          expect(largeActivity.points).toHaveLength(7);
          expect(largeActivity.totalStarted).toBe(10001);
          expect(largeActivity.totalCompleted).toBe(1);
        });
      } finally {
        await prisma.$disconnect();
      }
    });
  },
);
