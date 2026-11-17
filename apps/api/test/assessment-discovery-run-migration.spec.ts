import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "@jest/globals";

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../prisma/migrations/20261117090000_assessment_discovery_runs/migration.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

describe("pre-scope repository Discovery additive migration", () => {
  it("adds only a separate discovery run without rewriting accepted assessment history", () => {
    expect(migration).toContain('CREATE TYPE "AssessmentDiscoveryRunStatus"');
    expect(migration).toContain('CREATE TABLE "AssessmentDiscoveryRun"');
    expect(migration).not.toMatch(
      /^\s*(?:UPDATE|DELETE\s+FROM|DROP\s+TABLE|TRUNCATE|ALTER\s+TABLE\s+"AssessmentRuleDecision")\b/im,
    );
  });

  it("keeps immutable snapshot coordinates and the worker digest for idempotent completion", () => {
    for (const column of [
      "repositorySnapshotId",
      "repositoryCommit",
      "sourcePathPrefix",
      "repositoryScanJobId",
      "leaseToken",
      "leaseExpiresAt",
      "workerContentDigest",
    ]) {
      expect(migration).toContain(`"${column}"`);
    }
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "AssessmentDiscoveryRun_assessmentId_idempotencyKey_key"',
    );
  });

  it("binds completed Discovery to the same assessment-owned immutable record", () => {
    expect(migration).toContain(
      'CONSTRAINT "AssessmentDiscoveryRun_assessmentId_fkey"',
    );
    expect(migration).toContain(
      'CONSTRAINT "AssessmentDiscoveryRun_discoveryRecordId_assessmentId_fkey"',
    );
    expect(migration).toContain(
      'REFERENCES "AssessmentRepositoryDiscovery"("recordId", "assessmentId")',
    );
  });
});
