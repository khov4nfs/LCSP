import { randomUUID } from "node:crypto";
import { describe, expect, it, jest } from "@jest/globals";
import {
  ASSESSMENT_ARTIFACT_KINDS,
  ASSESSMENT_DECISION_RECORD_STATES,
  ASSESSMENT_RECORD_STATES,
} from "@lcsp/contracts/assessment-domain";
import { ArtifactLifecycleState } from "@prisma/client";
import { AssessmentEvidenceInvalidation } from "./assessment-evidence-invalidation.service.js";

describe("AssessmentEvidenceInvalidation", () => {
  it("invalidates direct, indirect, and dependency-incomplete decisions but preserves unrelated complete decisions", async () => {
    const assessmentId = randomUUID();
    const evidenceId = randomUUID();
    const factId = randomUUID();
    const direct = {
      decisionId: randomUUID(),
      assessmentRuleId: "RULE-DIRECT",
    };
    const indirect = {
      decisionId: randomUUID(),
      assessmentRuleId: "RULE-INDIRECT",
    };
    const incomplete = {
      decisionId: randomUUID(),
      assessmentRuleId: "RULE-HISTORICAL",
    };
    const update = jest.fn<(args: unknown) => Promise<unknown>>((args) => {
      void args;
      return Promise.resolve({});
    });
    const coverageUpdate = jest.fn<(args: unknown) => Promise<unknown>>(
      (args) => {
        void args;
        return Promise.resolve({ count: 1 });
      },
    );
    const artifactUpdate = jest.fn<(args: unknown) => Promise<unknown>>(
      (args) => {
        void args;
        return Promise.resolve({ count: 1 });
      },
    );
    const findMany = jest.fn((args: { where: Record<string, unknown> }) => {
      if ("evidenceDependencies" in args.where)
        return Promise.resolve([direct]);
      if ("factDependencies" in args.where) return Promise.resolve([indirect]);
      if (args.where.dependencyGraphComplete === false)
        return Promise.resolve([incomplete]);
      return Promise.resolve([]);
    });
    const tx = {
      assessmentEvidence: {
        updateMany: jest.fn<(args: unknown) => Promise<unknown>>((args) => {
          void args;
          return Promise.resolve({ count: 1 });
        }),
      },
      assessmentCaseFactEvidence: {
        findMany: jest.fn(() => Promise.resolve([{ factId }])),
      },
      assessmentCaseFact: {
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
      },
      assessmentRuleDecision: { findMany, update },
      assessmentDecisionCoverage: { updateMany: coverageUpdate },
      assessmentArtifact: { updateMany: artifactUpdate },
    };

    const result =
      await new AssessmentEvidenceInvalidation().invalidateEvidenceInTx(
        tx as never,
        { assessmentId, evidenceId },
      );

    expect(new Set(result.invalidatedDecisionIds)).toEqual(
      new Set([direct.decisionId, indirect.decisionId, incomplete.decisionId]),
    );
    expect(update).toHaveBeenCalledTimes(3);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { decisionId: direct.decisionId },
        data: expect.objectContaining({
          state: ASSESSMENT_DECISION_RECORD_STATES.INVALIDATED,
        }),
      }),
    );
    expect(coverageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          assessmentId,
          currentDecisionId: indirect.decisionId,
        }),
      }),
    );
    expect(tx.assessmentEvidence.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          evidenceId,
          state: ASSESSMENT_RECORD_STATES.ACCEPTED,
        }),
      }),
    );
    expect(artifactUpdate).toHaveBeenCalledWith({
      where: {
        assessmentId,
        kind: ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT,
        lifecycleState: ArtifactLifecycleState.ACTIVE,
      },
      data: { lifecycleState: ArtifactLifecycleState.INVALID },
    });
  });

  it("keeps fail-closed case-wide invalidation for facts without a declared rule scope", async () => {
    const assessmentId = randomUUID();
    const decision = {
      decisionId: randomUUID(),
      assessmentRuleId: "RULE-UNKNOWN-IMPACT",
    };
    const tx = {
      assessmentRuleDecision: {
        findMany: jest.fn<(args: unknown) => Promise<unknown>>((args) => {
          void args;
          return Promise.resolve([decision]);
        }),
        update: jest.fn<(args: unknown) => Promise<unknown>>((args) => {
          void args;
          return Promise.resolve({});
        }),
      },
      assessmentDecisionCoverage: {
        updateMany: jest.fn<(args: unknown) => Promise<unknown>>((args) => {
          void args;
          return Promise.resolve({ count: 1 });
        }),
      },
      assessmentArtifact: {
        updateMany: jest.fn<(args: unknown) => Promise<unknown>>((args) => {
          void args;
          return Promise.resolve({ count: 1 });
        }),
      },
    };

    const ids =
      await new AssessmentEvidenceInvalidation().invalidateCaseRevisionInTx(
        tx as never,
        assessmentId,
        4,
      );

    expect(ids).toEqual([decision.decisionId]);
    expect(tx.assessmentRuleDecision.findMany).toHaveBeenCalledWith({
      where: {
        assessmentId,
        caseRevision: { lt: 4 },
        state: ASSESSMENT_DECISION_RECORD_STATES.ACCEPTED,
      },
      select: { decisionId: true, assessmentRuleId: true },
    });
    expect(tx.assessmentArtifact.updateMany).toHaveBeenCalledTimes(1);
  });
});
