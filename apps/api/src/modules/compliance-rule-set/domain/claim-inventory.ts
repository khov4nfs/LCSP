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
} from "./semantic-audit.js";

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
export const inventoryHash = (value: unknown) =>
  createHash("sha256").update(inventoryCanonical(value)).digest("hex");
export const normalizeIdentityKey = (key: string) =>
  key.normalize("NFKC").trim().toLowerCase().replace(/\s+/gu, " ");
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
export function normalizeInventory(
  graph: LegalSemanticGraph,
): LegalSemanticGraph {
  return {
    ...graph,
    ...(graph.semanticAudits
      ? {
          semanticAudits: [...graph.semanticAudits].sort((a, b) =>
            a.sourceNodeId.localeCompare(b.sourceNodeId),
          ),
        }
      : {}),
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
export function inventoryFingerprint(
  revision: number,
  graph: LegalSemanticGraph,
) {
  return inventoryHash({ revision, graph: normalizeInventory(graph) });
}
/**
 * Necessary conditions for ANY valid Rule Set, so a frozen inventory that fails them can never be authored:
 * a Rule Set needs an AssessmentRule, hence an assessable Requirement, hence an operative proposition and a
 * non-empty applicabilityConditions list whose every entry has claim authority in the applicability role.
 * Decides capability from the role matrix only; it never reads or classifies source prose.
 */
export function authoringReadinessGaps(
  graph: LegalSemanticGraph,
): ComplianceRuleSetValidationFailure[] {
  const relevant = graph.claims.filter((c) => c.state === STATE.RELEVANT);
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
        detail: `${G.UNREACHABLE_RELEVANT_CLAIM}: declare its supported relationship to an operative closure, or independently audit a legitimate non-operative disposition`,
      });
  return failures;
}
/**
 * INV-C2: a complete, independently audited review of a source that states no duty, prohibition or permission ends the
 * Preparation with an explicit outcome instead of failing under pressure to invent one. `failures` are the failures of
 * validateClaimInventory for this same inventory, so every other gate (all units reviewed, every receipt current,
 * attested and passed, closure and provenance) keeps its existing code. Only the absence of an operative claim is waived,
 * and only when the gate itself reported it. Returns why the outcome is unavailable; [] means it may be recorded.
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
      ...semanticFreezeFailures(graph, source.documentGraph, revision),
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
