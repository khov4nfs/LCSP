import { describe, expect, it, jest } from "@jest/globals";
import type { Prisma } from "@prisma/client";
import {
  RULE_DECISION_APPLICABILITIES,
  RULE_DECISION_REFERENCE_TYPES,
  ruleDecisionSchema,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_DECISION_SCOPE,
  ASSESSMENT_FACT_AUTHORITIES,
  ASSESSMENT_RECORD_STATES,
  ASSESSMENT_EVIDENCE_TYPES,
} from "@lcsp/contracts/assessment-domain";

import { AssessmentCaseSupport } from "./assessment-case-support.service.js";

describe("AssessmentCaseSupport decision provenance", () => {
  it("loads a cited fact's linked evidence under the same assessment scope", async () => {
    const assessmentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const factId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const evidenceId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const pins = {
      caseRevision: 1,
      legalPortfolioVersionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      repositorySnapshotId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      repositoryScanJobId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      repositoryCommit: "a".repeat(40),
    };
    const decision = ruleDecisionSchema.parse({
      caseRevision: pins.caseRevision,
      legalPortfolioVersionId: pins.legalPortfolioVersionId,
      repositorySnapshotId: pins.repositorySnapshotId,
      repositoryCommit: pins.repositoryCommit,
      engineeringRuleId: "ER-1",
      engineeringRuleVersion: "v1",
      scopeId: ASSESSMENT_DECISION_SCOPE,
      legalContextRefs: [{ legalContextId: "LR-1" }],
      applicability: RULE_DECISION_APPLICABILITIES.NOT_APPLICABLE,
      rationale: "The confirmed operator fact establishes scope.",
      references: [
        {
          type: RULE_DECISION_REFERENCE_TYPES.CONFIRMED_FACT,
          factId,
          caseRevision: 1,
        },
      ],
      criteria: [],
      compliance: null,
    });
    const facts = jest.fn<(args: unknown) => Promise<unknown[]>>().mockResolvedValue([
      {
        factId,
        state: ASSESSMENT_RECORD_STATES.ACCEPTED,
        caseRevision: 1,
        authority: ASSESSMENT_FACT_AUTHORITIES.EVIDENCE_CITED,
        evidenceLinks: [{ evidenceId }],
      },
    ]);
    const evidence = jest.fn<(args: unknown) => Promise<unknown[]>>().mockResolvedValue([
      {
        evidenceId,
        state: ASSESSMENT_RECORD_STATES.ACCEPTED,
        repositoryCommit: pins.repositoryCommit,
        type: ASSESSMENT_EVIDENCE_TYPES.SEARCH_COVERAGE,
        payload: {},
      },
    ]);
    const tx = {
      engineeringRule: { findUnique: () => Promise.resolve(null) },
      assessmentCaseFact: { findMany: facts },
      assessmentEvidence: { findMany: evidence },
    } as unknown as Prisma.TransactionClient;
    const context = await new AssessmentCaseSupport().buildValidationContext(
      tx,
      { assessmentId, pins, decision },
    );
    expect(facts).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assessmentId, factId: { in: [factId] } },
      }),
    );
    expect(evidence).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assessmentId, evidenceId: { in: [evidenceId] } },
      }),
    );
    expect(context.facts.get(factId)).toMatchObject({
      authority: ASSESSMENT_FACT_AUTHORITIES.EVIDENCE_CITED,
      evidenceIds: [evidenceId],
    });
    expect(context.evidence.get(evidenceId)).toMatchObject({
      type: ASSESSMENT_EVIDENCE_TYPES.SEARCH_COVERAGE,
      payload: {},
    });
  });
});
