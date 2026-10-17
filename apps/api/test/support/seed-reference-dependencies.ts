/** Test-only reconstruction. The bridge enforces an exact owned local DB before calling this. */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  Prisma,
  type PrismaClient,
  AgentExecutionState,
  SourceReviewState,
} from "@prisma/client";
import {
  CLAIM_PREPARATION_PHASES as P,
  type SourceReviewPayload,
} from "@lcsp/contracts/compliance-rule-set";
import {
  SOURCE_REVIEW_STATES as S,
  LEGAL_DOCUMENT_GRAPH,
  type LegalDocumentGraph,
} from "@lcsp/contracts/legal-source";
import {
  dependencyModel,
  modelHash,
  type ModelEdge,
} from "./reference-dependency-model.js";
import {
  canonicalClaimId,
  inventoryHash,
} from "../../src/modules/compliance-rule-set/domain/claim-inventory.js";
import {
  frontierDefinitionFingerprint,
  reviewItemStateFingerprint,
  xorReviewHash,
  zeroReviewAccumulator,
} from "../../src/modules/compliance-rule-set/domain/source-review-frontier.js";

export async function seedReferenceDependencies(
  db: PrismaClient,
  n = 2,
  edges: ModelEdge[] = [],
  retained = false,
) {
  const runId = randomUUID();
  const saved = retained
    ? (JSON.parse(
        readFileSync(
          new URL(
            "../../../../deepagents/tests/fixtures/retained-reference-deadlock.json",
            import.meta.url,
          ),
          "utf8",
        ),
      ) as {
        graph: LegalDocumentGraph;
        reviews: {
          sourceNodeId: string;
          state: string;
          ordinal?: number;
          payload: SourceReviewPayload;
          claimIds: string[];
          referenceIds?: string[];
          blockedReferenceIds: string[];
          disposition?: string;
          reason?: string;
        }[];
        chunks: Prisma.LegalDocumentChunkCreateManyInput[];
      })
    : null;
  const model = dependencyModel(n, edges);
  const graph: LegalDocumentGraph = saved
    ? saved.graph
    : structuredClone(model.graph);
  if (!saved) {
    graph.legalSourceVersionId = randomUUID();
    graph.materializationId = inventoryHash({
      source: graph.legalSourceVersionId,
      edges,
    });
    graph.nodes = graph.nodes.map((node) => ({
      ...node,
      legalSourceVersionId: graph.legalSourceVersionId,
      materializationId: graph.materializationId,
    }));
    graph.references = graph.references.map((ref) => ({
      ...ref,
      legalSourceVersionId: graph.legalSourceVersionId,
      materializationId: graph.materializationId,
    }));
    graph.retrievalUnits = graph.nodes.map((node) => ({
      unitId: modelHash(graph.materializationId + node.nodeId),
      legalDocumentNodeId: node.nodeId,
      ordinal: 0,
      contentStart: 0,
      contentEnd: node.content.length,
      content: node.content,
      contentSha256: modelHash(node.content),
    }));
    graph.chunkMappings = [];
  }
  const version = graph.legalSourceVersionId;
  const idMap: Record<string, string> = {};
  const original = (saved?.reviews ?? model.rows) as {
    sourceNodeId: string;
    state: string;
    ordinal?: number;
    payload: SourceReviewPayload;
    claimIds: string[];
    referenceIds?: string[];
    blockedReferenceIds: string[];
    disposition?: string;
    reason?: string;
  }[];
  const templates = original.map((row) => {
    const payload = structuredClone(row.payload);
    const identities: Record<string, string> = {};
    for (const claim of payload.claims) {
      const old = claim.claimId,
        key = payload.identities[old];
      claim.claimId = canonicalClaimId(runId, 1, claim.sourceNodeIds, key);
      claim.legalSourceVersionId = version;
      idMap[old] = claim.claimId;
      identities[claim.claimId] = key;
    }
    payload.identities = identities;
    return payload;
  });
  for (const payload of templates) {
    const relationMap: Record<string, string> = {};
    for (const relation of payload.relations) {
      const old = relation.relationId;
      relation.fromClaimId = idMap[relation.fromClaimId];
      relation.toClaimId = idMap[relation.toClaimId];
      relation.relationId = inventoryHash({
        fromClaimId: relation.fromClaimId,
        toClaimId: relation.toClaimId,
        kind: relation.kind,
        referenceId: relation.referenceId,
      });
      relationMap[old] = relation.relationId;
    }
    for (const accounting of payload.referenceAccounting)
      accounting.relationIds = accounting.relationIds.map(
        (id) => relationMap[id],
      );
  }
  await db.$transaction(
    async (tx) => {
      await tx.legalSourceVersion.upsert({
        where: { id: version },
        update: {},
        create: {
          id: version,
          version: "dependency-model-" + version,
          status: "DRAFT",
          sourceManifest: { synthetic: true },
        },
      });
      const doc = await tx.legalSourceDocument.upsert({
        where: {
          legalSourceVersionId_documentId: {
            legalSourceVersionId: version,
            documentId: graph.nodes[0].documentId,
          },
        },
        update: {},
        create: {
          legalSourceVersionId: version,
          documentId: graph.nodes[0].documentId,
          title: "Provider-free reference dependency fixture",
          sourceUrl: "https://example.invalid/reference-dependencies",
          sourceSha256: inventoryHash(graph.nodes),
          sourceEffectStatus: "IN_FORCE",
        },
      });
      await tx.legalDocumentMaterialization.upsert({
        where: { id: graph.materializationId },
        update: {},
        create: {
          id: graph.materializationId,
          legalSourceVersionId: version,
          parserRevision:
            graph.parserRevision ?? LEGAL_DOCUMENT_GRAPH.parserRevision,
          materializationRevision:
            graph.materializationRevision ??
            LEGAL_DOCUMENT_GRAPH.materializationRevision,
          sourceDigest: graph.sourceDigest ?? inventoryHash(graph.nodes),
          graphDigest: inventoryHash(graph),
          inputModes: graph.inputModes ?? [],
        },
      });
      await tx.legalDocumentNode.createMany({
        skipDuplicates: true,
        data: graph.nodes.map((node) => ({
          ...node,
          materializationId: graph.materializationId,
          legalSourceVersionId: version,
        })),
      });
      await tx.legalDocumentReference.createMany({
        skipDuplicates: true,
        data: graph.references.map((ref) => ({
          ...ref,
          materializationId: graph.materializationId,
          legalSourceVersionId: version,
        })),
      });
      await tx.legalDocumentRetrievalUnit.createMany({
        skipDuplicates: true,
        data: graph.retrievalUnits.map((unit) => ({
          ...unit,
          materializationId: graph.materializationId,
          legalSourceVersionId: version,
        })),
      });
      if (saved) {
        await tx.legalDocumentChunk.createMany({
          skipDuplicates: true,
          data: saved.chunks.map((chunk) => ({
            ...chunk,
            createdAt: new Date(String(chunk.createdAt)),
            legalSourceDocumentId: doc.id,
          })),
        });
        await tx.legalDocumentChunkNode.createMany({
          skipDuplicates: true,
          data: graph.chunkMappings.map((mapping) => ({
            ...mapping,
            materializationId: graph.materializationId,
            legalSourceVersionId: version,
          })),
        });
      }
      await tx.legalRetrievalIndex.create({
        data: {
          legalSourceVersionId: version,
          version: randomUUID(),
          status: "VALID",
          configHash: inventoryHash("dependency-model"),
          contentHash: inventoryHash(graph.nodes),
          validationManifestRef: "provider-free-fixture",
          validatedAt: new Date(),
        },
      });
      await tx.ruleSetPreparationRun.create({
        data: {
          id: runId,
          idempotencyKey: runId,
          legalSourceVersionId: version,
          requestedBy: "provider-free-dependency-model",
          correlationId: runId,
          claimDiscoveryOnly: true,
          executionState: AgentExecutionState.RUNNING,
          startedAt: new Date(),
          claimPhase: P.CLAIM_DISCOVERY,
        },
      });
      const items = original.map((row, ordinal) => {
        const payload = saved
          ? templates[ordinal]
          : {
              claims: [],
              identities: {},
              relations: [],
              referenceAccounting: [],
            };
        const item = {
          sourceNodeId: row.sourceNodeId,
          structuralPath: graph.nodes.find(
            (node) => node.nodeId === row.sourceNodeId,
          )!.structuralPath,
          ordinal: row.ordinal ?? ordinal,
          state: row.state as SourceReviewState,
          claimIds: saved ? row.claimIds.map((id) => idMap[id]) : [],
          ownedClaimCount: saved ? templates[ordinal].claims.length : 0,
          payload: payload as Prisma.InputJsonValue,
          blockedReferenceIds: row.blockedReferenceIds,
          referenceIds:
            row.referenceIds ??
            graph.references
              .filter((ref) => ref.fromNodeId === row.sourceNodeId)
              .map((ref) => ref.referenceId),
          completionFingerprint: saved ? inventoryHash(payload) : null,
          completedAt: row.state === S.REVIEWED_WITH_CLAIMS ? new Date() : null,
          reason: row.reason ?? null,
        };
        return { ...item, stateFingerprint: reviewItemStateFingerprint(item) };
      });
      const fingerprint = frontierDefinitionFingerprint(
        graph.materializationId,
        1,
        items.map((i) => i.sourceNodeId),
      );
      const stateAccumulator = items.reduce(
        (h, item) => xorReviewHash(h, item.stateFingerprint),
        zeroReviewAccumulator,
      );
      await tx.ruleSetPreparationReviewFrontier.create({
        data: {
          preparationRunId: runId,
          inventoryRevision: 1,
          materializationId: graph.materializationId,
          legalSourceVersionId: version,
          fingerprint,
          stateAccumulator,
          stateFingerprint: inventoryHash({
            fingerprint,
            accumulator: stateAccumulator,
          }),
          unitCount: items.length,
          pendingCount: items.filter((i) => i.state === S.PENDING).length,
          blockedCount: items.filter((i) => i.state === S.BLOCKED_REFERENCE)
            .length,
          reviewedWithClaimsCount: items.filter(
            (i) => i.state === S.REVIEWED_WITH_CLAIMS,
          ).length,
          persistedClaimCount: items.reduce(
            (sum, item) => sum + item.ownedClaimCount,
            0,
          ),
          items: { create: items },
        },
      });
    },
    { timeout: 30000 },
  );
  return {
    preparationRunId: runId,
    documentGraph: graph,
    chunks: saved?.chunks ?? [],
    templates,
    claimIds: idMap,
    initialStates: original.map((r) => r.state),
    edgeIntents: graph.references.map((r, i) => ({
      referenceId: r.referenceId,
      material: edges[i]?.material !== false,
    })),
  };
}
