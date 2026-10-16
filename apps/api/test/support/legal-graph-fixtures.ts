import {
  LEGAL_CLAIM_ACCOUNTING_ROLES as ROLE,
  LEGAL_CLAIM_STATES as STATE,
  LEGAL_SEMANTIC_CLAIM_TYPES as C,
  LEGAL_SEMANTIC_GRAPH_VERSION,
  LEGAL_EVIDENCE_REQUEST_KINDS as E,
  type ComplianceRuleSetPacket,
  type LegalSemanticClaim,
  type LegalClaimBinding,
} from "@lcsp/contracts/compliance-rule-set";
import type { LegalDocumentGraph } from "@lcsp/contracts/legal-source";
import { buildLegalDocumentGraph } from "../../src/modules/legal-source/domain/document-graph.js";
import type { LegalSourceChunkSnapshot } from "../../src/modules/compliance-rule-set/domain/compliance-rule-set-integrity.validator.js";

export function fixtureDocumentGraph(
  version: string,
  chunks: LegalSourceChunkSnapshot[],
): LegalDocumentGraph {
  const documents = new Map<string, LegalSourceChunkSnapshot[]>();
  for (const c of chunks)
    documents.set(c.documentId, [...(documents.get(c.documentId) ?? []), c]);
  return buildLegalDocumentGraph(
    version,
    [...documents].map(([documentId, rows]) => ({
      documentId,
      title: "Synthetic",
      sourceSha256: "a".repeat(64),
      snapshotPath: null,
      extraction: null,
      chunks: rows.map((c) => ({
        ...c,
        content: `content ${c.locator}`,
        legalEffectStatus: c.legalEffectStatus,
        legalStatusSourceRef: c.legalStatusSourceRef,
        hierarchy: {},
        pageStart: null,
        pageEnd: null,
      })),
    })),
  );
}

/** Explicit synthetic authoring fixture, not an application legal interpreter. Never runs on legal text. */
export function authorFixtureClaims(
  packet: ComplianceRuleSetPacket,
  graph: LegalDocumentGraph,
  chunks: LegalSourceChunkSnapshot[],
) {
  const owners = new Map(
    graph.chunkMappings.map((m) => [m.chunkId, m.legalDocumentNodeId]),
  );
  const nodesByRef = new Map(
    chunks.map((c) => [`${c.documentId}::${c.locator}`, owners.get(c.id)!]),
  );
  const claims: LegalSemanticClaim[] = [];
  const firstClaim = new Map<string, string>();
  const sourceIds = (refs: { documentId: string; locator: string }[]) => [
    ...new Set(
      refs.flatMap((r) =>
        nodesByRef.get(`${r.documentId}::${r.locator}`)
          ? [nodesByRef.get(`${r.documentId}::${r.locator}`)!]
          : [],
      ),
    ),
  ];
  for (const requirement of packet.legalRequirements) {
    const bindings: LegalClaimBinding[] = [];
    const add = (
      claimType: LegalSemanticClaim["claimType"],
      role: LegalClaimBinding["role"],
      index: number,
      statement: string,
      operative: LegalSemanticClaim["operative"],
      nodeIds: string[],
    ) => {
      const claimId = `${requirement.legalRequirementId}.${role}.${index}`;
      claims.push({
        claimId,
        legalSourceVersionId: graph.legalSourceVersionId,
        sourceNodeIds: nodeIds,
        claimType,
        statement,
        operative,
        state: STATE.RELEVANT,
        nonOperativeReason: null,
      });
      bindings.push({ claimId, role, index });
      return claimId;
    };
    const statements: string[] = [];
    for (const [index, p] of (
      requirement.operativePropositions ?? []
    ).entries()) {
      const statement =
        index === 0
          ? requirement.proposition
          : `${p.actor}: ${p.modality}: ${p.action}`;
      statements.push(statement);
      const cid = add(
        p.modality,
        ROLE.OPERATIVE_PROPOSITION,
        index,
        statement,
        { actor: p.actor, modality: p.modality, action: p.action },
        sourceIds(p.sourceRefs),
      );
      if (index === 0) firstClaim.set(requirement.legalRequirementId, cid);
    }
    requirement.proposition = statements.join("\n");
    for (const [field, role, type] of [
      ["applicabilityConditions", ROLE.APPLICABILITY_CONDITION, C.CONDITION],
      ["qualifiers", ROLE.QUALIFIER, C.QUALIFIER],
      ["exceptions", ROLE.EXCEPTION, C.EXCEPTION],
    ] as const)
      for (const [index, statement] of requirement[field].entries())
        add(
          type,
          role,
          index,
          statement,
          null,
          sourceIds(requirement.sourceRefs),
        );
    requirement.semanticContext = [];
    for (const edge of packet.contextRelations.filter(
      (e) =>
        e.fromLegalRequirementId === requirement.legalRequirementId &&
        e.toSourceRef,
    )) {
      const source = edge.toSourceRef!;
      if (
        !requirement.sourceRefs.some(
          (r) =>
            r.documentId === source.documentId && r.locator === source.locator,
        )
      )
        requirement.sourceRefs.push(source);
      const index = requirement.semanticContext.length;
      const statement = `Synthetic ${edge.kind} context ${edge.relationId}`;
      requirement.semanticContext.push(statement);
      add(
        edge.kind === C.DEFINITION ? C.DEFINITION : C.CONTEXT,
        edge.kind === C.DEFINITION ? ROLE.DEFINITION : ROLE.CONTEXT,
        index,
        statement,
        null,
        sourceIds([source]),
      );
    }
    requirement.claimBindings = bindings;
  }
  packet.semanticGraph = {
    contractVersion: LEGAL_SEMANTIC_GRAPH_VERSION,
    legalSourceVersionId: graph.legalSourceVersionId,
    materializationId: graph.materializationId,
    claims,
    relations: packet.contextRelations.flatMap((edge) =>
      edge.toLegalRequirementId &&
      firstClaim.has(edge.fromLegalRequirementId) &&
      firstClaim.has(edge.toLegalRequirementId)
        ? [
            {
              relationId: edge.relationId,
              kind: edge.kind,
              fromClaimId: firstClaim.get(edge.fromLegalRequirementId)!,
              toClaimId: firstClaim.get(edge.toLegalRequirementId)!,
              referenceId: null,
            },
          ]
        : [],
    ),
    sourceAccounting: graph.nodes
      .filter((n) => n.content.trim())
      .map((n) => {
        const claimIds = claims
          .filter((c) => c.sourceNodeIds.includes(n.nodeId))
          .map((c) => c.claimId);
        return {
          sourceNodeId: n.nodeId,
          claimIds,
          nonSemanticReason: claimIds.length
            ? null
            : "Synthetic structural fixture: no additional relevant semantic claim",
        };
      }),
    referenceAccounting: graph.references.map((r) => ({
      referenceId: r.referenceId,
      material: false,
      relationIds: [],
      nonMaterialReason:
        "Synthetic structural reference with no semantic dependency in this fixture",
    })),
  };
  for (const rule of packet.assessmentRules) {
    rule.evidenceBindings = rule.criteria.map((c) => ({
      criterionId: c.criterionId,
      kind: E.REQUIRED,
    }));
    rule.requiredEvidence = [];
    rule.supportingEvidence = [];
    rule.negativeEvidence = [];
    rule.investigationGoals = [];
  }
  return packet;
}
