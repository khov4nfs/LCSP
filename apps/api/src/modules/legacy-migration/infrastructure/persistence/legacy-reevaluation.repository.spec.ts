import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import {
  AGENT_EXECUTION_STATES as E,
  ASSESSMENT_LIFECYCLE_STATES as L,
} from "@lcsp/contracts/assessment";
import { LEGACY_REEVALUATION_STOP_REASONS as STOP } from "@lcsp/contracts/legacy-migration";
import type { Prisma } from "@prisma/client";
import { Client } from "pg";

import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { admitStart } from "../../domain/legacy-reevaluation.js";
import { LegacyReevaluationRepository } from "./legacy-reevaluation.repository.js";

const url = process.env.W6_PG_TEST_URL;
const pgDescribe = url ? describe : describe.skip;

pgDescribe(
  "re-evaluation capacity (real PostgreSQL, session-private tables)",
  () => {
    const client = new Client({ connectionString: url });
    const tx = {
      $queryRawUnsafe: async (sql: string, ...params: unknown[]) =>
        (await client.query<Record<string, unknown>>(sql, params)).rows,
    } as unknown as Prisma.TransactionClient;
    const repo = new LegacyReevaluationRepository(tx as PrismaService);
    const limits = {
      globalConcurrency: 3,
      tenantConcurrency: 2,
      maxBacklog: 2,
      maxTotal: 3,
    };

    beforeAll(async () => {
      if (!url || !new URL(url).pathname.startsWith("/lcsp_w6_"))
        throw new Error(
          "W6_PG_TEST_URL must name a disposable lcsp_w6_ database",
        );
      await client.connect();
      await client.query(`
      BEGIN;
      CREATE TEMP TABLE "Assessment" (id text, "ownerId" text, "lifecycleState" text);
      CREATE TEMP TABLE "AssessmentRuntime" ("assessmentId" text, "executionState" text, "startedAt" timestamptz);
    `);
      for (const [id, owner, lifecycle, execution, claimed] of [
        ["running", "tenant-1", L.ACTIVE, E.RUNNING, true],
        ["queued", "tenant-1", L.ACTIVE, E.QUEUED, false],
        ["failed-claimed", "tenant-failed", L.ACTIVE, E.FAILED, true],
        ["failed-unclaimed", "tenant-failed", L.ACTIVE, E.FAILED, false],
        ["finalizing", "tenant-2", L.FINALIZING, E.RUNNING, true],
        ["waiting", "tenant-2", L.WAITING_FOR_HUMAN, E.INTERRUPTED, true],
        ["prepared", "tenant-2", L.PREPARING, E.QUEUED, false],
      ]) {
        await client.query('INSERT INTO "Assessment" VALUES ($1, $2, $3)', [
          id,
          owner,
          lifecycle,
        ]);
        await client.query(
          'INSERT INTO "AssessmentRuntime" VALUES ($1, $2, $3)',
          [id, execution, claimed ? new Date() : null],
        );
      }
    });

    afterAll(async () => {
      try {
        await client.query("ROLLBACK");
      } finally {
        await client.end();
      }
    });

    it("excludes claimed and unclaimed FAILED executions from global, tenant and backlog counts", async () => {
      const load = await repo.load(tx);
      expect(load.inFlight).toBe(3);
      expect(load.queued).toBe(1);
      expect([...load.byTenant.entries()].sort()).toEqual([
        ["tenant-1", 2],
        ["tenant-2", 1],
      ]);
      expect(await repo.loadForTenant(tx, "tenant-failed")).toEqual({
        inFlight: 3,
        queued: 1,
        inFlightForTenant: 0,
      });
    });

    it("releases capacity for later starts without changing lifecycle or retrying the failed assessment", async () => {
      expect(
        admitStart(limits, await repo.loadForTenant(tx, "tenant-1"), 0),
      ).toEqual({
        admit: false,
        scope: "PASS",
        reason: STOP.GLOBAL_CAP_REACHED,
      });
      await client.query(
        'UPDATE "AssessmentRuntime" SET "executionState" = $1 WHERE "assessmentId" = $2',
        [E.FAILED, "running"],
      );
      expect(await repo.loadForTenant(tx, "tenant-1")).toEqual({
        inFlight: 2,
        queued: 1,
        inFlightForTenant: 1,
      });
      expect(
        admitStart(limits, await repo.loadForTenant(tx, "tenant-1"), 0),
      ).toEqual({ admit: true });
      expect(
        (
          await client.query(
            'SELECT "lifecycleState" FROM "Assessment" WHERE id = $1',
            ["running"],
          )
        ).rows,
      ).toEqual([{ lifecycleState: L.ACTIVE }]);
      expect(
        (
          await client.query(
            'SELECT "executionState" FROM "AssessmentRuntime" WHERE "assessmentId" = $1',
            ["running"],
          )
        ).rows,
      ).toEqual([{ executionState: E.FAILED }]);
    });
  },
);
