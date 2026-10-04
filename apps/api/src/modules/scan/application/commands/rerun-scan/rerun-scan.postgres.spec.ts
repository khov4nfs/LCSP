import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";
import { ASSESSMENT_STATUS_CODES } from "@lcsp/contracts/assessment";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { REPOSITORY_SCAN_JOB_STATUSES } from "@lcsp/contracts/github-integration";
import { SCAN_ERROR_CODES } from "@lcsp/contracts/scan";
import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { RerunScanCommand } from "./rerun-scan.command.js";
import { RerunScanHandler } from "./rerun-scan.handler.js";

// Opt-in only. Use a migrated, disposable LOCAL database ending in _test.
// Never reads DATABASE_URL, resets a schema, or deletes any pre-existing fixture.
const databaseUrl = process.env.LCSP_M03_CONCURRENCY_DATABASE_URL;
const postgresSuite = databaseUrl ? describe : describe.skip;

function connection(applicationName: string): PrismaClient {
  if (!databaseUrl) {
    throw new Error("LCSP_M03_CONCURRENCY_DATABASE_URL is required");
  }
  const url = new URL(databaseUrl);
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    !url.pathname.endsWith("_test")
  ) {
    throw new Error(
      "Refusing concurrency test outside a disposable local _test database",
    );
  }
  url.searchParams.set("application_name", applicationName);
  return new PrismaClient({
    adapter: new PrismaPg(url.toString()),
    transactionOptions: { maxWait: 10_000, timeout: 15_000 },
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

postgresSuite("M03 rerun with actual PostgreSQL row contention", () => {
  it("blocks a competing transaction at the Assessment lock and commits only one active job", async () => {
    const prefix = `m03-${randomUUID()}`;
    const fixture = connection(`${prefix}-fixture`);
    const clientA = connection(`${prefix}-a`);
    const applicationB = `${prefix}-b`;
    const clientB = connection(applicationB);
    const userId = `${prefix}-user`;
    const assessmentId = `${prefix}-assessment`;
    const connectionId = `${prefix}-connection`;
    const snapshotId = `${prefix}-snapshot`;
    const entered = deferred();
    const release = deferred();
    let pending: Promise<unknown>[] = [];
    let createdUser = false;
    try {
      await fixture.user.create({
        data: {
          id: userId,
          email: `${prefix}@fixture.test`,
          passwordHash: "unused-fixture-hash",
          emailVerified: true,
          failedLoginCount: 0,
          role: AUTH_USER_ROLES.customer,
        },
      });
      createdUser = true;
      await fixture.assessment.create({
        data: {
          id: assessmentId,
          ownerId: userId,
          name: "M03 concurrency fixture",
          status: ASSESSMENT_STATUS_CODES.wizardSubmitted,
        },
      });
      await fixture.repositoryConnection.create({
        data: {
          id: connectionId,
          assessmentId,
          userId,
          repositoryId: prefix,
          repositoryName: "fixture",
          repositoryFullName: `${prefix}/fixture`,
          defaultBranch: "main",
          permissions: {},
        },
      });
      await fixture.repositorySnapshot.create({
        data: {
          id: snapshotId,
          assessmentId,
          connectionId,
          repositoryId: prefix,
          repositoryFullName: `${prefix}/fixture`,
          commitSha: "a".repeat(40),
          providerMetadata: {},
          actorId: userId,
        },
      });
      const actor = {
        userId,
        sessionId: `${prefix}-session`,
        role: AUTH_USER_ROLES.customer,
        scope: null,
      };
      const handlerA = new RerunScanHandler(
        clientA as unknown as PrismaService,
        { write: () => Promise.resolve() } as never,
        {
          enqueue: async () => {
            entered.resolve();
            await release.promise;
          },
        } as never,
      );
      const handlerB = new RerunScanHandler(
        clientB as unknown as PrismaService,
        { write: () => Promise.resolve() } as never,
        { enqueue: () => Promise.resolve() } as never,
      );
      const first = handlerA.execute(
        new RerunScanCommand(
          assessmentId,
          snapshotId,
          `${prefix}-key-a`,
          actor,
          `${prefix}-corr-a`,
        ),
      );
      pending = [first];
      await Promise.race([
        entered.promise,
        first.then(() => {
          throw new Error("First transaction never reached the barrier");
        }),
      ]);
      let secondFinished = false;
      const second = handlerB.execute(
        new RerunScanCommand(
          assessmentId,
          snapshotId,
          `${prefix}-key-b`,
          actor,
          `${prefix}-corr-b`,
        ),
      );
      pending.push(second);
      void second.then(
        () => {
          secondFinished = true;
        },
        () => {
          secondFinished = true;
        },
      );
      const results = Promise.allSettled([first, second]);
      // Observe PostgreSQL itself, not an artificial mutex or a mocked $queryRaw.
      let observedLockWait = false;
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline && !secondFinished) {
        const rows = await fixture.$queryRaw<
          Array<{ wait_event_type: string | null }>
        >(
          Prisma.sql`SELECT wait_event_type FROM pg_stat_activity WHERE application_name = ${applicationB}`,
        );
        if (rows.some((row) => row.wait_event_type === "Lock")) {
          observedLockWait = true;
          break;
        }
        await delay(25);
      }
      expect(observedLockWait).toBe(true);
      expect(secondFinished).toBe(false);
      release.resolve();
      const [a, b] = await results;
      expect(a.status).toBe("fulfilled");
      expect(b.status).toBe("rejected");
      if (b.status === "rejected") {
        expect(b.reason).toMatchObject({
          response: {
            problem: {
              status: 409,
              code: SCAN_ERROR_CODES.jobWrongState,
            },
          },
        });
      }
      const jobs = await fixture.repositoryScanJob.findMany({
        where: { assessmentId },
      });
      expect(jobs).toHaveLength(1);
      expect(jobs[0].status).toBe(REPOSITORY_SCAN_JOB_STATUSES.queued);
    } finally {
      release.resolve();
      await Promise.allSettled(pending);
      if (createdUser) {
        await fixture.assessment.deleteMany({
          where: { id: assessmentId, ownerId: userId },
        });
        await fixture.repositoryConnection.deleteMany({
          where: { id: connectionId, userId },
        });
        await fixture.user.deleteMany({ where: { id: userId } });
      }
      await Promise.all([
        fixture.$disconnect(),
        clientA.$disconnect(),
        clientB.$disconnect(),
      ]);
    }
  }, 25_000);
});
