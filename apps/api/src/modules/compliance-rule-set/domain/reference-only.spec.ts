import { createHash } from "node:crypto";
import { describe, expect, it } from "@jest/globals";
import {
  REFERENCE_ONLY_TARGET_REASON,
  LEGAL_REFERENCE_RESOLUTION_STATES as Resolution,
} from "@lcsp/contracts/legal-source";
import {
  COMPLIANCE_RULE_SET_FAILURE_CODES as F,
  LEGAL_SEMANTIC_RELATION_KINDS as Kinds,
  LEGAL_EFFECT_KINDS as EffectKinds,
  LEGAL_EFFECT_TARGET_SCOPES as Scopes,
} from "@lcsp/contracts/compliance-rule-set";
import {
  fixtureLegalSource,
  validPacket,
} from "../../../../test/support/compliance-rule-set-fixtures.js";
import { validateSemanticClaimGraph } from "./semantic-claim-integrity.validator.js";
import { validateComplianceRuleSetPacket } from "./compliance-rule-set-integrity.validator.js";
import {
  sourceReviewUnits,
  reviewReferenceOwners,
} from "./source-review-frontier.js";

function fixture() {
  const source = fixtureLegalSource(),
    packet = validPacket(),
    graph = source.documentGraph!,
    semantic = packet.semanticGraph!;
  const origin = graph.nodes.find((n) => n.content.trim())!;
  const b = {
    ...origin,
    nodeId: "b".repeat(64),
    documentId: "reference-only-b",
    parentNodeId: null,
    structuralPath: "/document/b/article/1",
  };
  graph.nodes.push(b);
  graph.retrievalUnits.push({
    unitId: "c".repeat(64),
    legalDocumentNodeId: b.nodeId,
    ordinal: 0,
    contentStart: 0,
    contentEnd: b.content.length,
    content: b.content,
    contentSha256: createHash("sha256").update(b.content).digest("hex"),
  });
  graph.referenceOnlyDocumentIds = [b.documentId];
  const ref = {
    referenceId: "d".repeat(64),
    fromNodeId: origin.nodeId,
    toNodeId: b.nodeId,
    text: "B",
    charStart: 0,
    charEnd: 1,
    resolutionState: Resolution.RESOLVED,
    candidateNodeIds: [],
  };
  graph.references.push(ref, {
    ...ref,
    referenceId: "e".repeat(64),
    fromNodeId: b.nodeId,
    toNodeId: origin.nodeId,
  });
  semantic.referenceAccounting.push({
    referenceId: ref.referenceId,
    material: false,
    relationIds: [],
    nonMaterialReason: REFERENCE_ONLY_TARGET_REASON,
  });
  return { source, packet, graph, semantic, b, ref };
}
describe("reference-only coverage and claim authority", () => {
  it("excludes reference-only nodes and outgoing references without losing the pinned graph", () => {
    const { source, packet, graph, b, ref } = fixture();
    expect(sourceReviewUnits(graph).some((n) => n.nodeId === b.nodeId)).toBe(
      false,
    );
    expect(reviewReferenceOwners(graph).get("e".repeat(64))).toBeNull();
    expect(reviewReferenceOwners(graph).get(ref.referenceId)).toBeTruthy();
    expect(validateSemanticClaimGraph(packet, source, true).failures).toEqual(
      [],
    );
  });
  it("requires the fixed non-material reason for a reviewed reference into B", () => {
    const { source, packet, semantic, ref } = fixture();
    semantic.referenceAccounting.find(
      (r) => r.referenceId === ref.referenceId,
    )!.nonMaterialReason = "invented exemption";
    expect(validateSemanticClaimGraph(packet, source, true).failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: F.INCOMPLETE_STRUCTURAL_ACCOUNTING,
          ref: `reference:${ref.referenceId}`,
        }),
      ]),
    );
  });
  it("refuses reference-only claim support even without a frontier binding", () => {
    const { source, packet, semantic, b } = fixture();
    const claim = {
      ...semantic.claims[0],
      claimId: "forbidden-b",
      sourceNodeIds: [b.nodeId],
    };
    semantic.claims.push(claim);
    const failures = validateSemanticClaimGraph(packet, source, true).failures;
    expect(failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: F.SEMANTIC_CLAIM_INVALID,
          ref: "claim:forbidden-b",
        }),
      ]),
    );
  });
  it("refuses support spans from B even when anchors name only A", () => {
    const { source, packet, semantic, b } = fixture();
    semantic.claims[0].sourceSupport![0].nodeId = b.nodeId;
    expect(validateSemanticClaimGraph(packet, source, true).failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: F.SEMANTIC_CLAIM_INVALID }),
      ]),
    );
  });

  it("excludes B from retrieval coverage and refuses Requirements citing its chunks", () => {
    const { source, packet, b } = fixture();
    const chunk = {
      ...source.chunks[0],
      id: "reference-b",
      documentId: b.documentId,
    };
    source.chunks.push(chunk);
    packet.legalRequirements[0].sourceRefs.push({
      documentId: chunk.documentId,
      locator: chunk.locator,
      contentSha256: chunk.contentSha256,
    });
    const result = validateComplianceRuleSetPacket(packet, source, () => false);
    expect(result.coverage.retrieval.total).toBe(source.chunks.length - 1);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: F.SEMANTIC_CLAIM_INVALID,
          detail:
            "Reference-only documents cannot support Requirements or AssessmentRules",
        }),
      ]),
    );
  });

  it("permits material reference accounting into B when backed by a valid definition relation", () => {
    const { source, packet, semantic, ref, b } = fixture();
    const defClaim = {
      claimId: "def-b-1",
      legalSourceVersionId: source.legalSourceVersionId,
      sourceNodeIds: [b.nodeId],
      claimType: "DEFINITION" as const,
      statement: "A definition from reference-only document B.",
      operative: null,
      state: "RELEVANT" as const,
      nonOperativeReason: null,
    };
    semantic.claims.push(defClaim);
    const relation = {
      relationId: "rel-def-b-1",
      fromClaimId: semantic.claims[0].claimId,
      toClaimId: defClaim.claimId,
      kind: Kinds.DEFINED_BY,
      referenceId: ref.referenceId,
    };
    semantic.relations.push(relation);
    const acc = semantic.referenceAccounting.find(
      (r) => r.referenceId === ref.referenceId,
    )!;
    acc.material = true;
    acc.relationIds = [relation.relationId];
    acc.nonMaterialReason = null;
    expect(validateSemanticClaimGraph(packet, source, true).failures).toEqual(
      [],
    );
  });

  it("permits material reference accounting into B when backed by a legal effect", () => {
    const { source, packet, semantic, ref, b } = fixture();
    const effectClaim = {
      ...semantic.claims[0],
      claimId: "effect-b-1",
      semanticFrame: {
        ...semantic.claims[0].semanticFrame!,
        legalEffect: {
          kind: EffectKinds.REPEALS,
          targets: [{ nodeId: b.nodeId, scope: Scopes.EXACT }],
          unresolvedTargets: [],
          effectiveFrom: "2026-01-01",
          effectiveUntil: null,
          conditions: null,
        },
      },
    };
    semantic.claims.push(effectClaim);
    semantic.sourceAccounting
      .find((a) => a.sourceNodeId === effectClaim.sourceNodeIds[0])
      ?.claimIds.push(effectClaim.claimId);
    const acc = semantic.referenceAccounting.find(
      (r) => r.referenceId === ref.referenceId,
    )!;
    acc.material = true;
    acc.relationIds = [];
    acc.nonMaterialReason = null;
    expect(validateSemanticClaimGraph(packet, source, true).failures).toEqual(
      [],
    );
  });

  it("refuses forged REFERENCE_ONLY_TARGET when target is not a reference-only node", () => {
    const { source, packet, graph, semantic, origin } = {
      ...fixture(),
      origin: fixture().source.documentGraph!.nodes.find((n) =>
        n.content.trim(),
      )!,
    };
    const nonRefOnlyRef = {
      referenceId: "9".repeat(64),
      fromNodeId: origin.nodeId,
      toNodeId: origin.nodeId,
      text: "Self",
      charStart: 0,
      charEnd: 4,
      resolutionState: Resolution.RESOLVED,
      candidateNodeIds: [],
    };
    graph.references.push(nonRefOnlyRef);
    semantic.referenceAccounting.push({
      referenceId: nonRefOnlyRef.referenceId,
      material: false,
      relationIds: [],
      nonMaterialReason: REFERENCE_ONLY_TARGET_REASON,
    });
    expect(validateSemanticClaimGraph(packet, source, true).failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: F.INCOMPLETE_STRUCTURAL_ACCOUNTING,
          ref: `reference:${nonRefOnlyRef.referenceId}`,
        }),
      ]),
    );
  });
});
