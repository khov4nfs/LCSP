/**
 * Fail-closed claim-level Development scope review.
 * Legal source accounting is immutable; this computes a review projection,
 * not a permission for a worker to suppress a legally effective duty.
 */
import { createHash } from "node:crypto";
import {
  type LegalSemanticGraph,
  type ComplianceRuleSetPacket,
  type PreparationClaimStageDecision,
} from "@lcsp/contracts/compliance-rule-set";

const normative = new Set(["DUTY", "PROHIBITION", "PERMISSION"]);
const inbound = new Set([
  "CONDITION_OF",
  "QUALIFIES",
  "EXCEPTION_TO",
  "TEMPORALLY_APPLIES_TO",
  "PRESERVES",
  "CONTEXT_FOR",
  "EVIDENCE_SLICE_OF",
]);
const outbound = new Set(["DEFINED_BY", "INCORPORATES", "CROSS_REFERENCE"]);
const stages = new Set([
  "DEVELOPMENT",
  "NON_DEVELOPMENT",
  "LEGAL_REVIEW_REQUIRED",
]);

/**
 * Business purpose:
 * Reject one unsupported scope validation condition.
 * Business rules:
 * - Only canonical validation failure codes are emitted.
 * Execution flow:
 * 1. Raise a typed sentinel error to prevent scope publication.
 * Failure cases:
 * - Always raises for an invalid state.
 * Side effects:
 * - Throws without modifying state.
 */
function fail(code: string): never {
  throw new Error("PREPARATION_SCOPE_" + code);
}

/**
 * Business purpose:
 * Fingerprint legal scope data with canonical ordering.
 * Business rules:
 * - Key order never changes semantic identity; no external text is trusted.
 * Execution flow:
 * 1. Serialize deterministically and compute SHA-256.
 * Failure cases:
 * - Unsupported serializable structures propagate a failure.
 * Side effects:
 * - Pure computation without I/O.
 */
export function scopeDigest(value: unknown): string {
  /**
   * Business purpose:
   * Convert one JSON-compatible value into a stable digest input.
   * Business rules:
   * - Object keys are sorted recursively and array order is preserved.
   * Execution flow:
   * 1. Walk primitive, array and object values deterministically.
   * Failure cases:
   * - Non-JSON values are not accepted as legal evidence.
   * Side effects:
   * - Pure recursive normalization.
   */
  const serialize = (item: unknown): string => {
    if (Array.isArray(item)) return "[" + item.map(serialize).join(",") + "]";
    if (item && typeof item === "object")
      return (
        "{" +
        Object.entries(item)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, val]) => JSON.stringify(key) + ":" + serialize(val))
          .join(",") +
        "}"
      );
    return JSON.stringify(item);
  };
  return createHash("sha256").update(serialize(value)).digest("hex");
}

export type DevelopmentProjection = {
  legalSourceVersionId: string;
  graphDigest: string;
  decisionsDigest: string;
  developmentClaimIds: string[];
  outOfScopeClaimIds: string[];
  unresolvedClaimIds: string[];
  materialContextClaimIds: string[];
  materialRelationIds: string[];
  releaseEligible: false;
};

/**
 * Business purpose:
 * Compute a claim-complete Development-only review projection.
 * Business rules:
 * - Every normative claim has one source-pinned actor/action/stage decision; context has directed provenance.
 * Execution flow:
 * 1. Validate all propositions, decisions and relevant edges, then return development/out-of-scope/context sets.
 * Failure cases:
 * - Reject unpinned/duplicate claims, unknown stages, permission-as-duty and invalid relations.
 * Side effects:
 * - Pure validation; does not publish or mutate legal source records.
 */
export function reviewDevelopmentClaims(
  graph: LegalSemanticGraph,
  decisions: PreparationClaimStageDecision[],
): DevelopmentProjection {
  const source = graph?.legalSourceVersionId;
  if (
    !source ||
    !Array.isArray(graph.claims) ||
    !Array.isArray(graph.relations)
  )
    fail("BAD_GRAPH");
  const claims = new Map(graph.claims.map((c) => [c.claimId, c]));
  if (claims.size !== graph.claims.length) fail("DUPLICATE_CLAIM");
  const operative = new Map(
    [...claims].filter(
      ([, c]) =>
        c.state === "RELEVANT" &&
        c.semanticAuthority === "LEGAL_NORMATIVE" &&
        normative.has(c.claimType),
    ),
  );
  const seenPropositions = new Set<string>();
  for (const [id, claim] of operative) {
    if (
      claim.legalSourceVersionId !== source ||
      !claim.sourceNodeIds?.length ||
      !claim.operative?.actor?.trim() ||
      !claim.operative?.modality ||
      !claim.operative?.action?.trim()
    )
      fail("OPERATIVE_PROVENANCE:" + id);
    const key = scopeDigest({
      sourceNodeIds: [...claim.sourceNodeIds].sort(),
      ...claim.operative,
    });
    if (seenPropositions.has(key)) fail("DUPLICATE_PROPOSITION:" + id);
    seenPropositions.add(key);
  }

  const bound = new Map<string, PreparationClaimStageDecision>();
  for (const row of decisions) {
    const claim = operative.get(row.claimId);
    if (!claim || bound.has(row.claimId) || !stages.has(row.stage))
      fail("DUPLICATE_OR_UNKNOWN_DECISION:" + row.claimId);
    if (
      row.legalSourceVersionId !== source ||
      JSON.stringify(row.sourceNodeIds) !==
        JSON.stringify(claim.sourceNodeIds) ||
      row.actor !== claim.operative?.actor ||
      row.action !== claim.operative.action ||
      row.modality !== claim.operative.modality ||
      !row.reason.trim()
    )
      fail("DECISION_PROVENANCE:" + row.claimId);
    if (claim.claimType === "PERMISSION" && row.stage === "DEVELOPMENT")
      fail("PERMISSION_IS_NOT_DUTY:" + row.claimId);
    if (
      !row.evidence ||
      !row.evidence.sourceSupport.length ||
      row.evidence.sourceSupport.some(
        (support) => !claim.sourceNodeIds.includes(support.sourceNodeId),
      )
    )
      fail("CLASSIFICATION_EVIDENCE_REQUIRED:" + row.claimId);
    if (
      row.stage === "DEVELOPMENT" &&
      !row.evidence.technicalDeliverable?.trim()
    )
      fail("DEVELOPMENT_DELIVERABLE_REQUIRED:" + row.claimId);
    if (row.evidence.materialContextClaimIds.some((id) => !claims.has(id)))
      fail("CLASSIFICATION_CONTEXT_UNPINNED:" + row.claimId);
    bound.set(row.claimId, row);
  }
  if (bound.size !== operative.size) fail("UNACCOUNTED_NORMATIVE_CLAIM");

  const development = new Set(
    [...bound].filter(([, d]) => d.stage === "DEVELOPMENT").map(([id]) => id),
  );
  const context = new Set<string>(),
    relationIds = new Set<string>();
  const queue = [...development],
    visited = new Set(queue);
  const relationNames = new Set<string>();
  for (const r of graph.relations) {
    if (relationNames.has(r.relationId)) fail("DUPLICATE_RELATION");
    relationNames.add(r.relationId);
  }
  while (queue.length) {
    const anchor = queue.shift()!;
    for (const rel of graph.relations) {
      const inboundContext = rel.toClaimId === anchor && inbound.has(rel.kind);
      const outboundContext =
        rel.fromClaimId === anchor && outbound.has(rel.kind);
      if (!inboundContext && !outboundContext) continue;
      const neighbor = inboundContext ? rel.fromClaimId : rel.toClaimId;
      const claim = claims.get(neighbor);
      if (!claim || claim.state !== "RELEVANT")
        fail("MATERIAL_DANGLING_RELATION");
      if (operative.has(neighbor)) continue; // no laundering operator duties as modifiers
      if (
        claim.legalSourceVersionId !== source ||
        !claim.sourceNodeIds?.length ||
        claim.sourceNodeIds.some((node) => !/^[a-f0-9]{64}$/.test(node))
      )
        fail("MATERIAL_UNPINNED_SOURCE:" + neighbor);
      context.add(neighbor);
      relationIds.add(rel.relationId);
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  const projection: DevelopmentProjection = {
    legalSourceVersionId: source,
    graphDigest: scopeDigest(graph),
    decisionsDigest: scopeDigest(
      [...bound.values()].sort((a, b) => a.claimId.localeCompare(b.claimId)),
    ),
    developmentClaimIds: [...development].sort(),
    outOfScopeClaimIds: [...bound]
      .filter(([, d]) => d.stage === "NON_DEVELOPMENT")
      .map(([id]) => id)
      .sort(),
    unresolvedClaimIds: [...bound]
      .filter(([, d]) => d.stage === "LEGAL_REVIEW_REQUIRED")
      .map(([id]) => id)
      .sort(),
    materialContextClaimIds: [...context].sort(),
    materialRelationIds: [...relationIds].sort(),
    releaseEligible: false,
  };
  return projection;
}

/**
 * Business purpose:
 * Enforce Development-only projection during Rule Set validation and activation.
 * Business rules:
 * - A full legal ledger remains; only Development claims can become AssessmentRules.
 * Execution flow:
 * 1. Compare frozen graph, 1:1 LegalRequirement bindings and all published rule references.
 * Failure cases:
 * - Reject graph drift, mixed stages, missing development rules and out-of-scope duties in assessment rules.
 * Side effects:
 * - Pure verification; never activates a Rule Set.
 */
export function validateDevelopmentPacket(
  packet: ComplianceRuleSetPacket,
  projection: DevelopmentProjection,
): void {
  if (
    !packet.semanticGraph ||
    scopeDigest(packet.semanticGraph) !== projection.graphDigest ||
    packet.semanticGraph.legalSourceVersionId !==
      projection.legalSourceVersionId
  )
    fail("PACKET_GRAPH_DRIFT");
  if (projection.unresolvedClaimIds.length) fail("LEGAL_REVIEW_REQUIRED");
  const development = new Set(projection.developmentClaimIds);
  const outOfScope = new Set(projection.outOfScopeClaimIds);
  const requirements = new Map(
    packet.legalRequirements.map((r) => [r.legalRequirementId, r]),
  );
  const byRequirement = new Map<string, string[]>();
  const covered = new Set<string>();
  for (const req of packet.legalRequirements) {
    const claims = (req.claimBindings ?? [])
      .filter((b) => b.role === "OPERATIVE_PROPOSITION")
      .map((b) => b.claimId);
    if (!claims.length)
      fail("REQUIREMENT_WITHOUT_CLAIM:" + req.legalRequirementId);
    if (
      claims.some((id) => development.has(id)) &&
      claims.some((id) => outOfScope.has(id))
    )
      fail("MIXED_STAGE_REQUIREMENT:" + req.legalRequirementId);
    if (claims.some((id) => !development.has(id) && !outOfScope.has(id)))
      fail("UNKNOWN_REQUIREMENT_CLAIM:" + req.legalRequirementId);
    if (claims.every((id) => outOfScope.has(id))) {
      if (
        req.coverage.state !== "NON_ASSESSABLE" ||
        !(req.coverage.nonAssessableReason ?? "").startsWith(
          "OUT_OF_SCOPE_TARGET:",
        )
      )
        fail("OUT_OF_SCOPE_NOT_ACCOUNTED:" + req.legalRequirementId);
    }
    for (const claimId of claims) {
      if (covered.has(claimId)) fail("DUPLICATE_REQUIREMENT_CLAIM:" + claimId);
      covered.add(claimId);
    }
    byRequirement.set(req.legalRequirementId, claims);
  }
  if ([...development, ...outOfScope].some((id) => !covered.has(id)))
    fail("MISSING_LEGAL_REQUIREMENT");
  const ruleCovered = new Set<string>();
  for (const rule of packet.assessmentRules) {
    for (const id of rule.legalRequirementIds) {
      if (!requirements.has(id)) fail("RULE_UNKNOWN_REQUIREMENT:" + id);
      const claims = byRequirement.get(id) ?? [];
      if (!claims.length || claims.some((claim) => !development.has(claim)))
        fail("DEPLOYMENT_RULE_LEAK:" + rule.assessmentRuleId);
      claims.forEach((id) => ruleCovered.add(id));
    }
  }
  if ([...development].some((id) => !ruleCovered.has(id)))
    fail("DEVELOPMENT_DUTY_OMITTED");
}
