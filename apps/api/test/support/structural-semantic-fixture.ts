/** Synthetic claim support and topology for deterministic validation. */
import {
  LEGAL_SEMANTIC_GRAPH_VERSION,
  LEGAL_SEMANTIC_AUTHORITIES as AUTH,
  LEGAL_ASSESSABILITIES as A,
  LEGAL_CLAIM_ACCOUNTING_ROLES as ROLE,
  LEGAL_SEMANTIC_RELATION_KINDS as R,
  LEGAL_SEMANTIC_CLAIM_TYPES as C,
  type ComplianceRuleSetPacket,
} from "@lcsp/contracts/compliance-rule-set";
import type { LegalDocumentGraph } from "@lcsp/contracts/legal-source";
import { createHash } from "node:crypto";
import { inventoryHash } from "../../src/modules/compliance-rule-set/domain/claim-inventory.js";
export function supportStructuralFixture(
  packet: ComplianceRuleSetPacket,
  source: LegalDocumentGraph,
) {
  const graph = packet.semanticGraph!;
  graph.contractVersion = LEGAL_SEMANTIC_GRAPH_VERSION;
  const claims = new Map(graph.claims.map((c) => [c.claimId, c]));
  for (const claim of claims.values()) {
    claim.sourceSupport = claim.sourceNodeIds.map((nodeId) => {
      const content = source.nodes.find((n) => n.nodeId === nodeId)!.content;
      return {
        nodeId,
        startOffset: 0,
        endOffset: content.length,
        contentSha256: createHash("sha256").update(content).digest("hex"),
      };
    });
    claim.semanticAuthority =
      claim.claimType === "DEFINITION"
        ? AUTH.DEFINITION
        : claim.operative
          ? AUTH.LEGAL_NORMATIVE
          : AUTH.CONTEXT;
    claim.assessability = claim.operative
      ? A.REPOSITORY_VERIFIABLE
      : A.NON_ASSESSABLE;
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
  for (const requirement of packet.legalRequirements) {
    const anchors = requirement.claimBindings!.filter(
      (b) => b.role === ROLE.OPERATIVE_PROPOSITION,
    );
    for (const anchor of anchors) {
      if (requirement.nonRepositoryDuty)
        claims.get(anchor.claimId)!.assessability = A.EXTERNAL_FULFILLMENT;
      for (const binding of requirement.claimBindings!) {
        if (binding.role === ROLE.OPERATIVE_PROPOSITION) continue;
        const claim = claims.get(binding.claimId)!;
        const kind =
          binding.role === ROLE.APPLICABILITY_CONDITION
            ? R.CONDITION_OF
            : binding.role === ROLE.QUALIFIER
              ? [C.TEMPORAL_RULE, C.TRANSITION_RULE].includes(
                  claim.claimType as never,
                )
                ? R.TEMPORALLY_APPLIES_TO
                : R.QUALIFIES
              : binding.role === ROLE.EXCEPTION
                ? R.EXCEPTION_TO
                : binding.role === ROLE.DEFINITION
                  ? R.DEFINED_BY
                  : R.INCORPORATES;
        if (
          [
            ROLE.APPLICABILITY_CONDITION,
            ROLE.QUALIFIER,
            ROLE.EXCEPTION,
          ].includes(binding.role as never)
        )
          claim.semanticAuthority = AUTH.LEGAL_NORMATIVE;
        const modifier = [
          R.CONDITION_OF,
          R.QUALIFIES,
          R.EXCEPTION_TO,
          R.TEMPORALLY_APPLIES_TO,
        ].includes(kind as never);
        const row = {
          fromClaimId: modifier ? binding.claimId : anchor.claimId,
          toClaimId: modifier ? anchor.claimId : binding.claimId,
          kind,
          referenceId: null,
        };
        graph.relations.push({ ...row, relationId: inventoryHash(row) });
      }
    }
  }
  graph.relations = [
    ...new Map(graph.relations.map((r) => [r.relationId, r])).values(),
  ];
}
