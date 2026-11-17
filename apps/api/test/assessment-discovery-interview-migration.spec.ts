import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "@jest/globals";

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../prisma/migrations/20261117120000_assessment_discovery_interview/migration.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

describe("pre-scope Discovery Context Interview additive migration", () => {
  it("preserves all existing accepted facts, decisions and audit history", () => {
    expect(migration).toContain(
      'CREATE TYPE "AssessmentDiscoveryInterviewProposalStatus"',
    );
    expect(migration).toContain(
      'CREATE TABLE "AssessmentDiscoveryInterviewProposal"',
    );
    expect(migration).not.toMatch(
      /^\s*(?:DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|UPDATE\s+"Assessment|ALTER\s+TABLE\s+"AssessmentRuleDecision")\b/im,
    );
  });

  it("keeps answer review separate from human fact acceptance and case scope", () => {
    for (const field of [
      "status",
      "guardFailure",
      "question",
      "answer",
      "acceptedFactId",
      "acceptedEvidenceId",
      "reviewedBy",
      "reviewedAt",
    ]) {
      expect(migration).toContain(`"${field}"`);
    }
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "ADIP_assessment_idempotency_key"',
    );
  });

  it("enforces one-way immutable review transitions and cross-assessment fact integrity", () => {
    expect(migration).toContain(
      'CREATE TRIGGER "AssessmentDiscoveryInterviewProposal_review_only_guard"',
    );
    expect(migration).toContain("\"status\" = 'PENDING_REVIEW'");
    expect(migration).toContain("\"status\" = 'ACCEPTED'");
    expect(migration).toContain("\"status\" = 'REJECTED'");
    expect(migration).toContain("DEFERRABLE INITIALLY DEFERRED");
    expect(migration).toContain(
      'REFERENCES "AssessmentEvidence"("evidenceId", "assessmentId")',
    );
    expect(migration).toContain(
      'REFERENCES "AssessmentCaseFact"("factId", "assessmentId")',
    );
  });

  it("binds every proposal to the assessment's source run and canonical FactNeed", () => {
    expect(migration).toContain('REFERENCES "AssessmentDiscoveryRun"("runId")');
    expect(migration).toContain(
      'REFERENCES "AssessmentFactNeed"("factNeedId", "assessmentId")',
    );
    expect(migration).toContain('REFERENCES "AssessmentCase"("assessmentId")');
  });
});
