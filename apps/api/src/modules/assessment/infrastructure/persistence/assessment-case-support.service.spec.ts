import { randomUUID } from "node:crypto";
import { describe, expect, it, jest } from "@jest/globals";
import { Prisma } from "@prisma/client";
import {
  RULE_DECISION_APPLICABILITIES,
  RULE_DECISION_REFERENCE_TYPES,
  ruleDecisionSchema,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_DECISION_SCOPE,
  ASSESSMENT_DOMAIN_ERROR_CODES,
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
      ruleSetVersionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      repositorySnapshotId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      repositoryScanJobId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      repositoryCommit: "a".repeat(40),
      sourcePathPrefix: null,
    };
    const decision = ruleDecisionSchema.parse({
      caseRevision: pins.caseRevision,
      ruleSetVersionId: pins.ruleSetVersionId,
      repositorySnapshotId: pins.repositorySnapshotId,
      repositoryCommit: pins.repositoryCommit,
      assessmentRuleId: "ER-1",
      assessmentRuleVersion: "v1",
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
    const facts = jest
      .fn<(args: unknown) => Promise<unknown[]>>()
      .mockResolvedValue([
        {
          factId,
          state: ASSESSMENT_RECORD_STATES.ACCEPTED,
          caseRevision: 1,
          authority: ASSESSMENT_FACT_AUTHORITIES.EVIDENCE_CITED,
          evidenceLinks: [{ evidenceId }],
        },
      ]);
    const evidence = jest
      .fn<(args: unknown) => Promise<unknown[]>>()
      .mockResolvedValue([
        {
          evidenceId,
          state: ASSESSMENT_RECORD_STATES.ACCEPTED,
          repositoryCommit: pins.repositoryCommit,
          type: ASSESSMENT_EVIDENCE_TYPES.SEARCH_COVERAGE,
          payload: {},
        },
      ]);
    const tx = {
      assessmentRule: {
        findUnique: () =>
          Promise.resolve({
            assessmentRuleId: "ER-1",
            assessmentRuleVersion: "v1",
            criteria: [],
            legalRequirementLinks: [
              {
                legalRequirement: {
                  id: "lr-row",
                  legalRequirementId: "LR-1",
                  operativePropositions: [
                    { actor: "Source actor", action: "Source activity" },
                  ],
                  applicabilityConditions: [],
                  qualifiers: [],
                  exceptions: [],
                },
              },
            ],
          }),
      },
      legalRequirementContextRelation: { findMany: () => Promise.resolve([]) },
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
    expect(context.rule?.declaredElements.get("LR-1")).toEqual({
      applicabilityConditions: 0,
      qualifiers: 0,
      exceptions: 0,
      operativeScopes: 1,
    });
  });
});

describe("AssessmentCaseSupport immutable source pins", () => {
  const assessmentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const row = {
    assessmentId,
    caseRevision: 3,
    ruleSetVersionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    repositorySnapshotId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    repositoryScanJobId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    repositoryCommit: "a".repeat(40),
  };
  const snapshot = {
    id: row.repositorySnapshotId,
    assessmentId,
    commitSha: row.repositoryCommit,
    sourcePathPrefix: "chatbot",
  };

  it.each([
    null,
    { ...snapshot, id: "foreign-snapshot" },
    { ...snapshot, assessmentId: "foreign-assessment" },
    { ...snapshot, commitSha: "b".repeat(40) },
    { ...snapshot, sourcePathPrefix: "chatbot/../other" },
    { ...snapshot, sourcePathPrefix: undefined },
  ])(
    "fails closed for missing, inconsistent or ambiguous snapshot scope %#",
    async (value) => {
      const tx = {
        assessmentCase: { findUnique: () => Promise.resolve(row) },
        repositorySnapshot: { findFirst: () => Promise.resolve(value) },
      } as unknown as Prisma.TransactionClient;
      await expect(
        new AssessmentCaseSupport().loadPins(tx, assessmentId, "corr-scope"),
      ).rejects.toMatchObject({
        response: {
          problem: {
            code: ASSESSMENT_DOMAIN_ERROR_CODES.PINS_NOT_READY,
            status: 409,
          },
        },
      });
    },
  );

  it.each([null, "chatbot"])(
    "loads the exact assessment/commit snapshot and preserves prefix %s",
    async (sourcePathPrefix) => {
      const findFirst = jest
        .fn<(args: unknown) => Promise<unknown>>()
        .mockResolvedValue({ ...snapshot, sourcePathPrefix });
      const tx = {
        assessmentCase: { findUnique: () => Promise.resolve(row) },
        repositorySnapshot: { findFirst },
      } as unknown as Prisma.TransactionClient;
      const result = await new AssessmentCaseSupport().loadPins(
        tx,
        assessmentId,
        "corr-scope",
      );
      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: row.repositorySnapshotId,
            assessmentId,
            commitSha: {
              equals: row.repositoryCommit,
              mode: Prisma.QueryMode.insensitive,
            },
          },
        }),
      );
      expect(result).toMatchObject({
        repositorySnapshotId: row.repositorySnapshotId,
        repositoryCommit: row.repositoryCommit,
        sourcePathPrefix,
      });
    },
  );

  describe("advanceCoverageToResolved", () => {
    it("rejects transition from WAITING_FOR_INPUT with DECISION_REVISION_STALE", async () => {
      const update = jest.fn();
      const tx = {
        assessmentDecisionCoverage: { update },
      } as unknown as Prisma.TransactionClient;

      await expect(
        new AssessmentCaseSupport().advanceCoverageToResolved(tx, {
          assessmentId,
          assessmentRuleId: "ER-1",
          from: "WAITING_FOR_INPUT",
          decisionId: randomUUID(),
          decisionRevision: 1,
        }),
      ).rejects.toMatchObject({
        status: 409,
      });
      expect(update).not.toHaveBeenCalled();
    });

    it("steps through INVESTIGATING and advances to RESOLVED when from INVALIDATED", async () => {
      const update = jest.fn((_args?: unknown) => Promise.resolve({}));
      const tx = {
        assessmentDecisionCoverage: { update },
      } as unknown as Prisma.TransactionClient;
      const decisionId = randomUUID();

      await new AssessmentCaseSupport().advanceCoverageToResolved(tx, {
        assessmentId,
        assessmentRuleId: "ER-1",
        from: "INVALIDATED",
        decisionId,
        decisionRevision: 2,
      });

      expect(update).toHaveBeenCalledTimes(2);
      expect(update).toHaveBeenNthCalledWith(1, {
        where: {
          assessmentId_assessmentRuleId: {
            assessmentId,
            assessmentRuleId: "ER-1",
          },
        },
        data: { resolutionState: "INVESTIGATING" },
      });
      expect(update).toHaveBeenNthCalledWith(2, {
        where: {
          assessmentId_assessmentRuleId: {
            assessmentId,
            assessmentRuleId: "ER-1",
          },
        },
        data: {
          resolutionState: "RESOLVED",
          currentDecisionId: decisionId,
          decisionRevision: 2,
        },
      });
    });
  });
});
