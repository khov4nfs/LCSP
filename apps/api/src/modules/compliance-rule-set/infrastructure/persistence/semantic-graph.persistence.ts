import { Prisma } from "@prisma/client";
import type { LegalSemanticGraph } from "@lcsp/contracts/compliance-rule-set";
import {
  canonicalJson,
  sha256Hex,
} from "../../domain/compliance-rule-set-integrity.validator.js";

export const semanticGraphInclude = {
  claims: {
    orderBy: { ordinal: "asc" },
    include: { sources: { orderBy: { ordinal: "asc" } } },
  },
  relations: { orderBy: { ordinal: "asc" } },
} satisfies Prisma.LegalSemanticGraphInclude;

export function readSemanticGraph(
  graph: Prisma.LegalSemanticGraphGetPayload<{
    include: typeof semanticGraphInclude;
  }>,
) {
  return {
    contractVersion: graph.contractVersion,
    materializationId: graph.materializationId,
    legalSourceVersionId: graph.legalSourceVersionId,
    sourceAccounting: graph.sourceAccounting,
    referenceAccounting: graph.referenceAccounting,
    claims: graph.claims.map((claim) => ({
      claimId: claim.claimId,
      legalSourceVersionId: claim.legalSourceVersionId,
      sourceNodeIds: claim.sources.map((s) => s.sourceNodeId),
      claimType: claim.claimType,
      statement: claim.statement,
      operative: claim.operative,
      state: claim.state,
      nonOperativeReason: claim.nonOperativeReason,
    })),
    relations: graph.relations.map(
      ({ relationId, kind, fromClaimId, toClaimId, referenceId }) => ({
        relationId,
        kind,
        fromClaimId,
        toClaimId,
        referenceId,
      }),
    ),
  };
}

/** Same activation transaction as Requirements: no second writer or authority lifecycle. */
export async function writeSemanticGraph(
  tx: Prisma.TransactionClient,
  ruleSetVersionId: string,
  graph: LegalSemanticGraph,
) {
  await tx.legalSemanticGraph.create({
    data: {
      ruleSetVersionId,
      legalSourceVersionId: graph.legalSourceVersionId,
      materializationId: graph.materializationId,
      contractVersion: graph.contractVersion,
      sourceAccounting: graph.sourceAccounting,
      referenceAccounting: graph.referenceAccounting,
      graphDigest: sha256Hex(canonicalJson(graph)),
    },
  });
  await tx.legalSemanticClaim.createMany({
    data: graph.claims.map((claim, ordinal) => ({
      claimId: claim.claimId,
      ruleSetVersionId,
      materializationId: graph.materializationId,
      legalSourceVersionId: graph.legalSourceVersionId,
      claimType: claim.claimType,
      statement: claim.statement,
      operative: claim.operative ?? Prisma.DbNull,
      state: claim.state,
      nonOperativeReason: claim.nonOperativeReason,
      candidateFingerprint: sha256Hex(
        canonicalJson({
          ...claim,
          sourceNodeIds: [...claim.sourceNodeIds].sort(),
        }),
      ),
      ordinal,
    })),
  });
  await tx.legalSemanticClaimSource.createMany({
    data: graph.claims.flatMap((claim) =>
      claim.sourceNodeIds.map((sourceNodeId, ordinal) => ({
        claimId: claim.claimId,
        ruleSetVersionId,
        materializationId: graph.materializationId,
        legalSourceVersionId: graph.legalSourceVersionId,
        sourceNodeId,
        ordinal,
      })),
    ),
  });
  if (graph.relations.length)
    await tx.legalSemanticClaimRelation.createMany({
      data: graph.relations.map((relation, ordinal) => ({
        ...relation,
        ordinal,
        ruleSetVersionId,
        materializationId: graph.materializationId,
        legalSourceVersionId: graph.legalSourceVersionId,
      })),
    });
}
