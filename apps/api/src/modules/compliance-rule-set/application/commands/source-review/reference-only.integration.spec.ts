import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "@jest/globals";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { seedReferenceDependencies } from "../../../../../../test/support/seed-reference-dependencies.js";
import { LegalDocumentGraphService } from "../../../../legal-source/application/services/legal-document-graph.service.js";
import { SourceReviewHandler } from "./source-review.handler.js";
import { SourceReviewCommand } from "./source-review.command.js";
import { canonicalClaimId } from "../../../domain/claim-inventory.js";
import {
  SOURCE_REVIEW_ACTIONS as A,
  SOURCE_REVIEW_DISPOSITIONS as D,
  SOURCE_REVIEW_GAPS as G,
} from "@lcsp/contracts/legal-source";
import {
  COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES as O,
  type SourceReviewOperation,
} from "@lcsp/contracts/compliance-rule-set";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://unused/unused");
const database =
  url.hostname === "127.0.0.1" &&
  /^554(?:7[2-9]|[89]\d)$/u.test(url.port) &&
  url.pathname === "/lcsp_review_frontier_test"
    ? describe
    : describe.skip;
database("reference-only frontier on real PostgreSQL", () => {
  let db: PrismaService, handler: SourceReviewHandler;
  beforeAll(async () => {
    db = new PrismaService();
    await db.$connect();
    handler = new SourceReviewHandler(db, new LegalDocumentGraphService(db));
  });
  afterAll(async () => {
    await db.$disconnect();
  });
  async function setup() {
    const seed = await seedReferenceDependencies(
      db,
      2,
      [
        { from: 0, to: 1 },
        { from: 1, to: 0 },
      ],
      false,
      true,
    );
    const operationId = randomUUID();
    const invoke = (fields: Partial<SourceReviewOperation>) =>
      handler.execute(
        new SourceReviewCommand(
          {
            preparationRunId: seed.preparationRunId,
            inventoryRevision: 1,
            operationId,
            sourceRevision: seed.documentGraph.materializationId,
            frontierRevision: 1,
            action: A.INIT,
            ...fields,
          },
          "reference-only-test",
        ),
      );
    return {
      seed,
      invoke,
      a: seed.documentGraph.nodes[0],
      b: seed.documentGraph.nodes[1],
    };
  }
  it("INIT/EXPAND keep B out of the denominator and retain only A's reference", async () => {
    const { seed, invoke, a, b } = await setup();
    expect(await invoke({ action: A.INIT })).toMatchObject({
      outcome: O.PASSED,
      progress: { total: 1 },
    });
    const rows = await db.ruleSetPreparationSourceReview.findMany({
      where: { preparationRunId: seed.preparationRunId },
    });
    expect(rows.map((r) => r.sourceNodeId)).toEqual([a.nodeId]);
    expect(rows[0].referenceIds).toEqual([
      seed.documentGraph.references[0].referenceId,
    ]);
    expect(
      await invoke({
        action: A.EXPAND,
        sourceNodeId: a.nodeId,
        referenceIds: rows[0].referenceIds,
        reason: "Inspect reference context",
      }),
    ).toMatchObject({ outcome: O.PASSED, progress: { total: 1 } });
    expect(
      await db.ruleSetPreparationSourceReview.count({
        where: {
          preparationRunId: seed.preparationRunId,
          sourceNodeId: b.nodeId,
        },
      }),
    ).toBe(0);
  });
  it("rejects claims whose canonical anchors include a reference-only node before audit acceptance", async () => {
    const { seed, invoke, a, b } = await setup();
    await invoke({ action: A.INIT });
    const sourceNodeIds = [a.nodeId, b.nodeId],
      key = "forbidden";
    const claim = {
      ...seed.templates[0].claims[0],
      sourceNodeIds,
      claimId: canonicalClaimId(seed.preparationRunId, 1, sourceNodeIds, key),
    };
    const result = await invoke({
      action: A.COMPLETE,
      sourceNodeId: a.nodeId,
      disposition: D.CLAIMS_AUTHORED,
      claimIds: [claim.claimId],
      payload: {
        claims: [claim],
        identities: { [claim.claimId]: key },
        relations: [],
        referenceAccounting: [],
      },
    });
    expect(result).toMatchObject({
      outcome: O.FAILED,
      failures: [
        expect.objectContaining({
          code: G.BINDING,
          detail: expect.stringContaining("Reference-only"),
        }),
      ],
    });
  });
  it.each([D.NO_RELEVANT_SEMANTIC_CLAIMS, D.REQUIRES_REFERENCE_RESOLUTION])(
    "refuses reference-only target disposition %s with fixed-reason guidance",
    async (disposition) => {
      const { seed, invoke, a } = await setup();
      await invoke({ action: A.INIT });
      const result = await invoke({
        action: A.COMPLETE,
        sourceNodeId: a.nodeId,
        disposition,
        referenceIds:
          disposition === D.REQUIRES_REFERENCE_RESOLUTION
            ? [seed.documentGraph.references[0].referenceId]
            : [],
        reason: "No semantic claims",
        claimIds: [],
        payload: {
          claims: [],
          identities: {},
          relations: [],
          referenceAccounting: [
            {
              referenceId: seed.documentGraph.references[0].referenceId,
              material: false,
              relationIds: [],
              nonMaterialReason: "unreviewed",
            },
          ],
        },
      });
      expect(result).toMatchObject({
        outcome: O.FAILED,
        failures: [
          expect.objectContaining({
            code: G.REFERENCE,
            detail: expect.stringContaining("REFERENCE_ONLY_TARGET"),
          }),
        ],
      });
    },
  );
});
