import {
  LEGAL_REQUIREMENT_COVERAGE_STATES,
  LEGAL_REQUIREMENT_CONTEXT_FIELDS,
  LEGAL_APPLICABILITY_MODES,
  type LegalRequirementCoverageState,
} from "./constants.ts";
import type {
  LegalRequirementInput,
  LegalContextRelationInput,
  AssessmentRuleInput,
} from "./schemas.ts";
import type { LegalSemanticGraph } from "./semantic-graph.ts";
import { LEGAL_ASSESSABILITIES } from "./semantic-support.ts";

/** Directed inherited context, including transitive incorporation; cycles terminate by identity. */
/**
 * Business purpose: Collect the linked requirement context needed to investigate an AssessmentRule's inherited legal scope.
 *
 * Business rules:
 * - Follow directed outgoing context relations transitively, deduplicate by relation identity and retain only known supplied requirements; do not decide legal applicability.
 *
 * Execution flow:
 * 1. Seed the requirement identity set.
 * 2. Expand through outgoing target requirements and collect relation records.
 * 3. Return selected requirements and deterministically sorted relations.
 *
 * Failure cases:
 * - An unknown relation target has no fabricated requirement body; malformed graph fields propagate to upstream integrity handling.
 *
 * Side effects:
 * - Pure in-memory context projection; no source, rule or decision mutation.
 */
export function assessmentSemanticContext(
  requirements: readonly LegalRequirementInput[],
  relations: readonly LegalContextRelationInput[] = [],
  allRequirements: readonly LegalRequirementInput[] = requirements,
): {
  requirements: LegalRequirementInput[];
  relations: LegalContextRelationInput[];
} {
  const ids = new Set(requirements.map((r) => r.legalRequirementId));
  const edges = new Map<string, LegalContextRelationInput>();
  for (const id of ids)
    for (const edge of relations) {
      if (edge.fromLegalRequirementId !== id) continue;
      edges.set(edge.relationId, edge);
      if (edge.toLegalRequirementId) ids.add(edge.toLegalRequirementId);
    }
  return {
    requirements: allRequirements.filter((r) => ids.has(r.legalRequirementId)),
    relations: [...edges.values()].sort((a, b) =>
      a.relationId < b.relationId ? -1 : a.relationId > b.relationId ? 1 : 0,
    ),
  };
}

/**
 * Business purpose: Present the source-authored propositions behind an AssessmentRule in deterministic order.
 *
 * Business rules:
 * - Use each supplied requirement's exact proposition and identity; the projection creates no new duty.
 *
 * Execution flow:
 * 1. Sort a copy by legalRequirementId and join each identity/proposition pair.
 *
 * Failure cases:
 * - Empty input produces empty intent text; invalid required fields propagate rather than supplying inferred legal content.
 *
 * Side effects:
 * - Pure text projection; the original requirement order and content remain unchanged.
 */
export function deriveAssessmentLegalIntent(
  requirements: readonly LegalRequirementInput[],
) {
  return [...requirements]
    .sort((a, b) =>
      a.legalRequirementId < b.legalRequirementId
        ? -1
        : a.legalRequirementId > b.legalRequirementId
          ? 1
          : 0,
    )
    .map((r) => `${r.legalRequirementId}: ${r.proposition}`)
    .join("\n");
}

/** Select a parent-authored context fact; never regenerate a customer applicability predicate. */
/**
 * Business purpose: Resolve a typed unresolved-condition binding to the exact requirement element an investigator must establish.
 *
 * Business rules:
 * - Use the supplied requirement ID, canonical context field and zero-based index; display the element's position as one-based.
 *
 * Execution flow:
 * 1. Find the referenced requirement and select its bound condition, qualifier or exception.
 * 2. Return its addressed text or null when absent.
 *
 * Failure cases:
 * - Unrecognized requirement or out-of-range element returns null; no replacement applicability condition is guessed.
 *
 * Side effects:
 * - Pure binding lookup; no finding, evidence or human request is persisted.
 */
export function resolveAssessmentContextBinding(
  binding: NonNullable<
    AssessmentRuleInput["unresolvedConditionBindings"]
  >[number],
  requirements: readonly LegalRequirementInput[],
): string | null {
  const parent = requirements.find(
    (r) => r.legalRequirementId === binding.legalRequirementId,
  );
  const field = {
    [LEGAL_REQUIREMENT_CONTEXT_FIELDS.APPLICABILITY_CONDITION]:
      "applicabilityConditions",
    [LEGAL_REQUIREMENT_CONTEXT_FIELDS.QUALIFIER]: "qualifiers",
    [LEGAL_REQUIREMENT_CONTEXT_FIELDS.EXCEPTION]: "exceptions",
  } as const;
  const value = parent?.[field[binding.field]]?.[binding.index];
  return value === undefined
    ? null
    : `${binding.legalRequirementId} ${binding.field} ${binding.index + 1}: ${value}`;
}

/** Copy parent bindings, never re-author actor roles or conditions in downstream prose. */
/**
 * Business purpose: Expose source-stated applicability context and repository/external proof boundaries to the investigator.
 *
 * Business rules:
 * - Preserve propositions, operative actors/actions, conditions, qualifiers, exceptions and source bindings without interpreting them.
 * - MIXED claims explicitly separate repository-observable evidence from external fulfillment; neither guidance nor source metadata establishes Customer facts.
 *
 * Execution flow:
 * 1. Collect inherited semantic context.
 * 2. Render deterministic requirements, claim proof boundaries and exact source reference tuples.
 * 3. Append directed context relations with their target provenance.
 *
 * Failure cases:
 * - Missing optional claim metadata emits no invented boundary; absent target text remains an empty reference target and is not treated as established scope.
 *
 * Side effects:
 * - Pure investigation-guidance projection; no legal verdict, customer fact or decision write.
 */
export function deriveAssessmentApplicabilityGuidance(
  requirements: readonly LegalRequirementInput[],
  relations: readonly LegalContextRelationInput[] = [],
  allRequirements: readonly LegalRequirementInput[] = requirements,
  semanticGraph?: LegalSemanticGraph,
): string {
  const context = assessmentSemanticContext(
    requirements,
    relations,
    allRequirements,
  );
  /**
   * Business purpose: Keep legal source identity, locator and content hash together in applicability guidance.
   *
   * Business rules:
   * - Serialize the supplied reference tuple exactly; formatting does not validate its underlying source authority.
   *
   * Execution flow:
   * 1. Return the JSON document/locator/hash tuple.
   *
   * Failure cases:
   * - Malformed reference access propagates; no fallback document or source hash is fabricated.
   *
   * Side effects:
   * - Pure source-reference formatting.
   */
  const source = (ref: LegalRequirementInput["sourceRefs"][number]) =>
    JSON.stringify([ref.documentId, ref.locator, ref.contentSha256]);
  const text = [...context.requirements]
    .sort((a, b) =>
      a.legalRequirementId < b.legalRequirementId
        ? -1
        : a.legalRequirementId > b.legalRequirementId
          ? 1
          : 0,
    )
    .map((rule) =>
      [
        `LegalRequirement: ${rule.legalRequirementId}`,
        `Proposition: ${rule.proposition}`,
        ...(rule.applicabilityMode
          ? [`Applicability mode: ${rule.applicabilityMode}`]
          : []),
        ...(rule.claimBindings ?? []).flatMap((binding) => {
          const claim = semanticGraph?.claims.find(
            (c) => c.claimId === binding.claimId,
          );
          return claim?.assessability === LEGAL_ASSESSABILITIES.MIXED
            ? [
                `Repository proof boundary for ${claim.claimId}: ${claim.semanticFrame?.repositoryObservableAspect ?? "UNSPECIFIED"}`,
                `External fulfillment is not established by repository inspection: ${claim.semanticFrame?.externalFulfillmentAspect ?? "UNSPECIFIED"}`,
              ]
            : [];
        }),
        ...(rule.operativePropositions ?? []).flatMap((operative, index) => [
          `Operative proposition ${index + 1}:`,
          `Actor: ${operative.actor}`,
          `Modality: ${operative.modality}`,
          `Action: ${operative.action}`,
          ...operative.sourceRefs.map(
            (ref) => `Operative source: ${source(ref)}`,
          ),
        ]),
        ...rule.applicabilityConditions.map(
          (value, index) => `Applicability condition ${index + 1}: ${value}`,
        ),
        ...rule.qualifiers.map(
          (value, index) => `Qualifier ${index + 1}: ${value}`,
        ),
        ...rule.exceptions.map(
          (value, index) => `Exception ${index + 1}: ${value}`,
        ),
        ...(rule.semanticContext ?? []).map(
          (value, index) => `Semantic context ${index + 1}: ${value}`,
        ),
        ...rule.sourceRefs.map((ref) => `Source binding: ${source(ref)}`),
      ].join("\n"),
    )
    .join("\n\n");
  return [
    text,
    ...context.relations.map(
      (edge) =>
        `Context relation: ${edge.relationId}|${edge.kind}|${edge.fromLegalRequirementId}->${edge.toLegalRequirementId ?? (edge.toSourceRef ? source(edge.toSourceRef) : "")}`,
    ),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Structural completeness of a prepared LegalRequirement: one that assessment rules cover must
 * state, in `applicabilityConditions`, whom or what the source applies it to and what triggers it.
 * The Assessment Root reads those statements to decide applicability per rule, so an empty list
 * leaves it nothing source-derived to test. This checks that the scope was declared; it never
 * judges what the scope means, which legal roles or categories exist, or whether any system is in
 * them. Those come from the pinned legal source, authored by Rule Set Preparation.
 */
/**
 * Business purpose: Check whether a requirement declares the structural applicability scope needed for its coverage mode.
 *
 * Business rules:
 * - UNCONDITIONAL requires no conditions; covered conditional requirements need a nonblank condition.
 * - Other coverage states pass this declaration check without establishing real-world applicability.
 *
 * Execution flow:
 * 1. Handle unconditional declaration first.
 * 2. For covered requirements, require at least one nonblank applicability condition; otherwise accept the non-covered declaration shape.
 *
 * Failure cases:
 * - A false result signals an incomplete/conflicting scope declaration; this predicate does not classify the Customer as applicable or exempt.
 *
 * Side effects:
 * - Pure contract predicate; no rule, evidence or decision mutation.
 */
export function declaresApplicabilityScope(
  coverageState: LegalRequirementCoverageState | string,
  applicabilityConditions: readonly string[],
  applicabilityMode?: string,
): boolean {
  if (applicabilityMode === LEGAL_APPLICABILITY_MODES.UNCONDITIONAL)
    return applicabilityConditions.length === 0;
  if (
    coverageState !==
    LEGAL_REQUIREMENT_COVERAGE_STATES.COVERED_BY_ASSESSMENT_RULES
  ) {
    return true;
  }
  return applicabilityConditions.some(
    (condition) => condition.trim().length > 0,
  );
}
