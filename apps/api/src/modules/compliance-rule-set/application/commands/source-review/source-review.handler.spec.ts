import "reflect-metadata";
import { describe, expect, it, jest } from "@jest/globals";
import { AgentExecutionState, SourceReviewState } from "@prisma/client";
import {
  SOURCE_REVIEW_ACTIONS as A,
  SOURCE_REVIEW_DISPOSITIONS as D,
} from "@lcsp/contracts/legal-source";
import {
  CLAIM_PREPARATION_PHASES as P,
  COMPLIANCE_RULE_SET_FAILURE_CODES as F,
} from "@lcsp/contracts/compliance-rule-set";
import { SourceReviewHandler } from "./source-review.handler.js";
import { SourceReviewCommand } from "./source-review.command.js";
import { retainedBindingCase } from "../../../../../../test/support/retained-reference-binding-fixture.js";
import { inventoryHash } from "../../../domain/claim-inventory.js";
import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { LegalDocumentGraphService } from "../../../../legal-source/application/services/legal-document-graph.service.js";

describe("COMPLETE retained live payload persistence guard", () => {
  it("rejects before any write, including an idempotent replay of historical bad evidence", async () => {
    const { fixture, bad } = retainedBindingCase();
    const sourceReview = fixture.reviews.find(
      (r) =>
        r.sourceNodeId ===
        fixture.graph.references.find((r) => r.referenceId === bad.referenceId)!
          .fromNodeId,
    )!;
    const update = jest.fn();
    const tx = {
      $queryRaw: jest.fn(),
      ruleSetPreparationRun: {
        findUnique: () =>
          Promise.resolve({
            id: "a6a2e411-d6e6-423d-b124-5c4eb427fe38",
            claimInventoryRevision: 1,
            legalSourceVersionId: fixture.graph.legalSourceVersionId,
            executionState: AgentExecutionState.RUNNING,
            claimPhase: P.CLAIM_DISCOVERY,
          }),
      },
      ruleSetPreparationReviewFrontier: {
        findUnique: () =>
          Promise.resolve({
            materializationId: fixture.graph.materializationId,
            revision: 1,
          }),
      },
      ruleSetPreparationSourceReview: {
        findUnique: () =>
          Promise.resolve({
            ...sourceReview,
            state: SourceReviewState.REVIEWED_WITH_CLAIMS,
          }),
        findMany: () =>
          Promise.resolve(
            fixture.reviews
              .filter((r) => r !== sourceReview)
              .map((r) => ({
                ...r,
                preparationRunId: "a6a2e411-d6e6-423d-b124-5c4eb427fe38",
                inventoryRevision: 1,
                legalSourceVersionId: fixture.graph.legalSourceVersionId,
                materializationId: fixture.graph.materializationId,
                completionFingerprint: inventoryHash(r.payload),
                state: SourceReviewState.REVIEWED_WITH_CLAIMS,
              })),
          ),
        update,
      },
    };
    const handler = new SourceReviewHandler(
      {
        $transaction: (fn: (t: typeof tx) => unknown) =>
          Promise.resolve(fn(tx)),
      } as unknown as PrismaService,
      {
        export: () => Promise.resolve(fixture.graph),
      } as unknown as LegalDocumentGraphService,
    );
    const result = await handler.execute(
      new SourceReviewCommand(
        {
          action: A.COMPLETE,
          preparationRunId: "a6a2e411-d6e6-423d-b124-5c4eb427fe38",
          inventoryRevision: 1,
          operationId: "79680043-e61c-42d6-84b9-65d2dc612c07",
          sourceNodeId: sourceReview.sourceNodeId,
          payload: sourceReview.payload,
          disposition: D.CLAIMS_AUTHORED,
          claimIds: sourceReview.claimIds,
          sourceRevision: fixture.graph.materializationId,
          frontierRevision: 1,
        },
        "retained-provider-free-regression",
      ),
    );
    expect(result).toMatchObject({ code: F.SEMANTIC_DEPENDENCY_DETACHED });
    expect(result.targetClaimIds).toEqual([
      "12ff1db191f504d0aaca9f8fc0cd7088e2c3b2973aa8ec26b5726901e30b188a",
    ]);
    expect(update).not.toHaveBeenCalled();
  });
});
