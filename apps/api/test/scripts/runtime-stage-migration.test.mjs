import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Client } from "pg";
import { ASSESSMENT_RUNTIME_STAGE_CODES } from "@lcsp/contracts/evidence";

const migration = await readFile(
  new URL(
    "../../prisma/migrations/20260911030000_reconcile_assessment_runtime_stages/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const schema = await readFile(
  new URL("../../prisma/schema.prisma", import.meta.url),
  "utf8",
);
const canonicalStages = Object.values(ASSESSMENT_RUNTIME_STAGE_CODES);

test("Prisma runtime stages match the public contract", () => {
  const stages = schema
    .match(/enum AssessmentRuntimeStage\s*\{([^}]+)\}/)[1]
    .trim()
    .split(/\s+/);
  assert.deepEqual(stages.sort(), [...canonicalStages].sort());
});

for (const legacy of [false, true]) {
  test(`runtime-stage migration preserves events (${legacy ? "legacy" : "clean"} database)`, async () => {
    assert.ok(
      process.env.DATABASE_URL,
      "Set DATABASE_URL to run the isolated PostgreSQL regression",
    );
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query("BEGIN");
      const namespace = `runtime_stage_test_${randomUUID().replaceAll("-", "")}`;
      await client.query(`CREATE SCHEMA "${namespace}"`);
      await client.query(`SET LOCAL search_path TO "${namespace}"`);
      const originalStages = ["SCAN", "INTERVIEW", "LEGAL_RETRIEVAL"];
      const legacyStages = legacy
        ? ["RULES", "PLANNER", "INVESTIGATE", "GATE"]
        : [];
      const stages = [...originalStages, ...legacyStages];
      await client.query(
        `CREATE TYPE "AssessmentRuntimeStage" AS ENUM (${stages.map((stage) => `'${stage}'`).join(",")})`,
      );
      await client.query(
        'CREATE TABLE "AssessmentRuntimeEvent" (id text PRIMARY KEY, stage "AssessmentRuntimeStage", payload jsonb, "createdAt" timestamp)',
      );
      for (const stage of stages) {
        await client.query(
          'INSERT INTO "AssessmentRuntimeEvent" VALUES ($1, $2, $3, $4)',
          [
            stage,
            stage,
            { summary: stage, sequence: 1 },
            "2026-09-11T00:00:00Z",
          ],
        );
      }
      const before = (
        await client.query('SELECT * FROM "AssessmentRuntimeEvent" ORDER BY id')
      ).rows;
      await client.query(migration);
      await client.query(migration); // Safe to rerun after a partial deployment.
      const after = (
        await client.query('SELECT * FROM "AssessmentRuntimeEvent" ORDER BY id')
      ).rows;
      assert.deepEqual(
        after,
        before.map((event) => ({
          ...event,
          stage: legacyStages.includes(event.stage)
            ? ASSESSMENT_RUNTIME_STAGE_CODES.legalRetrieval
            : event.stage,
        })),
      );
      const labels = (
        await client.query(
          "SELECT enumlabel FROM pg_enum WHERE enumtypid = $1::regtype",
          ['"AssessmentRuntimeStage"'],
        )
      ).rows.map((row) => row.enumlabel);
      for (const stage of [
        "codeReview",
        "remediation",
        "verification",
        "finalAssessment",
      ]) {
        assert.ok(labels.includes(ASSESSMENT_RUNTIME_STAGE_CODES[stage]));
      }
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  });
}
