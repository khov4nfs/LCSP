import "reflect-metadata";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  PrismaClient,
  AgentExecutionState,
  SourceReviewState,
} from "@prisma/client";
import {
  COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES as O,
  COMPLIANCE_RULE_SET_FAILURE_CODES as F,
  LEGAL_SEMANTIC_CLAIM_TYPES as C,
  LEGAL_SEMANTIC_AUTHORITIES as AUTH,
  LEGAL_ASSESSABILITIES as ASSESS,
  LEGAL_SEMANTIC_RELATION_KINDS as RK,
  type SourceReviewOperation,
  type UnitReviewCompletion,
} from "@lcsp/contracts/compliance-rule-set";
import {
  SOURCE_REVIEW_ACTIONS as A,
  SOURCE_REVIEW_DISPOSITIONS as D,
  SOURCE_REVIEW_GAPS as G,
} from "@lcsp/contracts/legal-source";
import { seedReferenceDependencies } from "../../../../../../test/support/seed-reference-dependencies.js";
import type { ModelEdge } from "../../../../../../test/support/reference-dependency-model.js";
import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { LegalDocumentGraphService } from "../../../../legal-source/application/services/legal-document-graph.service.js";
import { inventoryHash } from "../../../domain/claim-inventory.js";
import { claimEndpointFingerprint } from "../../../domain/reference-dependencies.js";
import { SourceReviewHandler } from "./source-review.handler.js";
import { SourceReviewCommand } from "./source-review.command.js";

const url = process.env.DATABASE_URL ?? "";
const disposable =
  /^postgresql:\/\/[^@]+@(localhost|127\.0\.0\.1):554\d\d\/lcsp_review_frontier_test(?:\?|$)/u.test(
    url,
  );
const database = disposable ? describe : describe.skip;

database("file COMPLETE PostgreSQL transaction", () => {
  let db: PrismaClient;
  let handler: SourceReviewHandler;
  beforeAll(async () => {
    db = new PrismaClient({ adapter: new PrismaPg(url) });
    await db.$connect();
    const service = db as unknown as PrismaService;
    handler = new SourceReviewHandler(
      service,
      new LegalDocumentGraphService(service),
    );
  });
  afterAll(async () => {
    await db?.$disconnect();
  });

  async function setup(edges: ModelEdge[] = []) {
    const seed = await seedReferenceDependencies(db, 2, edges);
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
            action: A.COMPLETE,
            ...fields,
          },
          "file-completion-test",
        ),
      );
    expect(await invoke({ action: A.INIT })).toMatchObject({
      outcome: O.PASSED,
    });
    const claims = seed.templates.flatMap((p) => p.claims);
    for (const claim of claims) {
      claim.sourceSupport = claim.sourceNodeIds.map((nodeId) => {
        const node = seed.documentGraph.nodes.find((n) => n.nodeId === nodeId)!;
        return {
          nodeId,
          startOffset: 0,
          endOffset: node.content.length,
          contentSha256: createHash("sha256")
            .update(node.content)
            .digest("hex"),
        };
      });
      claim.semanticAuthority = AUTH.DEFINITION;
      claim.assessability = ASSESS.NON_ASSESSABLE;
      claim.semanticFrame = {
        object: null,
        beneficiary: null,
        trigger: null,
        scope: null,
        qualifier: null,
        exception: null,
        temporalApplicability: null,
        repositoryObservableAspect: null,
        externalFulfillmentAspect: null,
      };
    }
    const batch: UnitReviewCompletion[] = seed.documentGraph.nodes.map(
      (node, i) => {
        const payload = seed.templates[i];
        const owned = new Set(payload.claims.map((c) => c.claimId));
        payload.relations = seed.documentGraph.references
          .filter((r) => r.fromNodeId === node.nodeId)
          .map((ref) => {
            const relation = {
              kind: RK.CROSS_REFERENCE,
              fromClaimId: payload.claims[0].claimId,
              toClaimId: claims.find((c) =>
                c.sourceNodeIds.includes(ref.toNodeId!),
              )!.claimId,
              referenceId: ref.referenceId,
            };
            return { ...relation, relationId: inventoryHash(relation) };
          });
        payload.referenceAccounting = payload.relations.map((r) => ({
          referenceId: r.referenceId!,
          material: true,
          relationIds: [r.relationId],
          nonMaterialReason: null,
        }));
        payload.dependencyFingerprints = Object.fromEntries(
          payload.relations
            .flatMap((r) => [r.fromClaimId, r.toClaimId])
            .filter((id) => !owned.has(id))
            .map((id) => [
              id,
              claimEndpointFingerprint(claims.find((c) => c.claimId === id)!),
            ]),
        );
        return {
          sourceNodeId: node.nodeId,
          disposition: D.CLAIMS_AUTHORED,
          claimIds: [...owned],
          payload,
        };
      },
    );
    const rows = () =>
      db.ruleSetPreparationSourceReview.findMany({
        where: { preparationRunId: seed.preparationRunId },
        orderBy: { ordinal: "asc" },
      });
    return { ...seed, operationId, invoke, batch, rows };
  }

  it("commits pending units directly and re-commits idempotently", async () => {
    const s = await setup();
    expect(
      (await s.rows()).every((r) => r.state === SourceReviewState.PENDING),
    ).toBe(true);
    expect(await s.invoke({ batch: s.batch })).toMatchObject({
      outcome: O.PASSED,
      completedCount: 2,
    });
    const before = await s.rows();
    expect(await s.invoke({ batch: s.batch })).toMatchObject({
      outcome: O.PASSED,
      completedCount: 2,
      alreadyCompleted: true,
    });
    expect(await s.rows()).toEqual(before);
    const frontier = await db.ruleSetPreparationReviewFrontier.findFirstOrThrow(
      { where: { preparationRunId: s.preparationRunId } },
    );
    expect(frontier).toMatchObject({
      pendingCount: 0,
      reviewedWithClaimsCount: 2,
      persistedClaimCount: 4,
    });
  });

  it("refuses a foreign operation, including idempotent replay", async () => {
    const s = await setup();
    expect(
      await s.invoke({ batch: s.batch, operationId: randomUUID() }),
    ).toMatchObject({ outcome: O.FAILED, failures: [{ code: G.LEASE }] });
    expect(await s.invoke({ batch: s.batch })).toMatchObject({
      outcome: O.PASSED,
    });
    expect(
      await s.invoke({ batch: s.batch, operationId: randomUUID() }),
    ).toMatchObject({ outcome: O.FAILED, failures: [{ code: G.LEASE }] });
  });
  it.each([{ frontierRevision: 2 }, { sourceRevision: "f".repeat(64) }])(
    "refuses stale revisions %j",
    async (stale) => {
      const s = await setup();
      expect(await s.invoke({ batch: s.batch, ...stale })).toMatchObject({
        outcome: O.FAILED,
        failures: [{ code: G.STALE }],
      });
      expect(
        (await s.rows()).every((r) => r.state === SourceReviewState.PENDING),
      ).toBe(true);
    },
  );
  it("refuses completion after the run pauses", async () => {
    const s = await setup();
    await db.ruleSetPreparationRun.update({
      where: { id: s.preparationRunId },
      data: { executionState: AgentExecutionState.PAUSED },
    });
    expect(await s.invoke({ batch: s.batch })).toMatchObject({
      outcome: O.FAILED,
      failures: [{ code: G.STALE }],
    });
  });
  it("commits circular references across articles together", async () => {
    const s = await setup([
      { from: 0, to: 1 },
      { from: 1, to: 0 },
    ]);
    expect(await s.invoke({ batch: s.batch })).toMatchObject({
      outcome: O.PASSED,
      completedCount: 2,
    });
    expect((await s.rows()).map((r) => r.state)).toEqual([
      SourceReviewState.REVIEWED_WITH_CLAIMS,
      SourceReviewState.REVIEWED_WITH_CLAIMS,
    ]);
  });
  it("takes over an expired lease, refuses an unexpired foreign lease", async () => {
    const s = await setup();
    await db.ruleSetPreparationReviewFrontier.updateMany({
      where: { preparationRunId: s.preparationRunId },
      data: { pendingCount: 0, inReviewCount: 2 },
    });
    await db.ruleSetPreparationSourceReview.updateMany({
      where: { preparationRunId: s.preparationRunId },
      data: {
        state: SourceReviewState.IN_REVIEW,
        operationId: randomUUID(),
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    expect(await s.invoke({ batch: s.batch })).toMatchObject({
      outcome: O.FAILED,
    });
    await db.ruleSetPreparationSourceReview.updateMany({
      where: { preparationRunId: s.preparationRunId },
      data: { leaseExpiresAt: new Date(Date.now() - 1000) },
    });
    expect(await s.invoke({ batch: s.batch })).toMatchObject({
      outcome: O.PASSED,
      completedCount: 2,
    });
  });
  it("keeps partial success, but a failed sibling cannot supply endpoint authority", async () => {
    const independent = await setup();
    independent.batch[1].payload.claims[0].sourceSupport![0].endOffset = 1_000_000;
    expect(
      await independent.invoke({ batch: independent.batch }),
    ).toMatchObject({
      outcome: O.PASSED,
      completedCount: 1,
      failures: [
        {
          sourceNodeId: independent.batch[1].sourceNodeId,
          failure: { failures: [{ code: F.SOURCE_SUPPORT_INVALID }] },
        },
      ],
    });
    const cycle = await setup([
      { from: 0, to: 1 },
      { from: 1, to: 0 },
    ]);
    cycle.batch[1].payload.claims[0].sourceSupport![0].endOffset = 1_000_000;
    expect(await cycle.invoke({ batch: cycle.batch })).toMatchObject({
      outcome: O.FAILED,
    });
    expect(
      (await cycle.rows()).every((r) => r.state === SourceReviewState.PENDING),
    ).toBe(true);
  });
  const invalidCompletions: {
    name: string;
    code: string;
    mutate: (unit: UnitReviewCompletion) => void;
  }[] = [
    {
      name: "canonical identity",
      code: G.BINDING,
      mutate: (u) => {
        u.payload.identities[u.payload.claims[0].claimId] = "forged-key";
      },
    },
    {
      name: "missing owned claim",
      code: G.BINDING,
      mutate: (u) => {
        u.claimIds = [];
      },
    },
    {
      name: "unbound linked claim",
      code: G.BINDING,
      mutate: (u) => {
        u.claimIds.push("unknown-claim");
      },
    },
    {
      name: "no-claim disposition",
      code: G.DISPOSITION,
      mutate: (u) => {
        u.disposition = D.NO_RELEVANT_SEMANTIC_CLAIMS;
        u.reason = "Incorrect no-claim assertion";
      },
    },
    {
      name: "context hides a duty",
      code: G.DISPOSITION,
      mutate: (u) => {
        u.disposition = D.CONTEXT_ONLY;
        u.payload.claims[0].claimType = C.DUTY;
      },
    },
    {
      name: "unsupported UTF-16 span",
      code: F.SOURCE_SUPPORT_INVALID,
      mutate: (u) => {
        u.payload.claims[0].sourceSupport![0].endOffset = 1_000_000;
      },
    },
    {
      name: "foreign reference",
      code: G.REFERENCE,
      mutate: (u) => {
        u.payload.referenceAccounting.push({
          referenceId: "f".repeat(64),
          material: false,
          relationIds: [],
          nonMaterialReason: "Foreign reference",
        });
      },
    },
    {
      name: "unknown endpoint",
      code: G.ENDPOINT,
      mutate: (u) => {
        u.payload.relations.push({
          relationId: "unknown-target",
          kind: RK.CROSS_REFERENCE,
          fromClaimId: u.claimIds[0],
          toClaimId: "unknown-claim",
          referenceId: null,
        });
      },
    },
    {
      name: "self relation",
      code: G.BINDING,
      mutate: (u) => {
        u.payload.relations.push({
          relationId: "self",
          kind: RK.CROSS_REFERENCE,
          fromClaimId: u.claimIds[0],
          toClaimId: u.claimIds[0],
          referenceId: null,
        });
      },
    },
  ];
  it.each(invalidCompletions)(
    "preserves the $name guard in partial batches",
    async ({ mutate, code }) => {
      const s = await setup();
      mutate(s.batch[0]);
      expect(await s.invoke({ batch: s.batch })).toMatchObject({
        outcome: O.PASSED,
        completedCount: 1,
        failures: [
          {
            sourceNodeId: s.batch[0].sourceNodeId,
            failure: { failures: [expect.objectContaining({ code })] },
          },
        ],
      });
      expect((await s.rows())[0].state).toBe(SourceReviewState.PENDING);
    },
  );
  it("also completes REOPENED units without a lease", async () => {
    const s = await setup();
    await db.ruleSetPreparationSourceReview.updateMany({
      where: { preparationRunId: s.preparationRunId },
      data: { state: SourceReviewState.REOPENED },
    });
    expect(await s.invoke({ batch: s.batch })).toMatchObject({
      outcome: O.PASSED,
      completedCount: 2,
    });
  });
  it("requires explicit reopening before replacing a completed payload", async () => {
    const s = await setup();
    expect(await s.invoke({ batch: s.batch })).toMatchObject({
      outcome: O.PASSED,
    });
    s.batch[0].payload.claims[0].statement = "Changed meaning";
    expect(await s.invoke({ batch: s.batch })).toMatchObject({
      outcome: O.PASSED,
      completedCount: 1,
      failures: [
        { failure: { failures: [expect.objectContaining({ code: G.LEASE })] } },
      ],
    });
  });

  it("applies single-unit reference and disposition guards to batch completion", async () => {
    const s = await setup([{ from: 0, to: 1 }]);
    s.batch[0].payload.referenceAccounting = [];
    s.batch[0].payload.relations = [];
    expect(await s.invoke({ batch: s.batch })).toMatchObject({
      outcome: O.PASSED,
      completedCount: 1,
      failures: expect.arrayContaining([
        {
          sourceNodeId: s.batch[0].sourceNodeId,
          failure: expect.objectContaining({
            failures: [
              {
                code: G.REFERENCE,
                ref: s.documentGraph.references[0].referenceId,
                detail: expect.any(String),
              },
            ],
          }),
        },
      ]),
    });
    const rows = await s.rows();
    expect(rows[0].state).toBe(SourceReviewState.PENDING);
    expect(rows[0].payload).toMatchObject({
      claims: [],
      relations: [],
      referenceAccounting: [],
    });
    expect(rows[1].state).toBe(SourceReviewState.REVIEWED_WITH_CLAIMS);
  });
});
