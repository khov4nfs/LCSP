import assert from "node:assert/strict";
import type { Prisma } from "@prisma/client";
import {
  semanticGraphInclude,
  readSemanticGraph,
} from "./semantic-graph.persistence.js";
import {
  canonicalJson,
  sha256Hex,
} from "../../domain/compliance-rule-set-integrity.validator.js";

export const reactivationTargetInclude = {
  activation: true,
  legalSourceVersion: true,
  preparationRun: {
    include: { claimInventories: { orderBy: { revision: "desc" }, take: 1 } },
  },
  semanticGraph: { include: semanticGraphInclude },
  rules: {
    orderBy: { ordinal: "asc" },
    include: {
      provenance: { orderBy: { ordinal: "asc" } },
      claimBindings: { orderBy: { ordinal: "asc" } },
    },
  },
  assessmentRules: {
    orderBy: { ordinal: "asc" },
    include: { legalRequirementLinks: true },
  },
  contextRelations: { orderBy: { ordinal: "asc" } },
} satisfies Prisma.ComplianceRuleSetVersionInclude;
type StoredRuleSet = Prisma.ComplianceRuleSetVersionGetPayload<{
  include: typeof reactivationTargetInclude;
}>;
type Chunk = Pick<
  Prisma.LegalDocumentChunkGetPayload<object>,
  "id" | "legalSourceVersionId" | "documentId" | "locator" | "contentSha256"
>;

/** Verify the accepted historical packet, without applying today's authoring/effect policy. */
export function storedRuleSetIntegrityValid(
  row: StoredRuleSet,
  chunks: Chunk[],
): boolean {
  try {
    assert(row.rules.length > 0 && row.assessmentRules.length > 0);
    const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
    const ruleKey = new Map(
      row.rules.map((rule) => [rule.id, rule.legalRequirementId]),
    );
    const hash = (value: unknown) => sha256Hex(canonicalJson(value));
    const inventory = row.preparationRun?.claimInventories[0];
    const semanticGraph = row.semanticGraph
      ? readSemanticGraph(row.semanticGraph)
      : null;
    if (semanticGraph) {
      assert(semanticGraph.legalSourceVersionId === row.legalSourceVersionId);
      assert(hash(semanticGraph) === row.semanticGraph!.graphDigest);
      for (const [index, claim] of semanticGraph.claims.entries())
        assert(
          hash({ ...claim, sourceNodeIds: [...claim.sourceNodeIds].sort() }) ===
            row.semanticGraph!.claims[index].candidateFingerprint,
        );
    }
    const source = (id: string) => {
      const chunk = byId.get(id);
      assert(chunk?.legalSourceVersionId === row.legalSourceVersionId);
      return {
        documentId: chunk.documentId,
        locator: chunk.locator,
        contentSha256: chunk.contentSha256,
      };
    };
    const legalRequirements = row.rules.map((rule, ordinal) => {
      assert(
        rule.ordinal === ordinal &&
          (semanticGraph || rule.provenance.length > 0),
      );
      const requirement = {
        legalRequirementId: rule.legalRequirementId,
        ...(inventory ? { claimInventoryRevision: inventory.revision } : {}),
        title: rule.title,
        proposition: rule.proposition,
        ...(semanticGraph
          ? {
              claimBindings: rule.claimBindings.map(
                ({ claimId, role, index }) => ({ claimId, role, index }),
              ),
            }
          : {}),
        ...(rule.semanticContext != null
          ? { semanticContext: rule.semanticContext }
          : {}),
        ...(rule.operativePropositions != null
          ? { operativePropositions: rule.operativePropositions }
          : {}),
        applicabilityConditions: rule.applicabilityConditions,
        qualifiers: rule.qualifiers,
        exceptions: rule.exceptions,
        nonRepositoryDuty: rule.nonRepositoryDuty,
        sourceRefs: rule.provenance.map((p) => {
          assert(p.legalSourceVersionId === row.legalSourceVersionId);
          const ref = {
            documentId: p.documentId,
            locator: p.locator,
            contentSha256: p.contentSha256,
          };
          assert.deepEqual(ref, source(p.chunkId));
          return ref;
        }),
        coverage: {
          state: rule.coverageState,
          nonAssessableReason: rule.nonAssessableReason,
        },
      };
      assert(hash(requirement) === rule.contentDigest);
      return requirement;
    });
    const assessmentRules = row.assessmentRules.map((rule, ordinal) => {
      assert(rule.ordinal === ordinal);
      const { sourceChunkIds, ...semantic } = rule.contract as Record<
        string,
        Prisma.JsonValue
      >;
      assert(
        Array.isArray(sourceChunkIds) &&
          (semanticGraph || sourceChunkIds.length > 0),
      );
      assert(
        sourceChunkIds.every((id): id is string => typeof id === "string"),
      );
      assert(semantic.assessmentRuleId === rule.assessmentRuleId);
      assert(
        semantic.concept === rule.concept &&
          semantic.legalIntent === rule.legalIntent,
      );
      assert(semantic.applicabilityGuidance === rule.applicabilityGuidance);
      assert(hash(semantic.criteria) === hash(rule.criteria));
      assert.deepEqual(
        rule.legalRequirementLinks
          .map((link) => ruleKey.get(link.legalRequirementRowId))
          .sort(),
        [...(semantic.legalRequirementIds as string[])].sort(),
      );
      const authored = { ...semantic, sourceRefs: sourceChunkIds.map(source) };
      assert(hash(authored) === rule.contentDigest);
      assert(
        hash({
          legalSource: row.legalSourceVersionId,
          chunks: sourceChunkIds
            .map((id) => `${id}:${byId.get(id)!.contentSha256}`)
            .sort(),
        }) === rule.sourceFingerprint,
      );
      return authored;
    });
    const contextRelations = row.contextRelations.map((relation, ordinal) => {
      assert(
        relation.ordinal === ordinal &&
          relation.legalSourceVersionId === row.legalSourceVersionId,
      );
      assert(ruleKey.has(relation.fromRuleId));
      assert(!relation.toRuleId || ruleKey.has(relation.toRuleId));
      const authored = {
        relationId: relation.relationId,
        kind: relation.kind,
        fromLegalRequirementId: ruleKey.get(relation.fromRuleId),
        toLegalRequirementId: relation.toRuleId
          ? ruleKey.get(relation.toRuleId)
          : null,
        toSourceRef: relation.toChunkId ? source(relation.toChunkId) : null,
      };
      assert(hash(authored) === relation.relationDigest);
      return authored;
    });
    return (
      hash({
        legalRequirements,
        assessmentRules,
        contextRelations,
        ...(semanticGraph ? { semanticGraph } : {}),
        ...(inventory
          ? {
              claimInventory: {
                revision: inventory.revision,
                fingerprint: inventory.fingerprint,
              },
            }
          : {}),
      }) === row.ruleSetDigest
    );
  } catch {
    return false;
  }
}
