import { REFERENCE_ONLY_TARGET_REASON } from "@lcsp/contracts/legal-source";
import {
  COMPLIANCE_RULE_SET_FAILURE_CODES as F,
  LEGAL_CLAIM_ACCOUNTING_ROLES as ROLE,
  LEGAL_CLAIM_STATES as STATE,
  LEGAL_SEMANTIC_CLAIM_TYPES as C,
  LEGAL_SEMANTIC_RELATION_KINDS as S,
  LEGAL_CONTEXT_RELATION_KINDS as K,
  LEGAL_EVIDENCE_REQUEST_KINDS as E,
  DOWNSTREAM_SEMANTIC_AUTHORITIES,
  LEGAL_APPLICABILITY_MODES,
  deriveEvidenceRequests,
  type ComplianceRuleSetPacket,
  type ComplianceRuleSetValidationFailure,
  type LegalSemanticClaim,
} from "@lcsp/contracts/compliance-rule-set";
import {
  LEGAL_REFERENCE_RESOLUTION_STATES as R,
  LEGAL_SOURCE_CHUNK_STATUSES as EFFECT,
} from "@lcsp/contracts/legal-source";
import type { LegalSourceSnapshot } from "./compliance-rule-set-integrity.validator.js";
import {
  sourceReviewUnits,
  referenceOnlyNodeIds,
  reviewReferenceOwners,
} from "./source-review-frontier.js";
import { createHash } from "node:crypto";
import {
  semanticReferenceBindings,
  materialReferenceAccounting,
} from "./semantic-reference-binding.js";
import {
  semanticFreezeFailures,
  semanticClosure,
  requirementClosureFailures,
  effectiveSourceStatus,
} from "./source-completeness.js";

const normative = new Set<string>([C.DUTY, C.PROHIBITION, C.PERMISSION]);
const allowedRoles: Record<string, readonly string[]> = {
  [C.DUTY]: [ROLE.OPERATIVE_PROPOSITION],
  [C.PROHIBITION]: [ROLE.OPERATIVE_PROPOSITION],
  [C.PERMISSION]: [ROLE.OPERATIVE_PROPOSITION],
  [C.CONDITION]: [ROLE.APPLICABILITY_CONDITION],
  [C.SCOPE]: [ROLE.APPLICABILITY_CONDITION],
  [C.QUALIFIER]: [ROLE.QUALIFIER],
  [C.TEMPORAL_RULE]: [ROLE.QUALIFIER],
  [C.TRANSITION_RULE]: [ROLE.QUALIFIER],
  [C.EXCEPTION]: [ROLE.EXCEPTION],
  [C.DEFINITION]: [ROLE.DEFINITION],
  [C.CONTEXT]: [ROLE.CONTEXT],
  [C.CROSS_REFERENCE]: [ROLE.CONTEXT],
};
/**
 * Business purpose: Return the claim types the shared accounting matrix permits for one Requirement binding role.
 *
 * Business rules:
 * - Role eligibility comes only from the central claim-type-to-role matrix used by semantic validation and authoring readiness.
 * - Unknown roles have no claim types and cannot gain authority through a fallback.
 *
 * Execution flow:
 * 1. Enumerate claim types and their allowed roles.
 * 2. Return types whose role list contains the requested role.
 *
 * Failure cases:
 * - None; an unsupported role returns an empty list.
 *
 * Side effects:
 * - None; returns an in-memory role projection.
 */
export const claimTypesForRole = (role: string): string[] =>
  Object.entries(allowedRoles)
    .filter(([, roles]) => roles.includes(role))
    .map(([type]) => type);
const fields = {
  [ROLE.APPLICABILITY_CONDITION]: "applicabilityConditions",
  [ROLE.QUALIFIER]: "qualifiers",
  [ROLE.EXCEPTION]: "exceptions",
  [ROLE.CONTEXT]: "semanticContext",
  [ROLE.DEFINITION]: "semanticContext",
} as const;
/**
 * Business purpose: Compare structured authoring projections where exact serialized equality is required.
 *
 * Business rules:
 * - Equality follows JSON.stringify output, including array order and the object's current property ordering.
 *
 * Execution flow:
 * 1. Serialize each value using JSON rules.
 * 2. Compare the resulting strings.
 *
 * Failure cases:
 * - Unsupported values follow JSON.stringify behavior; serialization errors propagate.
 *
 * Side effects:
 * - None; performs an in-memory comparison.
 */
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const requirementRelationKind = {
  [S.DEFINITION]: K.DEFINITION,
  [S.SCOPE]: K.SCOPE,
  [S.QUALIFIER]: K.QUALIFIER,
  [S.EXCEPTION]: K.EXCEPTION,
  [S.CROSS_REFERENCE]: K.CROSS_REFERENCE,
  [S.CONDITION]: K.SCOPE,
  [S.INCORPORATES]: K.CROSS_REFERENCE,
  [S.TEMPORALLY_LIMITS]: K.QUALIFIER,
  [S.CONDITION_OF]: K.SCOPE,
  [S.QUALIFIES]: K.QUALIFIER,
  [S.EXCEPTION_TO]: K.EXCEPTION,
  [S.TEMPORALLY_APPLIES_TO]: K.QUALIFIER,
  [S.DEFINED_BY]: K.DEFINITION,
  [S.PRESERVES]: K.CROSS_REFERENCE,
  [S.EVIDENCE_SLICE_OF]: K.CROSS_REFERENCE,
  [S.CONTEXT_FOR]: K.CROSS_REFERENCE,
} as const;

/**
 * Business purpose: Validate semantic claims, their source accounting, Requirements, AssessmentRules, and dependency links against one pinned Legal Source snapshot.
 *
 * Business rules:
 * - The semantic graph and derived source structure must identify the exact pinned Legal Source Version and materialization.
 * - Claim spans, source-node hierarchy, retrieval windows, review accounting, Requirement roles, explicit references, and evidence requests must be structurally complete and source-bound.
 * - Applicability modes and authored criteria must preserve their linked operative propositions and conditions; deterministic validation never interprets source prose or repairs legal meaning.
 * - Inventory-only diagnostics may scope structural review and omit downstream Requirement/AssessmentRule checks, but do not establish whole-source completion.
 *
 * Execution flow:
 * 1. Require the derived source graph and authored semantic graph, then verify their immutable source pins.
 * 2. Validate graph/retrieval structure, claim anchors and effect status, and complete source/review accounting.
 * 3. Validate Requirement bindings against claim roles/closures and exact source lineage, then check dependency edges and explicit reference accounting.
 * 4. Validate each AssessmentRule's parent/criterion links and derived evidence requests, accumulating coverage and typed failures.
 *
 * Failure cases:
 * - Missing graphs, stale pins, malformed source/retrieval structure, incomplete accounting, invalid bindings, unresolved material references, or non-derived downstream requests are reported as structured failures.
 * - Source parsing and unexpected runtime errors propagate; no semantic verdict is substituted.
 *
 * Side effects:
 * - None outside local calculation; returns accumulated failures and coverage counts without persistence or source mutation.
 */
export function validateSemanticClaimGraph(
  packet: ComplianceRuleSetPacket,
  source: LegalSourceSnapshot,
  inventoryOnly = false,
  diagnosticReviewScope?: Set<string>,
) {
  const failures: ComplianceRuleSetValidationFailure[] = [];
  /**
   * Business purpose: Add one typed failure to the current semantic validation result.
   *
   * Business rules:
   * - The originating gate supplies the canonical code, affected reference, and detail; this helper does not reinterpret it.
   *
   * Execution flow:
   * 1. Accept the failure code and affected reference.
   * 2. Append a structured validation failure, preserving optional detail.
   *
   * Failure cases:
   * - Invalid failure object construction propagates as an ordinary in-memory error.
   *
   * Side effects:
   * - Mutates only the local failures array used for the returned validation result.
   */
  const fail = (
    code: ComplianceRuleSetValidationFailure["code"],
    ref: string,
    detail: string,
  ) => failures.push({ code, ref, detail });
  const graph = source.documentGraph;
  const semantic = packet.semanticGraph;
  const coverage = {
    structuralSource: { total: 0, accounted: 0 },
    semanticClaims: { relevant: 0, accounted: 0, unaccounted: 0 },
  };
  if (!graph) {
    fail(
      F.SOURCE_STRUCTURE_REQUIRED,
      "source",
      "A pinned derived Legal Document AST is required for new authoring",
    );
    return { failures, coverage };
  }
  if (!semantic) {
    fail(
      F.SEMANTIC_GRAPH_REQUIRED,
      "semanticGraph",
      "Author the semantic claims and explicit accounting before Requirements",
    );
    return { failures, coverage };
  }
  if (
    semantic.legalSourceVersionId !== source.legalSourceVersionId ||
    graph.legalSourceVersionId !== source.legalSourceVersionId ||
    semantic.materializationId !== graph.materializationId
  ) {
    fail(
      F.SEMANTIC_CLAIM_INVALID,
      "semanticGraph",
      "Claim graph must pin this immutable source version and exact structural materialization",
    );
  }
  const nodes = new Map(graph.nodes.map((n) => [n.nodeId, n]));
  const referenceOnly = referenceOnlyNodeIds(graph);
  if (!inventoryOnly) failures.push(...semanticFreezeFailures(semantic, graph));
  const referenceById = new Map(
    graph.references.map((r) => [r.referenceId, r]),
  );
  const ownerByChunk = new Map(
    graph.chunkMappings.map((m) => [m.chunkId, m.legalDocumentNodeId]),
  );
  const chunksByRef = new Map(
    source.chunks.map((c) => [`${c.documentId}::${c.locator}`, c]),
  );
  const binding = semanticReferenceBindings(
    graph,
    semantic.legalSourceVersionId,
    semantic.materializationId,
  );
  const { within } = binding;
  if (
    nodes.size !== graph.nodes.length ||
    graph.chunkMappings.length !== source.chunks.length ||
    source.chunks.some((c) => !nodes.has(ownerByChunk.get(c.id) ?? ""))
  )
    fail(
      F.SOURCE_STRUCTURE_REQUIRED,
      "source",
      "Every retrieval chunk must map to a node of the pinned materialization",
    );
  for (const n of graph.nodes) {
    if (
      n.legalSourceVersionId !== source.legalSourceVersionId ||
      n.parentNodeId === n.nodeId ||
      (n.parentNodeId && !within(n.nodeId, n.parentNodeId))
    )
      fail(
        F.SOURCE_STRUCTURE_REQUIRED,
        `node:${n.nodeId}`,
        "Invalid same-source hierarchy",
      );
  }
  const unitEnds = new Map<string, number>();
  const units = [...graph.retrievalUnits].sort(
    (a, b) =>
      a.legalDocumentNodeId.localeCompare(b.legalDocumentNodeId) ||
      a.ordinal - b.ordinal,
  );
  for (const unit of units) {
    const node = nodes.get(unit.legalDocumentNodeId);
    if (
      !node ||
      unit.contentStart !== (unitEnds.get(unit.legalDocumentNodeId) ?? 0) ||
      unit.contentEnd - unit.contentStart !== unit.content.length ||
      node.content.slice(unit.contentStart, unit.contentEnd) !== unit.content ||
      createHash("sha256").update(unit.content).digest("hex") !==
        unit.contentSha256
    )
      fail(
        F.SOURCE_STRUCTURE_REQUIRED,
        `retrievalUnit:${unit.unitId}`,
        "Retrieval windows must retain complete contiguous node content with exact hashes",
      );
    unitEnds.set(unit.legalDocumentNodeId, unit.contentEnd);
  }
  for (const node of graph.nodes)
    if (
      node.content.length &&
      unitEnds.get(node.nodeId) !== node.content.length
    )
      fail(
        F.SOURCE_STRUCTURE_REQUIRED,
        `node:${node.nodeId}`,
        "Derived retrieval units must preserve all node content",
      );
  const claims = new Map<string, LegalSemanticClaim>();
  const claimsAtNode = new Map<string, Set<string>>();
  for (const claim of semantic.claims) {
    const ref = `claim:${claim.claimId}`;
    if (claims.has(claim.claimId))
      fail(F.SEMANTIC_CLAIM_INVALID, ref, "Duplicate claim identity");
    claims.set(claim.claimId, claim);
    if (
      claim.legalSourceVersionId !== source.legalSourceVersionId ||
      new Set(claim.sourceNodeIds).size !== claim.sourceNodeIds.length ||
      claim.sourceNodeIds.some(
        (id) =>
          !nodes.get(id)?.content.trim() ||
          (claim.operative !== null && referenceOnly.has(id)),
      ) ||
      (claim.operative !== null &&
        claim.sourceSupport?.some((s) => referenceOnly.has(s.nodeId)))
    )
      fail(
        F.SEMANTIC_CLAIM_INVALID,
        ref,
        "Claims must cite existing nonempty source nodes in operative documents of the pinned source version",
      );
    if (
      normative.has(claim.claimType)
        ? !claim.operative || claim.operative.modality !== claim.claimType
        : claim.operative !== null
    )
      fail(
        F.SEMANTIC_CLAIM_INVALID,
        ref,
        "Normative claims require their actor/modality/action; context claims cannot impersonate operative claims",
      );
    if (
      claim.state === STATE.INTENTIONALLY_NON_OPERATIVE
        ? !claim.nonOperativeReason?.trim()
        : claim.nonOperativeReason !== null
    )
      fail(
        F.SEMANTIC_CLAIM_INVALID,
        ref,
        "Excluded claims require an explicit reason; relevant claims have no exclusion reason",
      );
    if (claim.state === STATE.RELEVANT)
      for (const nodeId of claim.sourceNodeIds) {
        const node = nodes.get(nodeId);
        if (!node) continue;
        const effectiveStatus = effectiveSourceStatus(
          graph,
          semantic,
          nodeId,
          claim.sourceNodeIds,
        );
        if (effectiveStatus !== EFFECT.EFFECTIVE)
          fail(
            effectiveStatus === EFFECT.REPEALED
              ? F.REPEALED_SOURCE_REFERENCE
              : effectiveStatus === EFFECT.FUTURE
                ? F.NON_CURRENT_SOURCE_REFERENCE
                : F.UNDETERMINED_SOURCE_STATUS,
            ref,
            `Node ${nodeId} has no current effective source authority`,
          );
        else if (!node.legalStatusSourceRefs.length)
          fail(
            F.SOURCE_STATUS_PROVENANCE_MISSING,
            ref,
            `Node ${nodeId} lacks recorded effect provenance`,
          );
      }
    for (const nodeId of claim.sourceNodeIds) {
      const ids = claimsAtNode.get(nodeId) ?? new Set<string>();
      ids.add(claim.claimId);
      claimsAtNode.set(nodeId, ids);
    }
  }
  const inspections = new Map<string, LegalSemanticGraphInspection>();
  type LegalSemanticGraphInspection = NonNullable<
    ComplianceRuleSetPacket["semanticGraph"]
  >["sourceAccounting"][number];
  for (const item of semantic.sourceAccounting) {
    if (
      inspections.has(item.sourceNodeId) ||
      !nodes.has(item.sourceNodeId) ||
      referenceOnly.has(item.sourceNodeId)
    )
      fail(
        F.INCOMPLETE_STRUCTURAL_ACCOUNTING,
        `node:${item.sourceNodeId}`,
        "Unknown or duplicate source inspection",
      );
    inspections.set(item.sourceNodeId, item);
  }
  const reviewNodes = (
    semantic.reviewFrontier
      ? sourceReviewUnits(graph)
      : graph.nodes.filter(
          (n) => n.content.trim() && !referenceOnly.has(n.nodeId),
        )
  ).filter(
    (n) =>
      !inventoryOnly ||
      !diagnosticReviewScope ||
      diagnosticReviewScope.has(n.nodeId),
  );
  for (const n of reviewNodes) {
    coverage.structuralSource.total += 1;
    const inspection = inspections.get(n.nodeId);
    const expected = semantic.reviewFrontier
      ? [...(inspection?.claimIds ?? [])].sort()
      : [...(claimsAtNode.get(n.nodeId) ?? [])].sort();
    if (
      !inspection ||
      !same([...inspection.claimIds].sort(), expected) ||
      new Set(inspection.claimIds).size !== inspection.claimIds.length ||
      inspection.claimIds.some(
        (id) => !claims.get(id)?.sourceNodeIds.includes(n.nodeId),
      ) ||
      (expected.length
        ? inspection.nonSemanticReason !== null
        : !inspection.nonSemanticReason?.trim())
    )
      fail(
        F.INCOMPLETE_STRUCTURAL_ACCOUNTING,
        `node:${n.nodeId}`,
        "Inspect this node and enumerate every identified claim, or explain why it contains no relevant semantic claim",
      );
    else coverage.structuralSource.accounted += 1;
  }
  if (semantic.reviewFrontier) {
    const reviewedClaims = new Set(
      reviewNodes.flatMap((n) => inspections.get(n.nodeId)?.claimIds ?? []),
    );
    for (const claim of semantic.claims)
      if (!reviewedClaims.has(claim.claimId))
        fail(
          F.INCOMPLETE_STRUCTURAL_ACCOUNTING,
          `claim:${claim.claimId}`,
          "Every discovered claim needs an explicit completed review unit",
        );
  }
  const bound = new Map<string, Set<string>>();
  const operativeOwners = new Map<string, string>();
  const operativePredicates = new Map<string, string>();
  for (const requirement of inventoryOnly ? [] : packet.legalRequirements) {
    const ref = `legalRequirement:${requirement.legalRequirementId}`;
    if (requirement.applicabilityMode) {
      const anchors = (requirement.claimBindings ?? [])
        .filter((b) => b.role === ROLE.OPERATIVE_PROPOSITION)
        .map((b) => claims.get(b.claimId));
      if (
        !anchors.length ||
        anchors.some(
          (c) =>
            c?.semanticFrame?.applicabilityMode !==
            requirement.applicabilityMode,
        ) ||
        (requirement.applicabilityMode ===
          LEGAL_APPLICABILITY_MODES.UNCONDITIONAL &&
          requirement.applicabilityConditions.length > 0)
      )
        fail(
          F.CLAIM_REQUIREMENT_MISMATCH,
          ref,
          "Applicability mode must preserve every source-backed operative finding and its conditions",
        );
    }
    for (const gap of requirementClosureFailures(
      semantic,
      requirement.claimBindings ?? [],
      requirement.nonRepositoryDuty,
      requirement.coverage.state === "NON_ASSESSABLE",
    ))
      fail(F.SEMANTIC_CLOSURE_INVALID, ref, gap);
    const closureRoles = new Set<string>();
    for (const b of requirement.claimBindings ?? [])
      if (b.role === ROLE.OPERATIVE_PROPOSITION) {
        try {
          for (const c of semanticClosure(semantic, b.claimId).claims)
            closureRoles.add(`${c.claimId}:${c.role}`);
        } catch {
          /* Reported by closure gate. */
        }
      }
    const seen = new Set<string>();
    const boundFields = new Set<string>();
    const operativeStatements = new Map<number, string>();
    for (const binding of requirement.claimBindings ?? []) {
      const claim = claims.get(binding.claimId);
      const identity = `${binding.claimId}|${binding.role}|${binding.index}`;
      if (
        !claim ||
        seen.has(identity) ||
        claim.state !== STATE.RELEVANT ||
        !(
          allowedRoles[claim.claimType]?.includes(binding.role) ||
          closureRoles.has(`${claim.claimId}:${binding.role}`)
        )
      ) {
        fail(
          F.CLAIM_REQUIREMENT_MISMATCH,
          ref,
          `Invalid accounting role or claim: ${identity}`,
        );
        continue;
      }
      seen.add(identity);
      let valid: boolean;
      if (binding.role === ROLE.OPERATIVE_PROPOSITION) {
        const predicate = JSON.stringify([
          claim.operative,
          [...(claim.sourceSupport ?? [])].sort(
            (a, b) =>
              a.nodeId.localeCompare(b.nodeId) || a.startOffset - b.startOffset,
          ),
          requirement.applicabilityMode ?? null,
          requirement.applicabilityConditions,
          requirement.qualifiers,
          requirement.exceptions,
        ]);
        const predicateOwner = operativePredicates.get(predicate);
        if (predicateOwner && predicateOwner !== requirement.legalRequirementId)
          fail(
            F.CLAIM_REQUIREMENT_MISMATCH,
            ref,
            `The same supported obligation already belongs to Requirement ${predicateOwner}`,
          );
        else operativePredicates.set(predicate, requirement.legalRequirementId);
        const owner = operativeOwners.get(binding.claimId);
        if (owner && owner !== requirement.legalRequirementId)
          fail(
            F.CLAIM_REQUIREMENT_MISMATCH,
            ref,
            `Operative claim ${binding.claimId} already belongs to Requirement ${owner}; retain one Requirement owner and repair its AssessmentRules`,
          );
        else
          operativeOwners.set(binding.claimId, requirement.legalRequirementId);
        const operative = requirement.operativePropositions?.[binding.index];
        valid = Boolean(
          operative &&
          claim.operative &&
          operative.actor === claim.operative.actor &&
          operative.modality === claim.operative.modality &&
          operative.action === claim.operative.action,
        );
        if (
          operativeStatements.has(binding.index) &&
          operativeStatements.get(binding.index) !== claim.statement
        )
          valid = false;
        operativeStatements.set(binding.index, claim.statement);
      } else {
        valid =
          requirement[fields[binding.role]]?.[binding.index] ===
          claim.statement;
      }
      const sourceRefs =
        binding.role === ROLE.OPERATIVE_PROPOSITION
          ? (requirement.operativePropositions?.[binding.index]?.sourceRefs ??
            [])
          : requirement.sourceRefs;
      const owners = sourceRefs.flatMap((r) => {
        const chunk = chunksByRef.get(`${r.documentId}::${r.locator}`);
        const owner =
          chunk && chunk.contentSha256 === r.contentSha256
            ? ownerByChunk.get(chunk.id)
            : undefined;
        return owner ? [owner] : [];
      });
      if (
        sourceRefs.length > 0 &&
        !claim.sourceNodeIds.every((id) =>
          owners.some((owner) => within(id, owner)),
        )
      )
        valid = false;
      if (!valid) {
        fail(
          F.CLAIM_REQUIREMENT_MISMATCH,
          ref,
          `Claim ${claim.claimId} loses its structured semantics or source-node lineage at ${binding.role}[${binding.index}]`,
        );
        continue;
      }
      boundFields.add(
        `${binding.role === ROLE.DEFINITION ? ROLE.CONTEXT : binding.role}|${binding.index}`,
      );
      const requirements = bound.get(claim.claimId) ?? new Set<string>();
      requirements.add(requirement.legalRequirementId);
      bound.set(claim.claimId, requirements);
    }
    for (const [index] of (requirement.operativePropositions ?? []).entries())
      if (!boundFields.has(`${ROLE.OPERATIVE_PROPOSITION}|${index}`))
        fail(
          F.CLAIM_REQUIREMENT_MISMATCH,
          ref,
          `Operative proposition ${index} has no valid normative claim binding`,
        );
    for (const [role, field] of Object.entries(fields)) {
      if (role === ROLE.DEFINITION) continue;
      for (const [index] of (requirement[field] ?? []).entries())
        if (!boundFields.has(`${role}|${index}`))
          fail(
            F.CLAIM_REQUIREMENT_MISMATCH,
            ref,
            `${field}[${index}] has no claim authority`,
          );
    }
    const statement = [...operativeStatements.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, s]) => s)
      .join("\n");
    if (requirement.proposition !== statement)
      fail(
        F.CLAIM_REQUIREMENT_MISMATCH,
        ref,
        "Requirement proposition must retain the bound operative claim statements",
      );
  }
  for (const claim of claims.values()) {
    if (claim.state !== STATE.RELEVANT) continue;
    coverage.semanticClaims.relevant += 1;
    if (!bound.get(claim.claimId)?.size) {
      coverage.semanticClaims.unaccounted += 1;
      if (!inventoryOnly)
        fail(
          F.UNACCOUNTED_SEMANTIC_CLAIM,
          `claim:${claim.claimId}`,
          "Relevant claim has no valid explicit Requirement accounting path",
        );
    } else coverage.semanticClaims.accounted += 1;
  }
  const relations = new Map(semantic.relations.map((r) => [r.relationId, r]));
  if (relations.size !== semantic.relations.length)
    fail(
      F.SEMANTIC_CLAIM_INVALID,
      "semanticGraph",
      "Duplicate claim relation identity",
    );
  const requirementDependencies = new Map<string, Set<string>>();
  for (const relation of packet.contextRelations) {
    if (!relation.toLegalRequirementId) continue;
    const key = `${relation.kind}|${relation.fromLegalRequirementId}`;
    const targets = requirementDependencies.get(key) ?? new Set<string>();
    targets.add(relation.toLegalRequirementId);
    requirementDependencies.set(key, targets);
  }
  for (const relation of semantic.relations) {
    if (relation.referenceId) {
      const detached = binding.failure(relation, claims);
      if (detached) failures.push(detached);
    }
    const from = claims.get(relation.fromClaimId),
      to = claims.get(relation.toClaimId);
    const ref = `claimRelation:${relation.relationId}`;
    if (!from || !to || from.claimId === to.claimId) {
      fail(
        F.SEMANTIC_CLAIM_INVALID,
        ref,
        "Claim relation endpoints must exist and differ",
      );
      continue;
    }
    for (const origin of bound.get(from.claimId) ?? []) {
      const targets = bound.get(to.claimId) ?? new Set<string>();
      if (
        !targets.has(origin) &&
        ![
          ...(requirementDependencies.get(
            `${requirementRelationKind[relation.kind]}|${origin}`,
          ) ?? []),
        ].some((target) => targets.has(target))
      )
        fail(
          F.SEMANTIC_DEPENDENCY_DETACHED,
          ref,
          "Claim dependency must retain its kind and direction within the origin Requirement or a linked Requirement dependency",
        );
    }
  }
  const referenceAccounting = new Map(
    semantic.referenceAccounting.map((r) => [r.referenceId, r]),
  );
  if (
    referenceAccounting.size !== semantic.referenceAccounting.length ||
    semantic.referenceAccounting.some((r) => !referenceById.has(r.referenceId))
  )
    fail(
      F.INCOMPLETE_STRUCTURAL_ACCOUNTING,
      "references",
      "Unknown or duplicate reference accounting",
    );
  const referenceOwners = reviewReferenceOwners(graph);
  for (const reference of graph.references) {
    if (referenceOnly.has(reference.fromNodeId)) {
      if (
        referenceAccounting.has(reference.referenceId) ||
        semantic.relations.some((r) => r.referenceId === reference.referenceId)
      )
        fail(
          F.INCOMPLETE_STRUCTURAL_ACCOUNTING,
          `reference:${reference.referenceId}`,
          "Reference-only origins have no review owner or accounting",
        );
      continue;
    }
    if (
      inventoryOnly &&
      diagnosticReviewScope &&
      !diagnosticReviewScope.has(
        referenceOwners.get(reference.referenceId) ?? "",
      )
    )
      continue;
    const accounting = referenceAccounting.get(reference.referenceId);
    if (
      reference.toNodeId &&
      referenceOnly.has(reference.toNodeId) &&
      !accounting?.material &&
      (accounting?.nonMaterialReason !== REFERENCE_ONLY_TARGET_REASON ||
        accounting.relationIds.length)
    )
      fail(
        F.INCOMPLETE_STRUCTURAL_ACCOUNTING,
        `reference:${reference.referenceId}`,
        "Reference-only targets require non-material REFERENCE_ONLY_TARGET accounting",
      );
    if (
      accounting?.nonMaterialReason === REFERENCE_ONLY_TARGET_REASON &&
      (!reference.toNodeId || !referenceOnly.has(reference.toNodeId))
    )
      fail(
        F.INCOMPLETE_STRUCTURAL_ACCOUNTING,
        `reference:${reference.referenceId}`,
        "REFERENCE_ONLY_TARGET is only permitted for references that resolve to a verified reference-only target node",
      );
    const hasLegalEffect = Boolean(
      reference.toNodeId &&
      semantic.claims.some((c) =>
        c.semanticFrame?.legalEffect?.targets.some(
          (t) =>
            t.nodeId === reference.toNodeId ||
            (t.scope === "SUBTREE" && within(reference.toNodeId!, t.nodeId)),
        ),
      ),
    );
    const projected = materialReferenceAccounting(
      reference.referenceId,
      semantic.relations,
    );
    if (
      !accounting ||
      (projected !== null &&
        (!accounting.material ||
          accounting.nonMaterialReason !== null ||
          !same([...accounting.relationIds].sort(), projected.relationIds))) ||
      (accounting.material
        ? accounting.nonMaterialReason !== null ||
          (!hasLegalEffect && accounting.relationIds.length === 0) ||
          accounting.relationIds.some(
            (id) => relations.get(id)?.referenceId !== reference.referenceId,
          )
        : !accounting.nonMaterialReason?.trim() ||
          accounting.relationIds.length > 0)
    )
      fail(
        F.INCOMPLETE_STRUCTURAL_ACCOUNTING,
        `reference:${reference.referenceId}`,
        "Every explicit reference requires material dependency accounting or a non-material reason",
      );
    if (accounting?.material && reference.resolutionState !== R.RESOLVED)
      fail(
        F.MATERIAL_REFERENCE_UNRESOLVED,
        `reference:${reference.referenceId}`,
        "A material unresolved or ambiguous reference blocks completion",
      );
  }
  for (const rule of inventoryOnly ? [] : packet.assessmentRules) {
    const ref = `assessmentRule:${rule.assessmentRuleId}`;
    const criteria = new Set(rule.criteria.map((c) => c.criterionId));
    const bindings = rule.evidenceBindings ?? [];
    if (
      rule.semanticAuthority !==
        DOWNSTREAM_SEMANTIC_AUTHORITIES.CLAIM_DERIVED ||
      bindings.some((b) => !criteria.has(b.criterionId)) ||
      new Set(bindings.map((b) => `${b.kind}|${b.criterionId}`)).size !==
        bindings.length ||
      rule.criteria.some(
        (c) =>
          !bindings.some(
            (b) => b.criterionId === c.criterionId && b.kind === E.REQUIRED,
          ),
      )
    )
      fail(
        F.DOWNSTREAM_AUTHORITY_MISMATCH,
        ref,
        "Every criterion needs a claim-derived evidence request; technical strategy is non-normative",
      );
    for (const [field, kind] of [
      ["requiredEvidence", E.REQUIRED],
      ["supportingEvidence", E.SUPPORTING],
      ["negativeEvidence", E.NEGATIVE],
    ] as const) {
      if (
        !same(
          rule[field],
          deriveEvidenceRequests(rule.criteria, bindings, kind),
        )
      )
        fail(
          F.DOWNSTREAM_AUTHORITY_MISMATCH,
          `${ref}|field:${field}`,
          "Evidence requests must demonstrate linked criteria, without adding mandatory technical capabilities",
        );
    }
    if (
      !same(
        rule.investigationGoals,
        rule.criteria.map((c) => c.statement),
      )
    )
      fail(
        F.DOWNSTREAM_AUTHORITY_MISMATCH,
        `${ref}|field:investigationGoals`,
        "Investigation goals inherit canonical criteria; optional narrower strategies cannot define pass/fail expectations",
      );
  }
  return { failures, coverage };
}
