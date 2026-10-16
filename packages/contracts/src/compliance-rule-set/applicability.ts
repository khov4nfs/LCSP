import {
  LEGAL_REQUIREMENT_COVERAGE_STATES,
  type LegalRequirementCoverageState,
} from "./constants.ts";
import type { LegalRequirementInput } from "./schemas.ts";

/** Copy parent bindings, never re-author actor roles or conditions in downstream prose. */
export function deriveAssessmentApplicabilityGuidance(
  requirements: readonly LegalRequirementInput[],
): string {
  return [...requirements]
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
        ...(rule.operativePropositions ?? []).flatMap((operative, index) => [
          `Operative proposition ${index + 1}:`,
          `Actor: ${operative.actor}`,
          `Modality: ${operative.modality}`,
          `Action: ${operative.action}`,
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
      ].join("\n"),
    )
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
