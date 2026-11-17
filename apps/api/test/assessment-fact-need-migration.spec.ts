import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "@jest/globals";

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../prisma/migrations/20261116170000_assessment_fact_needs/migration.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

describe("Assessment FactNeed additive migration", () => {
  it("keeps historical human requests valid without a FactNeed backfill", () => {
    expect(migration).toContain(
      'ALTER TABLE "AssessmentHumanRequest" ADD COLUMN "factNeedId" UUID;',
    );
    expect(migration).not.toMatch(
      /ALTER TABLE "AssessmentHumanRequest"[\s\S]*"factNeedId"[^;]*NOT NULL/,
    );
    expect(migration).not.toMatch(
      /^\s*(?:UPDATE|DELETE\s+FROM|DROP\s+TABLE)\b/im,
    );
  });

  it("binds request, need, assessment and resolved fact identities", () => {
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "AssessmentFactNeed_assessmentId_identityDigest_key"',
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "AssessmentHumanRequest_factNeedId_assessmentId_key"',
    );
    expect(migration).toContain(
      'CONSTRAINT "AssessmentHumanRequest_factNeedId_assessmentId_fkey"',
    );
    expect(migration).toContain(
      'CONSTRAINT "AssessmentFactNeed_resolvedFactId_assessmentId_fkey"',
    );
  });

  it("enforces immutable identity and valid lifecycle shapes in PostgreSQL", () => {
    expect(migration).toContain(
      'CONSTRAINT "AssessmentFactNeed_resolution_shape_check"',
    );
    expect(migration).toContain(
      'CREATE TRIGGER "AssessmentFactNeed_identity_guard"',
    );
  });
});
