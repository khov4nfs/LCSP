import { describe, expect, it } from "@jest/globals";
import {
  COMPLIANCE_RULE_SET_FAILURE_CODES as F,
  LEGAL_SEMANTIC_CLAIM_TYPES as C,
  LEGAL_CLAIM_ACCOUNTING_ROLES as ROLE,
  LEGAL_CLAIM_STATES as STATE,
  LEGAL_CONTEXT_RELATION_KINDS as REL,
  type ComplianceRuleSetPacket,
  complianceRuleSetPacketSchema,
  legalSemanticGraphSchema,
  LEGAL_REQUIREMENT_COVERAGE_STATES as COVERAGE,
} from "@lcsp/contracts/compliance-rule-set";
import { LEGAL_REFERENCE_RESOLUTION_STATES as R } from "@lcsp/contracts/legal-source";
import { supportStructuralFixture, refreshStructuralAudits } from "../../../../test/support/structural-semantic-fixture.js";
import { validateSemanticClaimGraph } from "./semantic-claim-integrity.validator.js";
import {
  authorFixtureClaims,
  fixtureDocumentGraph,
} from "../../../../test/support/legal-graph-fixtures.js";
import {
  fixtureLegalSource,
  validPacket,
  withDerivedAssessmentSemantics,
} from "../../../../test/support/compliance-rule-set-fixtures.js";
import {
  semanticStressPacket,
  semanticStressSource,
} from "../../../../test/support/semantic-stress-fixtures.js";
import { validateComplianceRuleSetPacket } from "./compliance-rule-set-integrity.validator.js";
const validate = (
  packet: ComplianceRuleSetPacket,
  source = fixtureLegalSource(),
) => validateComplianceRuleSetPacket(packet, source, () => false);

describe("Completion Gate V2: Agent-authored claims, exact accounting and downstream authority", () => {
  it("accepts canonical claim provenance without legacy chunk citations and still rejects unknown effect", () => {
    const source = fixtureLegalSource(),
      packet = validPacket();
    source.chunks = [];
    source.documentGraph!.chunkMappings = [];
    packet.legalRequirements.forEach((r) => {
      r.sourceRefs = [];
      r.operativePropositions!.forEach((p) => {
        p.sourceRefs = [];
      });
    });
    packet.assessmentRules.forEach((r) => {
      r.sourceRefs = [];
    });
    packet.contextRelations = packet.contextRelations.filter(
      (r) => !r.toSourceRef,
    );
    const rendered = complianceRuleSetPacketSchema.parse({
      ...packet,
      assessmentRules: packet.assessmentRules.map((r) => ({
        ...r,
        legalIntent: undefined,
        applicabilityGuidance: undefined,
        contextRelationIds: undefined,
        requiredEvidence: [],
        supportingEvidence: [],
        negativeEvidence: [],
        investigationGoals: [],
        criteria: r.criteria.map((c) => ({ ...c, statement: undefined })),
      })),
    });
    expect(validate(rendered, source).failures).toEqual([]);
    const nodeId = packet.semanticGraph!.claims[0].sourceNodeIds[0];
    source.documentGraph!.nodes.find(
      (n) => n.nodeId === nodeId,
    )!.legalEffectStatus = "UNKNOWN";
    expect(
      validate(rendered, source).failures.some(
        (f) => f.code === F.UNDETERMINED_SOURCE_STATUS,
      ),
    ).toBe(true);
  });
  it.each([C.DUTY, C.PROHIBITION, C.PERMISSION])(
    "accepts explicit %s with actor/modality/action authority",
    (modality) => {
      const packet = validPacket();
      packet.legalRequirements[0].operativePropositions![0].modality = modality;
      expect(validate(withDerivedAssessmentSemantics(packet)).failures).toEqual(
        [],
      );
    },
  );
  it.each([
    C.DEFINITION,
    C.CONDITION,
    C.SCOPE,
    C.QUALIFIER,
    C.EXCEPTION,
    C.TEMPORAL_RULE,
    C.TRANSITION_RULE,
    C.CROSS_REFERENCE,
    C.CONTEXT,
  ])("accounts for %s without the parser classifying legal meaning", (type) => {
    const packet = validPacket(),
      parent = packet.legalRequirements[0];
    const role =
      type === C.DEFINITION
        ? ROLE.DEFINITION
        : [C.CONDITION, C.SCOPE].includes(type as typeof C.CONDITION)
          ? ROLE.APPLICABILITY_CONDITION
          : [C.QUALIFIER, C.TEMPORAL_RULE, C.TRANSITION_RULE].includes(
                type as typeof C.QUALIFIER,
              )
            ? ROLE.QUALIFIER
            : type === C.EXCEPTION
              ? ROLE.EXCEPTION
              : ROLE.CONTEXT;
    const field =
      role === ROLE.APPLICABILITY_CONDITION
        ? "applicabilityConditions"
        : role === ROLE.QUALIFIER
          ? "qualifiers"
          : role === ROLE.EXCEPTION
            ? "exceptions"
            : "semanticContext";
    parent[field] ??= [];
    const index = parent[field].length;
    const statement = `Synthetic ${type} claim`;
    parent[field].push(statement);
    const semantic = packet.semanticGraph!;
    const sourceNodeIds = semantic.claims[0].sourceNodeIds;
    semantic.claims.push({
      claimId: "claim-extra",
      legalSourceVersionId: semantic.legalSourceVersionId,
      sourceNodeIds,
      claimType: type,
      statement,
      operative: null,
      state: STATE.RELEVANT,
      nonOperativeReason: null,
    });
    parent.claimBindings!.push({ claimId: "claim-extra", role, index });
    for (const inspection of semantic.sourceAccounting)
      if (sourceNodeIds.includes(inspection.sourceNodeId))
        inspection.claimIds.push("claim-extra");
    // Re-render only downstream derived text; the authored claim/binding stays intact.
    const rendered = complianceRuleSetPacketSchema.parse({
      ...packet,
      assessmentRules: packet.assessmentRules.map((rule) => ({
        ...rule,
        legalIntent: undefined,
        applicabilityGuidance: undefined,
        contextRelationIds: undefined,
        criteria: rule.criteria.map((c) => ({ ...c, statement: undefined })),
        requiredEvidence: [],
        supportingEvidence: [],
        negativeEvidence: [],
        investigationGoals: [],
      })),
    });
    packet.assessmentRules = rendered.assessmentRules;
    // The V3 gate requires explicit typed closure edges and fresh audit receipts.
    // This is only a synthetic structural role-matrix test, not source entailment.
    supportStructuralFixture(packet, fixtureLegalSource().documentGraph!);
    expect(validate(packet).failures).toEqual([]);
  });
  it("distinguishes multiple claims in one node and one claim spanning related nodes", () => {
    const packet = validPacket();
    const claim = packet.semanticGraph!.claims.find(
      (c) => c.claimId === "LR-RET.OPERATIVE_PROPOSITION.0",
    )!;
    expect(claim.sourceNodeIds).toHaveLength(2);
    const node = packet.semanticGraph!.sourceAccounting.find(
      (n) => n.sourceNodeId === claim.sourceNodeIds[0],
    )!;
    expect(node.claimIds.length).toBeGreaterThan(1);
    const result = validate(packet);
    expect(result.failures).toEqual([]);
    expect(result.coverage.semanticClaims.relevant).toBe(
      result.coverage.semanticClaims.accounted,
    );
    expect(result.coverage.retrieval.total).toBeGreaterThan(
      result.coverage.semanticClaims.relevant,
    );
  });
  it("TEMPORAL_TRANSITION: an authored transition cannot disappear from Requirement accounting", () => {
    const packet = semanticStressPacket();
    const claim = packet.semanticGraph!.claims.find(
      (c) => c.claimId === "LR-DIRECT.QUALIFIER.0",
    )!;
    claim.claimType = C.TRANSITION_RULE;
    // The old generic QUALIFIES relation is not a valid V3 temporal target.
    packet.semanticGraph!.relations = packet.semanticGraph!.relations.filter(
      (r) => !(r.fromClaimId === claim.claimId && r.kind === "QUALIFIES"),
    );
    supportStructuralFixture(packet, semanticStressSource().documentGraph!);
    expect(validate(packet, semanticStressSource()).failures).toEqual([]);
    packet.legalRequirements[0].claimBindings =
      packet.legalRequirements[0].claimBindings!.filter(
        (b) => b.claimId !== claim.claimId,
      );
    expect(validate(packet, semanticStressSource()).failures).toContainEqual(
      expect.objectContaining({
        code: F.UNACCOUNTED_SEMANTIC_CLAIM,
        ref: `claim:${claim.claimId}`,
      }),
    );
  });
  it("MIXED_CONTEXT: context accounting cannot hide an operative claim in the same node", () => {
    const packet = validPacket(),
      semantic = packet.semanticGraph!,
      duty = semantic.claims[0];
    const contextClaim = {
      ...duty,
      claimId: "same-node-context",
      claimType: C.CONTEXT,
      operative: null,
      statement: "Context in the same node",
    };
    semantic.claims.push(contextClaim);
    for (const n of semantic.sourceAccounting)
      if (contextClaim.sourceNodeIds.includes(n.sourceNodeId))
        n.claimIds.push(contextClaim.claimId);
    const parent = packet.legalRequirements[0];
    parent.semanticContext = [contextClaim.statement];
    parent.claimBindings = [
      { claimId: contextClaim.claimId, role: ROLE.CONTEXT, index: 0 },
    ];
    expect(validate(packet).failures).toContainEqual(
      expect.objectContaining({
        code: F.UNACCOUNTED_SEMANTIC_CLAIM,
        ref: `claim:${duty.claimId}`,
      }),
    );
  });
  it("PLACEHOLDER: all source hashes may resolve while normative claims remain unaccounted", () => {
    const packet = validPacket();
    packet.legalRequirements.forEach((r) => {
      r.claimBindings = [];
    });
    const result = validate(packet);
    expect(result.resolved.size).toBeGreaterThan(0);
    expect(result.coverage.semanticClaims.accounted).toBe(0);
    expect(
      result.failures.some((f) => f.code === F.UNACCOUNTED_SEMANTIC_CLAIM),
    ).toBe(true);
  });
  it("cannot erase one distinct claim statement by binding two claims to the same proposition slot", () => {
    const packet = validPacket(),
      graph = packet.semanticGraph!,
      original = graph.claims[0];
    const other = {
      ...structuredClone(original),
      claimId: "distinct-statement",
      statement: "A second distinct operative statement",
    };
    graph.claims.push(other);
    for (const n of graph.sourceAccounting)
      if (other.sourceNodeIds.includes(n.sourceNodeId))
        n.claimIds.push(other.claimId);
    packet.legalRequirements[0].claimBindings!.push({
      claimId: other.claimId,
      role: ROLE.OPERATIVE_PROPOSITION,
      index: 0,
    });
    expect(
      validate(packet).failures.some(
        (f) => f.code === F.CLAIM_REQUIREMENT_MISMATCH,
      ),
    ).toBe(true);
  });
  it("rejects unsupported mandatory blocking/unblocking evidence for a conditional permission", () => {
    const packet = validPacket();
    packet.legalRequirements[0].operativePropositions![0].modality =
      C.PERMISSION;
    packet.legalRequirements[0].applicabilityConditions = [
      "Only while condition C holds",
    ];
    const good = withDerivedAssessmentSemantics(packet);
    expect(validate(good).failures).toEqual([]);
    good.assessmentRules[0].requiredEvidence = [
      "The system MUST automatically block and automatically unblock access",
    ];
    expect(validate(good).failures).toContainEqual(
      expect.objectContaining({
        code: F.DOWNSTREAM_AUTHORITY_MISMATCH,
        ref: "assessmentRule:ER-DEF|field:requiredEvidence",
      }),
    );
  });
  it("preserves legitimate non-normative implementation suggestions/narrowing", () => {
    const packet = validPacket();
    packet.assessmentRules[0].criteria[0].investigationFocus =
      "Optional example: inspect the chosen repository storage surface";
    packet.assessmentRules[0].patterns = [
      "Optional implementation search pattern",
    ];
    expect(validate(packet).failures).toEqual([]);
  });
  it.each([
    [
      "binding removed",
      (p: ComplianceRuleSetPacket) => {
        p.legalRequirements[0].claimBindings!.shift();
      },
    ],
    [
      "DUTY converted to context accounting",
      (p: ComplianceRuleSetPacket) => {
        p.legalRequirements[0].claimBindings![0].role = ROLE.CONTEXT;
      },
    ],
    [
      "actor reversed",
      (p: ComplianceRuleSetPacket) => {
        p.legalRequirements[0].operativePropositions![0].actor =
          "The opposite actor";
      },
    ],
    [
      "modality flipped",
      (p: ComplianceRuleSetPacket) => {
        p.legalRequirements[0].operativePropositions![0].modality =
          C.PROHIBITION;
      },
    ],
    [
      "source version changed",
      (p: ComplianceRuleSetPacket) => {
        p.semanticGraph!.claims[0].legalSourceVersionId =
          "00000000-0000-4000-8000-000000000099";
      },
    ],
    [
      "source inspection dropped",
      (p: ComplianceRuleSetPacket) => {
        p.semanticGraph!.sourceAccounting.pop();
      },
    ],
    [
      "unsupported supporting evidence",
      (p: ComplianceRuleSetPacket) => {
        p.assessmentRules[0].supportingEvidence.push(
          "An additional mandatory capability",
        );
      },
    ],
  ])("metamorphic mutation rejected: %s", (_name, mutate) => {
    const packet = validPacket();
    expect(validate(packet).failures).toEqual([]);
    mutate(packet);
    expect(validate(packet).failures.length).toBeGreaterThan(0);
  });
  it("keeps explicit resolved dependency direction and rejects reversal or material unresolved references", () => {
    const source = fixtureLegalSource(),
      packet = validPacket();
    packet.contextRelations.push({
      relationId: "EXPLICIT-DEPENDENCY",
      kind: REL.CROSS_REFERENCE,
      fromLegalRequirementId: "LR-RET",
      toLegalRequirementId: "LR-XREF",
      toSourceRef: null,
    });
    const good = withDerivedAssessmentSemantics(packet);
    const from = good.semanticGraph!.claims.find(
      (c) => c.claimId === "LR-RET.OPERATIVE_PROPOSITION.0",
    )!;
    const to = good.semanticGraph!.claims.find(
      (c) => c.claimId === "LR-XREF.OPERATIVE_PROPOSITION.0",
    )!;
    const referenceId = "e".repeat(64);
    source.documentGraph!.references.push({
      referenceId,
      fromNodeId: from.sourceNodeIds[0],
      toNodeId: to.sourceNodeIds[0],
      text: "Article reference",
      charStart: 0,
      charEnd: 17,
      resolutionState: R.RESOLVED,
      candidateNodeIds: [to.sourceNodeIds[0]],
    });
    const relation = good.semanticGraph!.relations.find(
      (r) => r.relationId === "EXPLICIT-DEPENDENCY",
    )!;
    relation.referenceId = referenceId;
    good.semanticGraph!.referenceAccounting.push({
      referenceId,
      material: true,
      relationIds: [relation.relationId],
      nonMaterialReason: null,
    });
    // The synthetic source reference changed the audit evidence neighborhood.
    refreshStructuralAudits(good.semanticGraph!, source.documentGraph!, 1);
    expect(validate(good, source).failures).toEqual([]);
    const bad = structuredClone(good),
      reversed = bad.semanticGraph!.relations.find(
        (r) => r.relationId === relation.relationId,
      )!;
    [reversed.fromClaimId, reversed.toClaimId] = [
      reversed.toClaimId,
      reversed.fromClaimId,
    ];
    expect(
      validate(bad, source).failures.some(
        (f) => f.code === F.SEMANTIC_DEPENDENCY_DETACHED,
      ),
    ).toBe(true);
    const wrongKind = structuredClone(good);
    wrongKind.contextRelations.find(
      (r) => r.relationId === relation.relationId,
    )!.kind = REL.DEFINITION;
    expect(
      validate(wrongKind, source).failures.some(
        (f) => f.code === F.SEMANTIC_DEPENDENCY_DETACHED,
      ),
    ).toBe(true);
    source.documentGraph!.references[0].resolutionState = R.UNRESOLVED;
    source.documentGraph!.references[0].toNodeId = null;
    expect(
      validate(good, source).failures.some(
        (f) => f.code === F.MATERIAL_REFERENCE_UNRESOLVED,
      ),
    ).toBe(true);
  });
  it("rejects new flat authoring while historical persisted reads remain a separate contract", () => {
    const packet = validPacket();
    delete packet.semanticGraph;
    expect(
      validate(packet).failures.some(
        (f) => f.code === F.SEMANTIC_GRAPH_REQUIRED,
      ),
    ).toBe(true);
    const source = fixtureLegalSource();
    delete source.documentGraph;
    expect(
      validate(validPacket(), source).failures.some(
        (f) => f.code === F.SOURCE_STRUCTURE_REQUIRED,
      ),
    ).toBe(true);
  });
  it("accounts for thousands of Agent-authored claims without model calls or per-claim database traversal", () => {
    const packet = validPacket(),
      source = fixtureLegalSource();
    const template = structuredClone(packet.legalRequirements[0]);
    for (let i = 0; i < 500; i++) {
      const suffix = `.copy${i}`,
        requirement = structuredClone(template);
      requirement.legalRequirementId += suffix;
      requirement.nonRepositoryDuty = true;
      requirement.coverage = {
        state: COVERAGE.NON_ASSESSABLE,
        nonAssessableReason:
          "Synthetic scale fixture: non-repository performance",
      };
      const chunk = {
        ...source.chunks[0],
        id: `scale-${i}`,
        locator: `art-${i + 7}::cl-1`,
      };
      source.chunks.push(chunk);
      const ref = {
        documentId: chunk.documentId,
        locator: chunk.locator,
        contentSha256: chunk.contentSha256,
      };
      requirement.sourceRefs = [ref];
      requirement.operativePropositions!.forEach((p) => {
        p.sourceRefs = [ref];
      });
      packet.legalRequirements.push(requirement);
    }
    source.documentGraph = fixtureDocumentGraph(
      source.legalSourceVersionId,
      source.chunks,
    );
    authorFixtureClaims(packet, source.documentGraph, source.chunks);
    legalSemanticGraphSchema.parse(packet.semanticGraph);
    const derived = complianceRuleSetPacketSchema.parse({
      ...packet,
      assessmentRules: packet.assessmentRules.map((r) => ({
        ...r,
        legalIntent: undefined,
        applicabilityGuidance: undefined,
        criteria: r.criteria.map((c) => ({ ...c, statement: undefined })),
      })),
    });
    const start = performance.now();
    const result = validateSemanticClaimGraph(derived, source);
    expect(result.failures).toEqual([]);
    expect(result.coverage.semanticClaims.relevant).toBeGreaterThan(1000);
    expect(result.coverage.semanticClaims.accounted).toBe(
      result.coverage.semanticClaims.relevant,
    );
    expect(performance.now() - start).toBeLessThan(2000);
  });
});
