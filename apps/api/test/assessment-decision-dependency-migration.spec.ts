import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "@jest/globals";

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../prisma/migrations/20261116180000_assessment_decision_dependencies/migration.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

describe("Assessment decision dependency additive migration", () => {
  it("leaves historical decisions explicitly incomplete without reinterpreting JSON", () => {
    expect(migration).toContain(
      'ADD COLUMN "dependencyGraphComplete" BOOLEAN NOT NULL DEFAULT false',
    );
    expect(migration).not.toMatch(
      /^\s*(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM)\b/im,
    );
  });

  it("binds direct evidence and fact edges to the same assessment and decision", () => {
    expect(migration).toContain(
      'CREATE TABLE "AssessmentDecisionEvidenceDependency"',
    );
    expect(migration).toContain(
      'CREATE TABLE "AssessmentDecisionFactDependency"',
    );
    expect(migration).toContain('FOREIGN KEY ("decisionId", "assessmentId")');
    expect(migration).toContain('FOREIGN KEY ("evidenceId", "assessmentId")');
    expect(migration).toContain('FOREIGN KEY ("factId", "assessmentId")');
  });

  it("makes the completeness marker immutable after decision creation", () => {
    expect(migration).toContain(
      'CREATE TRIGGER "AssessmentRuleDecision_dependency_completeness_guard"',
    );
    expect(migration).toContain(
      "decision dependency completeness is immutable",
    );
  });
});
