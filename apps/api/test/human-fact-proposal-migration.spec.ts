import { readFileSync } from "node:fs";
import { join } from "node:path";

const migration = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20261116200000_human_fact_proposals/migration.sql",
  ),
  "utf8",
);

describe("human fact proposal migration", () => {
  it("is additive and does not reinterpret historical answer records", () => {
    expect(migration).toContain('CREATE TABLE "AssessmentHumanFactProposal"');
    expect(migration).toContain(
      'CREATE TRIGGER "AssessmentHumanFactProposal_immutable_guard"',
    );
    expect(migration).not.toMatch(
      /\b(?:DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM|UPDATE\s+[^;]+\s+SET)\b/i,
    );
  });

  it("separates pending review from accepted evidence and facts", () => {
    expect(migration).toContain(
      '"status" "AssessmentHumanFactProposalStatus" NOT NULL',
    );
    expect(migration).toContain("\"status\" = 'PENDING_REVIEW'");
    expect(migration).toContain('"guardFailure" IS NOT NULL');
    expect(migration).toContain("\"status\" = 'ACCEPTED'");
    expect(migration).toContain('"acceptedEvidenceId" IS NOT NULL');
    expect(migration).toContain('"acceptedFactId" IS NOT NULL');
  });

  it("binds proposals to assessment, request, FactNeed and accepted records", () => {
    expect(migration).toContain('FOREIGN KEY ("requestId", "assessmentId")');
    expect(migration).toContain('FOREIGN KEY ("factNeedId", "assessmentId")');
    expect(migration).toContain(
      'FOREIGN KEY ("acceptedEvidenceId", "assessmentId")',
    );
    expect(migration).toContain(
      'FOREIGN KEY ("acceptedFactId", "assessmentId")',
    );
    expect(migration).toContain(
      '"AssessmentHumanFactProposal_assessmentId_idempotencyKey_key"',
    );
    expect(migration).toContain('"caseRevision" INTEGER NOT NULL');
    expect(migration).toContain('"checkpointId" UUID NOT NULL');
  });
});
