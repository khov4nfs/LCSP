import { createHash } from "node:crypto";
import {
  SEMANTIC_INTEGRITY_GAP_CODES as G,
  COMPLIANCE_RULE_SET_FAILURE_CODES as F,
  LEGAL_CLAIM_ACCOUNTING_ROLES as ROLE,
  LEGAL_CLAIM_STATES as STATE,
  LEGAL_ASSESSABILITIES as ASSESS,
  type ClaimInventoryBinding,
  type ComplianceRuleSetPacket,
  type ComplianceRuleSetValidationFailure,
  type LegalSemanticGraph,
} from "@lcsp/contracts/compliance-rule-set";
import type { LegalSourceSnapshot } from "./compliance-rule-set-integrity.validator.js";
import {
  claimTypesForRole,
  validateSemanticClaimGraph,
} from "./semantic-claim-integrity.validator.js";
import {
  semanticFreezeFailures,
  operativeClaim,
  semanticClosure,
} from "./source-completeness.js";

/**
 * Business purpose: Produce a stable identity representation for claim inventories and their persisted fingerprints.
 *
 * Business rules:
 * - Array order remains meaningful, while object keys are sorted before serialization.
 * - Primitive values use JSON serialization so equivalent inventory records hash consistently.
 *
 * Execution flow:
 * 1. Recursively canonicalize array entries in their existing order.
 * 2. Recursively canonicalize object values in sorted-key order and serialize each key.
 * 3. Serialize primitive values using JSON rules.
 *
 * Failure cases:
 * - Unsupported JavaScript values retain JSON.stringify's behavior rather than receiving an invented representation.
 *
 * Side effects:
 * - None; returns a canonical string without mutating the supplied value.
 */
export function inventoryCanonical(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(inventoryCanonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${inventoryCanonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
/**
 * Business purpose: Bind a Preparation inventory value to a deterministic content digest.
 *
 * Business rules:
 * - The digest is computed over the canonical inventory representation so object key order cannot change identity.
 * - Array ordering and all canonicalized values remain part of the digest.
 *
 * Execution flow:
 * 1. Convert the supplied value to its canonical JSON representation.
 * 2. Return the SHA-256 digest in hexadecimal form.
 *
 * Failure cases:
 * - Hash construction errors propagate; unsupported values follow inventoryCanonical's JSON behavior.
 *
 * Side effects:
 * - None; computes a digest in memory.
 */
export const inventoryHash = (value: unknown) =>
  createHash("sha256").update(inventoryCanonical(value)).digest("hex");
/**
 * Business purpose: Normalize a worker-supplied semantic identity key before assigning a canonical claim ID.
 *
 * Business rules:
 * - Unicode compatibility forms, surrounding whitespace, case, and repeated whitespace do not create distinct identity keys.
 * - The caller's substantive key text is retained after those normalization rules.
 *
 * Execution flow:
 * 1. Apply Unicode NFKC normalization.
 * 2. Trim, lowercase, and collapse whitespace runs to one space.
 *
 * Failure cases:
 * - Invalid Unicode normalization input propagates the runtime error.
 *
 * Side effects:
 * - None; returns a normalized key without changing the input.
 */
export const normalizeIdentityKey = (key: string) =>
  key.normalize("NFKC").trim().toLowerCase().replace(/\s+/gu, " ");
/**
 * Business purpose: Give a source-grounded claim one deterministic identity within a specific Preparation revision.
 *
 * Business rules:
 * - Claim identity binds the run, inventory revision, sorted source-node anchors, and normalized semantic key.
 * - The same key in a different run or revision is a different claim identity.
 *
 * Execution flow:
 * 1. Sort source node IDs and normalize the identity key.
 * 2. Hash the complete run/revision/source/key tuple using the inventory hash.
 *
 * Failure cases:
 * - Canonical serialization or hashing errors propagate; no fallback identity is generated.
 *
 * Side effects:
 * - None; returns a deterministic claim ID.
 */
export function canonicalClaimId(
  runId: string,
  revision: number,
  sourceNodeIds: string[],
  key: string,
) {
  return inventoryHash({
    preparationRunId: runId,
    revision,
    sourceNodeIds: [...sourceNodeIds].sort(),
    identityKey: normalizeIdentityKey(key),
  });
}
/**
 * Business purpose: Normalize collection ordering before comparing or freezing a semantic claim inventory.
 *
 * Business rules:
 * - Claim source anchors, claims, relations, source accounting, and reference accounting use stable order for equality and hashing.
 * - Graph meaning and record contents are preserved; only collection order is normalized.
 *
 * Execution flow:
 * 1. Copy the graph and sort claim anchors and claim rows.
 * 2. Sort relations and both accounting collections by their canonical IDs.
 *
 * Failure cases:
 * - Malformed inputs fail through ordinary property access or sorting errors rather than being repaired.
 *
 * Side effects:
 * - None; returns a normalized copy and leaves the supplied graph unchanged.
 */
export function normalizeInventory(
  graph: LegalSemanticGraph,
): LegalSemanticGraph {
  return {
    ...graph,
    claims: graph.claims
      .map((c) => ({ ...c, sourceNodeIds: [...c.sourceNodeIds].sort() }))
      .sort((a, b) => a.claimId.localeCompare(b.claimId)),
    relations: [...graph.relations].sort((a, b) =>
      a.relationId.localeCompare(b.relationId),
    ),
    sourceAccounting: graph.sourceAccounting
      .map((r) => ({ ...r, claimIds: [...r.claimIds].sort() }))
      .sort((a, b) => a.sourceNodeId.localeCompare(b.sourceNodeId)),
    referenceAccounting: graph.referenceAccounting
      .map((r) => ({ ...r, relationIds: [...r.relationIds].sort() }))
      .sort((a, b) => a.referenceId.localeCompare(b.referenceId)),
  };
}
/**
 * Business purpose: Bind a normalized semantic claim graph to the exact Preparation inventory revision.
 *
 * Business rules:
 * - Revision is part of the fingerprint, so reopening an inventory cannot silently reuse an earlier revision's identity.
 * - Collection ordering is normalized before hashing.
 *
 * Execution flow:
 * 1. Normalize the graph's order-sensitive collections.
 * 2. Hash the revision and normalized graph together.
 *
 * Failure cases:
 * - Canonicalization and hashing errors propagate without creating a partial fingerprint.
 *
 * Side effects:
 * - None; computes an in-memory fingerprint.
 */
export function inventoryFingerprint(
  revision: number,
  graph: LegalSemanticGraph,
) {
  return inventoryHash({ revision, graph: normalizeInventory(graph) });
}
/**
 * Business purpose: Identify frozen inventories that cannot support any valid Requirement and AssessmentRule.
 *
 * Business rules:
 * - A relevant operative claim is required unless a separate explicit no-obligations outcome is being validated.
 * - Assessable, conditional operative claims need a claim-authorized applicability condition in their semantic closure.
 * - Every claim marked RELEVANT must be reachable from an operative closure before the inventory can become authoring-ready.
 * - The role matrix determines permitted claim types; this gate never interprets source prose.
 *
 * Execution flow:
 * 1. Select relevant claims and identify operative claims using the shared role and authority rules.
 * 2. Check each operative claim's closure for required applicability authority and collect reachable claim IDs.
 * 3. Report each other relevant claim that is outside every operative closure.
 *
 * Failure cases:
 * - Returns structured failures for missing operative claims, missing applicability authority, and unreachable relevant claims.
 * - Semantic closure exceptions are left to the topology gate, which reports the underlying structural failure.
 *
 * Side effects:
 * - None; inspects the graph and returns readiness failures.
 */
export function authoringReadinessGaps(
  graph: LegalSemanticGraph,
): ComplianceRuleSetValidationFailure[] {
  const relevant = graph.claims.filter((c) => c.state === STATE.RELEVANT);
  /**
   * Business purpose: Find relevant claim types that the accounting matrix permits for one inventory role.
   *
   * Business rules:
   * - Only claims in RELEVANT state can establish a role's readiness.
   * - Claim-type eligibility comes from claimTypesForRole, not from source-text heuristics.
   *
   * Execution flow:
   * 1. Read the allowed claim types for the requested accounting role.
   * 2. Return those types and their relevant graph claims.
   *
   * Failure cases:
   * - An unknown role yields no permitted claim types and therefore no matching claims.
   *
   * Side effects:
   * - None; returns an in-memory projection.
   */
  const bearing = (role: string) => {
    const types = claimTypesForRole(role);
    return {
      types,
      claims: relevant.filter((c) => types.includes(c.claimType)),
    };
  };
  const operative = {
    ...bearing(ROLE.OPERATIVE_PROPOSITION),
    claims: relevant.filter(operativeClaim),
  };
  if (!operative.claims.length)
    return [
      {
        code: F.OPERATIVE_CLAIM_MISSING,
        ref: "claimInventory",
        detail: `No relevant operative claim (${operative.types.join(", ")}) exists, so no Requirement can be authored from this inventory`,
      },
    ];
  const applicability = bearing(ROLE.APPLICABILITY_CONDITION);
  const failures: ComplianceRuleSetValidationFailure[] = [],
    reachable = new Set<string>();
  for (const claim of operative.claims) {
    try {
      const closure = semanticClosure(graph, claim.claimId);
      for (const row of closure.claims) reachable.add(row.claimId);
      if (
        ![ASSESS.EXTERNAL_FULFILLMENT, ASSESS.NON_ASSESSABLE].includes(
          claim.assessability as never,
        ) &&
        claim.semanticFrame?.applicabilityMode !==
          LEGAL_APPLICABILITY_MODES.UNCONDITIONAL &&
        !closure.claims.some((c) => c.role === ROLE.APPLICABILITY_CONDITION)
      )
        failures.push({
          code: F.APPLICABILITY_AUTHORITY_MISSING,
          ref: `claim:${claim.claimId}`,
          detail: `No compatible ${applicability.types.join(" or ")} claim belongs to this operative claim's verified closure. Author and explicitly target its source-grounded addressee, trigger or scope before freeze`,
        });
    } catch {
      /* The semantic closure gate reports the precise topology failure. */
    }
  }
  for (const claim of relevant)
    if (!reachable.has(claim.claimId))
      failures.push({
        code: F.SEMANTIC_CLOSURE_INVALID,
        ref: `claim:${claim.claimId}`,
        detail: `${G.UNREACHABLE_RELEVANT_CLAIM}: declare its supported relationship to an operative closure, or declare a source-supported non-operative disposition`,
      });
  return failures;
}
/**
 * Business purpose: Permit an explicit completed Preparation outcome when the source inventory contains no operative obligation.
 *
 * Business rules:
 * - Any operative-typed claim blocks this outcome even when excluded, so an existing duty cannot be hidden by disposition.
 * - Only the validator's explicit OPERATIVE_CLAIM_MISSING failure may be waived; all other inventory gates remain required.
 * - The outcome is unavailable when validation did not establish the absence of operative claims.
 *
 * Execution flow:
 * 1. Reject the conclusion if any claim has an operative proposition type.
 * 2. Preserve every failure except the dedicated missing-operative-claim failure.
 * 3. Return no failures only when that dedicated absence failure was actually present.
 *
 * Failure cases:
 * - Returns a claim-phase failure for operative-typed claims or when the inventory gate did not report their absence.
 * - Returns all unrelated validation failures unchanged.
 *
 * Side effects:
 * - None; determines whether the explicit conclusion can be recorded.
 */
export function noOperativeObligationsFailures(
  graph: LegalSemanticGraph,
  failures: ComplianceRuleSetValidationFailure[],
): ComplianceRuleSetValidationFailure[] {
  // Any claim of an operative type blocks the outcome, relevant or excluded: excluding a stated duty must never launder it into "none".
  const operativeTypes = claimTypesForRole(ROLE.OPERATIVE_PROPOSITION);
  const operative = graph.claims.filter((c) =>
    operativeTypes.includes(c.claimType),
  );
  if (operative.length)
    return [
      {
        code: F.claimPhaseInvalid,
        ref: "claimInventory",
        detail: `${operative.length} operative-typed claim(s) exist, so the no-operative-obligations outcome is unavailable; finalize the inventory and author Rules`,
      },
    ];
  const blocking = failures.filter((f) => f.code !== F.OPERATIVE_CLAIM_MISSING);
  if (blocking.length) return blocking;
  return failures.length
    ? []
    : [
        {
          code: F.claimPhaseInvalid,
          ref: "claimInventory",
          detail:
            "The inventory gate did not report the absence of operative claims; the outcome is never inferred",
        },
      ];
}
/**
 * Business purpose: Validate a proposed semantic claim inventory before it is frozen for Rule authoring.
 *
 * Business rules:
 * - Claims must bind the current run and revision through canonical identity keys and unique structured claim identity.
 * - Source support, semantic topology, retrieval readiness, and complete inventory-wide authoring readiness are required.
 * - A scoped diagnostic checks only its selected review units and cannot establish full-inventory authoring readiness.
 *
 * Execution flow:
 * 1. Run the semantic graph validator in inventory-only mode and apply source-supported freeze checks.
 * 2. Apply whole-inventory readiness unless the caller supplied a diagnostic review scope, and require a valid retrieval index.
 * 3. Check each claim's canonical ID and structured identity for duplicates, then require exactly one identity key per claim.
 *
 * Failure cases:
 * - Accumulates typed failures for source, semantic, identity, duplicate, and retrieval-index gaps rather than inferring missing facts.
 * - Underlying graph/source validation errors propagate.
 *
 * Side effects:
 * - None; validates supplied values and returns failures with coverage counts.
 */
export function validateClaimInventory(
  runId: string,
  revision: number,
  graph: LegalSemanticGraph,
  identities: Record<string, string>,
  source: LegalSourceSnapshot,
  diagnosticReviewScope?: Set<string>,
) {
  const packet = {
    semanticGraph: graph,
    legalRequirements: [],
    assessmentRules: [],
    contextRelations: [],
  } as ComplianceRuleSetPacket;
  const result = validateSemanticClaimGraph(
    packet,
    source,
    true,
    diagnosticReviewScope,
  );
  if (source.documentGraph)
    result.failures.push(
      ...semanticFreezeFailures(graph, source.documentGraph),
    );
  // A scoped diagnostic inspects part of the source and cannot prove whole-Rule-Set capability.
  if (!diagnosticReviewScope)
    result.failures.push(...authoringReadinessGaps(graph));
  if (!source.retrievalIndexValid)
    result.failures.push({
      code: F.RETRIEVAL_INDEX_NOT_VALID,
      ref: "source",
      detail: "Pinned retrieval index must be valid",
    });
  const seen = new Set<string>();
  for (const claim of graph.claims) {
    const key = identities[claim.claimId];
    if (
      !key ||
      canonicalClaimId(runId, revision, claim.sourceNodeIds, key) !==
        claim.claimId
    )
      result.failures.push({
        code: F.SEMANTIC_CLAIM_INVALID,
        ref: `claim:${claim.claimId}`,
        detail:
          "Canonical claim identity must match Preparation revision, source nodes and stable semantic key",
      });
    const identity = inventoryHash({
      sourceNodeIds: [...claim.sourceNodeIds].sort(),
      claimType: claim.claimType,
      semanticIdentity: claim.operative ?? normalizeIdentityKey(key ?? ""),
    });
    if (seen.has(identity))
      result.failures.push({
        code: F.SEMANTIC_CLAIM_INVALID,
        ref: `claim:${claim.claimId}`,
        detail: "Duplicate structured claim identity",
      });
    seen.add(identity);
  }
  if (Object.keys(identities).length !== graph.claims.length)
    result.failures.push({
      code: F.SEMANTIC_CLAIM_INVALID,
      ref: "identities",
      detail: "Every canonical claim has exactly one identity key",
    });
  return result;
}
/**
 * Business purpose: Ensure authoring or submission remains bound to the exact frozen claim inventory.
 *
 * Business rules:
 * - A packet cannot reference an old revision or proceed without a frozen inventory.
 * - Packet binding, semantic graph digest, current run revision, and every Requirement revision must match the frozen record.
 * - Changing claims requires an explicit inventory reopen that creates a new revision.
 *
 * Execution flow:
 * 1. Reject a packet-level revision that differs from the current run revision.
 * 2. Require a frozen inventory record.
 * 3. Compare current, frozen, packet, graph-fingerprint, and Requirement revisions and return any stale-binding failure.
 *
 * Failure cases:
 * - Returns a claim-inventory-required failure when no frozen inventory exists.
 * - Returns a stale-inventory-binding failure for any revision, fingerprint, graph, or Requirement mismatch.
 *
 * Side effects:
 * - None; checks persisted and submitted snapshots without mutation.
 */
export function validateFrozenInventory(
  packet: ComplianceRuleSetPacket,
  frozen: {
    revision: number;
    fingerprint: string;
    graph: LegalSemanticGraph;
  } | null,
  currentRevision: number,
): ComplianceRuleSetValidationFailure[] {
  if (
    packet.claimInventory &&
    packet.claimInventory.revision !== currentRevision
  )
    return [
      {
        code: F.staleInventoryBinding,
        ref: "claimInventory",
        detail:
          "Candidate targets a previous inventory revision; reload the current inventory",
      },
    ];
  if (!frozen)
    return [
      {
        code: F.claimInventoryRequired,
        ref: "claimInventory",
        detail: "Finalize a valid claim inventory before Rule authoring",
      },
    ];
  const binding: ClaimInventoryBinding | undefined = packet.claimInventory;
  if (
    currentRevision !== frozen.revision ||
    binding?.revision !== frozen.revision ||
    binding?.fingerprint !== frozen.fingerprint ||
    !packet.semanticGraph ||
    inventoryFingerprint(frozen.revision, packet.semanticGraph) !==
      frozen.fingerprint ||
    packet.legalRequirements.some(
      (r) => r.claimInventoryRevision !== frozen.revision,
    )
  )
    return [
      {
        code: F.staleInventoryBinding,
        ref: "claimInventory",
        detail:
          "Candidate must target the exact current frozen revision; reopen explicitly to change claims",
      },
    ];
  return [];
}
import { LEGAL_APPLICABILITY_MODES } from "@lcsp/contracts/compliance-rule-set";
