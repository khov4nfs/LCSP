import {
  LEGAL_REQUIREMENT_COVERAGE_STATES,
  LEGAL_REQUIREMENT_CONTEXT_FIELDS,
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
export function declaresApplicabilityScope(
  coverageState: LegalRequirementCoverageState | string,
  applicabilityConditions: readonly string[],
): boolean {
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
