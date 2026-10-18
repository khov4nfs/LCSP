/** Synthetic mechanical fixture receipts, not model entailment or retained-source semantic acceptance. */
import {
  LEGAL_SEMANTIC_GRAPH_VERSION,
  LEGAL_SEMANTIC_AUTHORITIES as AUTH,
  LEGAL_ASSESSABILITIES as A,
  LEGAL_CLAIM_ACCOUNTING_ROLES as ROLE,
  LEGAL_SEMANTIC_RELATION_KINDS as R,
  LEGAL_SEMANTIC_CLAIM_TYPES as C,
  SEMANTIC_AUDIT,
  SEMANTIC_AUDIT_VERDICTS as V,
  type ComplianceRuleSetPacket,
} from "@lcsp/contracts/compliance-rule-set";
import type { LegalDocumentGraph } from "@lcsp/contracts/legal-source";
import { createHash } from "node:crypto";
import { inventoryHash } from "../../src/modules/compliance-rule-set/domain/claim-inventory.js";
import {
  semanticAuditInput,
  semanticAuditIdentity,
  semanticCompletenessInput,
  semanticRelationBatches,
  semanticRelationInput,
} from "../../src/modules/compliance-rule-set/domain/semantic-audit.js";

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
              ? [C.TEMPORAL_RULE, C.TRANSITION_RULE].includes(claim.claimType as never)
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
        const modifier = [R.CONDITION_OF, R.QUALIFIES, R.EXCEPTION_TO, R.TEMPORALLY_APPLIES_TO].includes(
          kind as never,
        );
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
  refreshStructuralAudits(graph, source, 1);
}

export function structuralReceipt(
  input: ReturnType<typeof semanticAuditInput>,
) {
  const graph = { materializationId: input.sourceRevision };
  const review = { sourceNodeId: input.sourceNodeId };
  const hash = inventoryHash(input);
  return {
    schemaRevision: SEMANTIC_AUDIT.schemaRevision,
    sourceNodeId: review.sourceNodeId,
    sourceRevision: graph.materializationId,
    inventoryRevision: input.inventoryRevision,
    ...semanticAuditIdentity(input),
    verifierOperationId: `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`,
    verifierRole: SEMANTIC_AUDIT.role,
    verdict: V.SUPPORTED,
    reportedVerdict: V.SUPPORTED,
    gaps: [],
    assertions: input.claims.map((c) => ({
      id: c.claimId,
      fingerprint: inventoryHash(c),
      checks: {
        sourceSupport: V.SUPPORTED,
        actor: V.SUPPORTED,
        modality: V.SUPPORTED,
        action: V.SUPPORTED,
        scope: V.SUPPORTED,
        semanticAuthority: V.SUPPORTED,
        assessability: V.SUPPORTED,
      },
      verdict: V.SUPPORTED,
      gapCodes: [],
    })),
    relations: input.relations.map((r) => ({
      id: r.relationId,
      fingerprint: inventoryHash(r),
      checks: {
        kind: V.SUPPORTED,
        direction: V.SUPPORTED,
        target: V.SUPPORTED,
      },
      verdict: V.SUPPORTED,
      gapCodes: [],
    })),
    relationAudits: semanticRelationBatches(input).map((batch) => ({
      relationIds: batch.map((r) => r.relationId),
      inputFingerprint: inventoryHash(semanticRelationInput(input, batch)),
      verifierOperationId: `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`,
      verdict: V.SUPPORTED,
      gaps: [],
    })),
    completenessAudit: {
      inputFingerprint: inventoryHash(semanticCompletenessInput(input)),
      verifierOperationId: `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`,
      verdict: V.SUPPORTED,
      gaps: [],
    },
    auditedAt: "2026-10-18T00:00:00.000Z",
  };
}

export function refreshStructuralAudits(
  graph: NonNullable<ComplianceRuleSetPacket["semanticGraph"]>,
  source: LegalDocumentGraph,
  revision: number,
) {
  graph.semanticAudits = graph.sourceAccounting.map((r) =>
    structuralReceipt(
      semanticAuditInput(source, graph, r.sourceNodeId, revision),
    ),
  );
}
