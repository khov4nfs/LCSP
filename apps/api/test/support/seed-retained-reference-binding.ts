/** Restore retained diagnostic evidence ONLY inside the bridge's exact isolated test database. */
import { randomUUID } from "node:crypto";
import {
  Prisma,
  type PrismaClient,
  AgentExecutionState,
  SourceReviewState,
} from "@prisma/client";
import {
  LEGAL_DOCUMENT_GRAPH,
  SOURCE_REVIEW_DISPOSITIONS as D,
} from "@lcsp/contracts/legal-source";
import { CLAIM_PREPARATION_PHASES as P } from "@lcsp/contracts/compliance-rule-set";
import { retainedBindingCase } from "./retained-reference-binding-fixture.js";
import {
  inventoryHash,
  canonicalClaimId,
} from "../../src/modules/compliance-rule-set/domain/claim-inventory.js";
import {
  frontierDefinitionFingerprint,
  reviewItemStateFingerprint,
  xorReviewHash,
  zeroReviewAccumulator,
} from "../../src/modules/compliance-rule-set/domain/source-review-frontier.js";

export async function seedRetainedReferenceBinding(db: PrismaClient) {
  if (
    !/^postgresql:\/\/postgres:[^@]+@127\.0\.0\.1:55449\/lcsp_review_frontier_test(?:\?schema=public)?$/u.test(
      process.env.DATABASE_URL ?? "",
    )
  )
    throw new Error(
      "Retained evidence seeding requires the exact isolated frontier test database",
    );
  const { fixture } = retainedBindingCase();
  // A fresh run necessarily has fresh canonical claim IDs; the retained source/reference pins stay exact.
  const runId = randomUUID();
  const claimIds: Record<string, string> = {};
  const relationIds: Record<string, string> = {};
  for (const review of fixture.reviews) {
    const identities: Record<string, string> = {};
    for (const claim of review.payload.claims) {
      const oldId = claim.claimId;
      const key = review.payload.identities[oldId];
      claim.claimId = canonicalClaimId(runId, 1, claim.sourceNodeIds, key);
      claimIds[oldId] = claim.claimId;
      identities[claim.claimId] = key;
    }
    review.payload.identities = identities;
    review.claimIds = review.claimIds.map((id) => claimIds[id]);
  }
  for (const review of fixture.reviews)
    for (const relation of review.payload.relations) {
      const oldId = relation.relationId;
      relation.fromClaimId = claimIds[relation.fromClaimId];
      relation.toClaimId = claimIds[relation.toClaimId];
      relation.relationId = inventoryHash({
        fromClaimId: relation.fromClaimId,
        toClaimId: relation.toClaimId,
        kind: relation.kind,
        referenceId: relation.referenceId,
      });
      relationIds[oldId] = relation.relationId;
    }
  for (const review of fixture.reviews)
    for (const row of review.payload.referenceAccounting)
      row.relationIds = row.relationIds.map((id) => relationIds[id]);
  const graph = fixture.graph;
  const legalSourceVersionId = graph.legalSourceVersionId;
  await db.$transaction(async (tx) => {
    await tx.legalSourceVersion.upsert({
      where: { id: legalSourceVersionId },
      update: {},
      create: {
        id: legalSourceVersionId,
        version: "retained-reference-binding-local-regression",
        status: "DRAFT",
        sourceManifest: { synthetic: true, retainedDiagnostic: runId },
      },
    });
    await tx.legalSourceDocument.upsert({
      where: {
        legalSourceVersionId_documentId: {
          legalSourceVersionId,
          documentId: "synthetic-discovery",
        },
      },
      update: {},
      create: {
        legalSourceVersionId,
        documentId: "synthetic-discovery",
        title: "Retained synthetic discovery fixture",
        sourceUrl: "https://example.invalid/retained-binding",
        sourceSha256: inventoryHash(graph.nodes),
        sourceEffectStatus: "IN_FORCE",
      },
    });
    await tx.legalDocumentMaterialization.upsert({
      where: { id: graph.materializationId },
      update: {},
      create: {
        id: graph.materializationId,
        legalSourceVersionId,
        parserRevision: LEGAL_DOCUMENT_GRAPH.parserRevision,
        materializationRevision: LEGAL_DOCUMENT_GRAPH.materializationRevision,
        sourceDigest: inventoryHash(graph.nodes),
        graphDigest: inventoryHash(graph),
        inputModes: [],
      },
    });
    await tx.legalDocumentNode.createMany({
      skipDuplicates: true,
      data: graph.nodes.map((n) => ({
        ...n,
        materializationId: graph.materializationId,
      })),
    });
    await tx.legalDocumentReference.createMany({
      skipDuplicates: true,
      data: graph.references.map((r) => ({
        ...r,
        materializationId: graph.materializationId,
        legalSourceVersionId,
      })),
    });
    await tx.legalDocumentRetrievalUnit.createMany({
      skipDuplicates: true,
      data: graph.retrievalUnits.map((u) => ({
        ...u,
        materializationId: graph.materializationId,
        legalSourceVersionId,
      })),
    });
    await tx.legalRetrievalIndex.create({
      data: {
        legalSourceVersionId,
        version: "retained-" + Date.now(),
        status: "VALID",
        configHash: inventoryHash("retained"),
        contentHash: inventoryHash(graph.nodes),
        validationManifestRef: "retained-provider-free-fixture",
        validatedAt: new Date(),
      },
    });
    await tx.ruleSetPreparationRun.create({
      data: {
        id: runId,
        idempotencyKey: runId,
        legalSourceVersionId,
        requestedBy: "retained-provider-free-regression",
        correlationId: runId,
        claimDiscoveryOnly: true,
        executionState: AgentExecutionState.RUNNING,
        startedAt: new Date(),
        claimPhase: P.CLAIM_DISCOVERY,
      },
    });
    const items = fixture.reviews.map((r, ordinal) => {
      const disposition = r.claimIds.length
        ? D.CLAIMS_AUTHORED
        : D.NO_RELEVANT_SEMANTIC_CLAIMS;
      const state = r.claimIds.length
        ? SourceReviewState.REVIEWED_WITH_CLAIMS
        : SourceReviewState.REVIEWED_NO_CLAIMS;
      const row = {
        sourceNodeId: r.sourceNodeId,
        structuralPath: graph.nodes.find((n) => n.nodeId === r.sourceNodeId)!
          .structuralPath,
        ordinal,
        state,
        disposition,
        claimIds: r.claimIds,
        ownedClaimCount: r.payload.claims.length,
        payload: r.payload as Prisma.InputJsonValue,
        reason: r.reason,
        referenceIds: graph.references
          .filter((ref) => ref.fromNodeId === r.sourceNodeId)
          .map((ref) => ref.referenceId),
        completedAt: new Date(),
      };
      return { ...row, stateFingerprint: reviewItemStateFingerprint(row) };
    });
    const fingerprint = frontierDefinitionFingerprint(
      graph.materializationId,
      1,
      items.map((i) => i.sourceNodeId),
    );
    const stateAccumulator = items.reduce(
      (hash, item) => xorReviewHash(hash, item.stateFingerprint),
      zeroReviewAccumulator,
    );
    await tx.ruleSetPreparationReviewFrontier.create({
      data: {
        preparationRunId: runId,
        inventoryRevision: 1,
        materializationId: graph.materializationId,
        legalSourceVersionId,
        fingerprint,
        stateAccumulator,
        stateFingerprint: inventoryHash({
          fingerprint,
          accumulator: stateAccumulator,
        }),
        unitCount: items.length,
        reviewedWithClaimsCount: items.filter((i) => i.claimIds.length).length,
        reviewedNoClaimsCount: items.filter((i) => !i.claimIds.length).length,
        persistedClaimCount: items.reduce((n, i) => n + i.ownedClaimCount, 0),
        items: {
          create: items,
        },
      },
    });
  });
  return {
    preparationRunId: runId,
    documentGraph: graph,
    chunks: [],
    claimIds,
    relationIds,
  };
}
